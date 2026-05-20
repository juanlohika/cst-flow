/**
 * Phase F.2 (B7) — Conversational proposal AI.
 *
 * Each turn: takes the running message history + the current proposal state
 * (may be null) + the new user input, returns:
 *   - reply: what to show in the chat panel
 *   - updatedContent?: a fresh ProposalContent if the AI produced/refined one
 *   - inferredClientName?: if the AI extracted a client name from the message
 *
 * The same function is called from web chat AND (later, in F.3) Telegram.
 */
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import type { ProposalContent } from "./types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachmentNames?: string[];
}

export interface ImageAttachment {
  mimeType: string;
  /** base64-encoded image bytes (no data: prefix). */
  data: string;
  name?: string;
}

export interface ChatTurnArgs {
  /** Prior conversation. Empty array for the first turn. */
  history: ChatMessage[];
  /** New user message text. */
  userMessage: string;
  /** Image attachments the user added with this turn. */
  attachments: ImageAttachment[];
  /** Current proposal state (null on first turn or when ARIMA hasn't produced one yet). */
  currentContent: ProposalContent | null;
  /** Account context. Null when ARIMA hasn't yet figured out which account. */
  account: { id: string; companyName: string } | null;
  /** Display name of the team member talking to ARIMA. */
  preparedByName: string;
}

export interface ChatTurnResult {
  reply: string;
  updatedContent?: ProposalContent;
  /** When set, the API should look up an account whose companyName matches this. */
  inferredClientName?: string;
}

export async function runChatTurn(args: ChatTurnArgs): Promise<{ ok: true; result: ChatTurnResult } | { ok: false; error: string; rawAi?: string }> {
  const model = await getModelForApp("brd-maker");
  if (!model) return { ok: false, error: "No AI model configured" };

  const promptText = buildSystemPrompt(args);

  // Build the multi-turn contents array Gemini expects.
  // We collapse our system+context+instructions into a single leading "user"
  // turn (Gemini's API doesn't have a separate system role for non-chat models),
  // followed by each prior message, ending with the new user turn (and any images).
  const contents: any[] = [];

  // Leading instruction turn
  contents.push({
    role: "user",
    parts: [{ text: promptText }],
  });
  contents.push({
    role: "model",
    parts: [{ text: "Understood. I'll help draft and refine the proposal. Tell me what you need." }],
  });

  // Prior conversation
  for (const m of args.history) {
    contents.push({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    });
  }

  // The new user turn — text + images
  const userParts: any[] = [{ text: args.userMessage || "(no message text)" }];
  for (const att of args.attachments) {
    userParts.push({
      inlineData: {
        mimeType: att.mimeType,
        data: att.data,
      },
    });
  }
  contents.push({ role: "user", parts: userParts });

  const result = await generateWithRetry(model, { contents });
  const raw = (result?.response?.text?.() || "").trim();
  const parsed = parseAiResponse(raw);
  if (!parsed) {
    return { ok: false, error: "AI returned non-JSON output", rawAi: raw };
  }

  return { ok: true, result: parsed };
}

function buildSystemPrompt(args: ChatTurnArgs): string {
  const today = new Date().toISOString().slice(0, 10);
  const haveContent = !!args.currentContent;
  const haveAccount = !!args.account;

  return `You are an AI assistant for Tarkie (MobileOptima, Inc.) helping a team member draft a professional client proposal through conversation. The user works on the Tarkie team. You are the same agent persona as ARIMA — practical, concise, helpful.

═══════════════════════════════════════════════════════════
HOW THIS WORKS
═══════════════════════════════════════════════════════════
You are in a TWO-PANEL UI: the user types in a chat on the left, and a live proposal preview renders on the right. Your job each turn is to either:

  (a) Ask ONE focused clarifying question if you don't have enough to draft / refine yet, OR
  (b) Produce or update the proposal JSON, which re-renders the preview on the right.

You can also do both: update what you have, and ask one follow-up question.

The user can attach images (screenshots of prior quotes, whiteboard photos, scope discussions). Read them carefully and use what's there. If an image contains a price, a deliverable list, or any data the user wants reflected, incorporate it.

═══════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════
Today: ${today}
Team member: ${args.preparedByName}
Account: ${haveAccount ? `${args.account!.companyName} (id: ${args.account!.id})` : "NOT YET IDENTIFIED — your first job may be to figure out which account this is for"}

Current proposal state: ${haveContent ? "DRAFT EXISTS (see JSON below). User wants to refine." : "NO DRAFT YET. First substantive turn should produce one."}

${haveContent ? `\nCURRENT DRAFT JSON:\n${JSON.stringify(args.currentContent, null, 2)}\n` : ""}

═══════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON ONLY — no markdown fences, no commentary outside the JSON)
═══════════════════════════════════════════════════════════
{
  "reply": "string — your chat-panel reply to the user. Conversational, Tarkie-team voice. 1-4 sentences usually. Use this to ask clarifying questions, acknowledge what you've updated, flag what's still missing, etc.",
  "updatedContent": null | { full ProposalContent object },
  "inferredClientName": null | "string — only set if the user mentioned a client name in this turn AND the account context above is NOT YET IDENTIFIED. Use this to nudge the system to look the account up."
}

═══════════════════════════════════════════════════════════
PROPOSAL CONTENT SHAPE (use this exact shape for updatedContent)
═══════════════════════════════════════════════════════════
{
  "title": "string — e.g. 'Manpower Costing Module Addendum'",
  "proposalDate": "${today}",
  "client": {
    "name": "Client Co. Inc.",
    "signatory": { "name": "...", "title": "..." }
  },
  "moi": {
    "signatory": { "name": "${args.preparedByName}", "title": "..." }
  },
  "version": {
    "number": 1,
    "date": "${today}",
    "preparedBy": "${args.preparedByName}",
    "submittedTo": "client signatory",
    "description": "one-line about this version"
  },
  "sections": [
    {
      "heading": "Project Objectives",
      "blocks": [
        { "kind": "paragraph", "text": "..." },
        { "kind": "bullets", "items": ["...", "..."] }
      ]
    }
  ],
  "cost": {
    "lines": [
      {
        "description": "Manpower Costing Add-on",
        "standardRate": "P100 + VAT",
        "discountedRate": "P75.00 + VAT",
        "unit": "Per Month Per User",
        "bullets": ["Configuration of Hourly Rate...", "Integration of the Billing Module..."]
      }
    ],
    "guaranteedUsers": "30 Users",
    "combinedRate": "P300.00 + VAT — Per Month Per User",
    "totalCost": "P12,000.00 + VAT"
  },
  "timeline": [
    { "phase": "Prerequisites & Config", "detailedSteps": "Proposal Approval & Account Configuration", "responsible": "Client / Tarkie", "targetDate": "May 29, 2026" }
  ],
  "isAddendum": true,
  "aiNotes": {
    "inferred": ["I assumed a 6-week rollout..."],
    "missing": ["Confirm guaranteed user count"],
    "summary": "1-2 sentences on what I wrote"
  }
}

═══════════════════════════════════════════════════════════
WRITING GUIDELINES
═══════════════════════════════════════════════════════════
- VOICE: professional, concise, client-facing. Active voice. No jargon ("leverage", "synergy", "ROI uplift").
- COST: NEVER invent prices. If the user hasn't given you a number, list it in aiNotes.missing and ask for it in your reply.
- TIMELINE: produce realistic phases. Standard Tarkie phases: Prerequisites & Config / Development & QA / UAT / Training / Launch / Post-Launch. Adjust based on scope.
- ADDENDUM: if isAddendum is true, frame Project Objectives as "This addendum adds X to the existing Tarkie subscription...". Include combinedRate in cost.
- INCREMENTAL UPDATES: when refining, do a FULL replacement of updatedContent — re-emit the entire JSON with the requested changes applied. Don't try to emit partial diffs.
- CLARIFYING QUESTIONS: ask ONE at a time. Don't bombard the user with a list of 5 questions.
- WHEN TO SET updatedContent: only when you have enough to produce a meaningful proposal OR refine an existing one. If you're just asking for the account name, set updatedContent to null.
- WHEN TO SET inferredClientName: only when account context above says "NOT YET IDENTIFIED" AND the user just mentioned a client name. The system will look up the account and inject it next turn.

Now read the conversation and produce the JSON response.`;
}

function parseAiResponse(raw: string): ChatTurnResult | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { return null; }
    } else {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : "",
    updatedContent: parsed.updatedContent ? normalizeContent(parsed.updatedContent) : undefined,
    inferredClientName: parsed.inferredClientName ? String(parsed.inferredClientName) : undefined,
  };
}

function normalizeContent(parsed: any): ProposalContent {
  // Light defensive normalization. Keep it minimal — trust the AI but coerce
  // shapes the renderer expects.
  return {
    title: String(parsed.title || "Proposal"),
    proposalDate: String(parsed.proposalDate || new Date().toISOString().slice(0, 10)),
    client: {
      name: String(parsed.client?.name || ""),
      signatory: parsed.client?.signatory ? {
        name: String(parsed.client.signatory.name || ""),
        title: String(parsed.client.signatory.title || ""),
      } : undefined,
    },
    moi: {
      signatory: {
        name: String(parsed.moi?.signatory?.name || ""),
        title: String(parsed.moi?.signatory?.title || ""),
      },
    },
    version: {
      number: Number(parsed.version?.number || 1),
      date: String(parsed.version?.date || new Date().toISOString().slice(0, 10)),
      preparedBy: String(parsed.version?.preparedBy || ""),
      submittedTo: String(parsed.version?.submittedTo || ""),
      description: String(parsed.version?.description || ""),
    },
    sections: Array.isArray(parsed.sections) ? parsed.sections.map((s: any) => ({
      heading: String(s.heading || ""),
      blocks: Array.isArray(s.blocks) ? s.blocks.map((b: any) =>
        b?.kind === "bullets" && Array.isArray(b.items)
          ? { kind: "bullets" as const, items: b.items.map(String) }
          : { kind: "paragraph" as const, text: String(b?.text || "") }
      ) : [],
    })) : [],
    cost: parsed.cost ? {
      lines: Array.isArray(parsed.cost.lines) ? parsed.cost.lines.map((l: any) => ({
        description: String(l.description || ""),
        standardRate: l.standardRate ? String(l.standardRate) : undefined,
        discountedRate: l.discountedRate ? String(l.discountedRate) : undefined,
        unit: l.unit ? String(l.unit) : undefined,
        bullets: Array.isArray(l.bullets) ? l.bullets.map(String) : undefined,
      })) : [],
      guaranteedUsers: parsed.cost.guaranteedUsers ? String(parsed.cost.guaranteedUsers) : undefined,
      combinedRate: parsed.cost.combinedRate ? String(parsed.cost.combinedRate) : undefined,
      totalCost: String(parsed.cost.totalCost || ""),
    } : undefined,
    timeline: Array.isArray(parsed.timeline) ? parsed.timeline.map((p: any) => ({
      phase: String(p.phase || ""),
      detailedSteps: String(p.detailedSteps || ""),
      responsible: String(p.responsible || ""),
      targetDate: String(p.targetDate || ""),
    })) : undefined,
    isAddendum: !!parsed.isAddendum,
    aiNotes: parsed.aiNotes ? {
      inferred: Array.isArray(parsed.aiNotes.inferred) ? parsed.aiNotes.inferred.map(String) : [],
      missing: Array.isArray(parsed.aiNotes.missing) ? parsed.aiNotes.missing.map(String) : [],
      summary: String(parsed.aiNotes.summary || ""),
    } : undefined,
  };
}
