/**
 * Phase F.2 (B7) — AI content generator. Takes user-provided inputs and
 * produces the structured ProposalContent JSON that the HTML preview + PDF
 * both render from. Pure text — no Word, no Drive, no DB.
 */
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import type { ProposalContent, ProposalUserInputs } from "./types";

export async function buildProposalContent(args: {
  inputs: ProposalUserInputs;
  clientCompanyName: string;
  preparedByName: string;
}): Promise<{ ok: true; content: ProposalContent } | { ok: false; error: string; rawAi?: string }> {
  const model = await getModelForApp("brd-maker");
  if (!model) return { ok: false, error: "No AI model configured" };

  const prompt = buildPrompt(args);
  const result = await generateWithRetry(model, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const raw = (result?.response?.text?.() || "").trim();
  const parsed = tryParseJson(raw);
  if (!parsed) return { ok: false, error: "AI returned non-JSON output", rawAi: raw };

  // Light validation — ensure the required scalar fields are present. We trust
  // the AI for prose quality but don't trust it to remember every nested field.
  const content = normalizeContent(parsed, args);
  if (!content.title) return { ok: false, error: "AI didn't produce a title", rawAi: raw };
  if (!content.sections || content.sections.length === 0) return { ok: false, error: "AI didn't produce any sections", rawAi: raw };

  return { ok: true, content };
}

function buildPrompt(args: {
  inputs: ProposalUserInputs;
  clientCompanyName: string;
  preparedByName: string;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are writing a professional client proposal for Tarkie (MobileOptima, Inc.). Tarkie is a field-operations SaaS platform for sales and merchandising teams.

You will receive user-provided inputs and must produce a structured JSON document describing the proposal. The JSON will be rendered into a styled HTML page and exported as a PDF for the client.

═══════════════════════════════════════════════════════════
OUTPUT SHAPE (return ONLY this JSON, no markdown fences, no commentary):
═══════════════════════════════════════════════════════════
{
  "title": "string — concise project title (e.g. 'Manpower Costing Module Addendum')",
  "proposalDate": "${today}",
  "client": {
    "name": "${args.clientCompanyName}",
    "signatory": { "name": "...", "title": "..." }
  },
  "moi": {
    "signatory": { "name": "...", "title": "..." }
  },
  "version": {
    "number": 1,
    "date": "${today}",
    "preparedBy": "${args.preparedByName}",
    "submittedTo": "client signatory name",
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
        "description": "Manpower Costing per Site Visit Add-on",
        "standardRate": "P100 + VAT",
        "discountedRate": "P75.00 + VAT",
        "unit": "Per Month Per User",
        "bullets": ["Configuration of Hourly Rate per Site Personnel...", "Integration of the Billing Module..."]
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
    "inferred": ["I assumed a 6-week rollout based on similar Tarkie projects."],
    "missing": ["Confirm guaranteed user count — currently set to 30 Users from the inputs"],
    "summary": "1-2 sentences on what you wrote"
  }
}

═══════════════════════════════════════════════════════════
WRITING GUIDELINES:
═══════════════════════════════════════════════════════════
- VOICE: professional, concise, client-facing. Tarkie writes proposals in the active voice. No filler. No "leverage", "synergy", "ROI uplift" jargon. Plain English.
- SECTIONS: choose the right ones for this proposal. Typical sections in order:
    1. "Project Objectives" — what the client gets (1-2 paragraphs + optional bullets)
    2. "Scope of Work" — what Tarkie will do (paragraphs + bullets)
    3. "Deliverables" — what gets handed over (usually bullets)
    4. "Investment" — text introducing the cost table (1 short paragraph, NOT the table itself)
    5. "Estimated Timeline" — text introducing the timeline (1 short paragraph)
  Skip sections that don't apply. Add sections that do (e.g., "Assumptions", "Out of Scope") when relevant.
- COST: NEVER invent prices. Use only the rates/totals in the inputs. If the inputs are incomplete, list the gap in aiNotes.missing — don't fabricate a number.
- TIMELINE: produce realistic phases for the work. Standard Tarkie phases when in doubt: Prerequisites & Config / Development & QA / UAT / Training / Launch / Post-Launch. Adjust based on the project scope.
- ADDENDUM HANDLING: if isAddendum is true in the inputs, frame the Project Objectives section as "This addendum adds X to the existing Tarkie subscription..." and include the combined-rate row in the cost block.

═══════════════════════════════════════════════════════════
USER INPUTS:
═══════════════════════════════════════════════════════════
Client: ${args.clientCompanyName}
Title: ${args.inputs.title}
Is addendum: ${args.inputs.isAddendum ? "yes" : "no"}
Prepared by: ${args.preparedByName}

Scope notes from the team:
${args.inputs.scopeNotes}

Cost details:
- Total cost: ${args.inputs.totalCost || "(not provided)"}
- Standard rate: ${args.inputs.standardRate || "(not provided)"}
- Discounted rate: ${args.inputs.discountedRate || "(not provided)"}
- Combined rate: ${args.inputs.combinedRate || "(not provided)"}
- Guaranteed users: ${args.inputs.guaranteedUsers || "(not provided)"}

Timeline guidance: ${args.inputs.timelineNotes || "(use standard Tarkie rollout phases)"}

Signatories:
- Client: ${args.inputs.clientSignatoryName || "(not provided)"} / ${args.inputs.clientSignatoryTitle || "(not provided)"}
- MOI: ${args.inputs.moiSignatoryName || args.preparedByName} / ${args.inputs.moiSignatoryTitle || "(not provided)"}

Now produce the JSON. Return ONLY the JSON object.`;
}

function tryParseJson(raw: string): any | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function normalizeContent(parsed: any, args: {
  inputs: ProposalUserInputs;
  clientCompanyName: string;
  preparedByName: string;
}): ProposalContent {
  // Fill in any missing scalar fields with sane defaults. The AI sometimes
  // forgets the boilerplate.
  return {
    title: String(parsed.title || args.inputs.title || "Proposal"),
    proposalDate: String(parsed.proposalDate || new Date().toISOString().slice(0, 10)),
    client: {
      name: String(parsed.client?.name || args.clientCompanyName),
      signatory: parsed.client?.signatory
        ? {
            name: String(parsed.client.signatory.name || args.inputs.clientSignatoryName || ""),
            title: String(parsed.client.signatory.title || args.inputs.clientSignatoryTitle || ""),
          }
        : undefined,
    },
    moi: {
      signatory: {
        name: String(parsed.moi?.signatory?.name || args.inputs.moiSignatoryName || args.preparedByName),
        title: String(parsed.moi?.signatory?.title || args.inputs.moiSignatoryTitle || ""),
      },
    },
    version: {
      number: Number(parsed.version?.number || 1),
      date: String(parsed.version?.date || new Date().toISOString().slice(0, 10)),
      preparedBy: String(parsed.version?.preparedBy || args.preparedByName),
      submittedTo: String(parsed.version?.submittedTo || args.inputs.clientSignatoryName || ""),
      description: String(parsed.version?.description || args.inputs.title || ""),
    },
    sections: Array.isArray(parsed.sections) ? parsed.sections.map(normalizeSection).filter(Boolean) as any : [],
    cost: parsed.cost ? normalizeCost(parsed.cost) : undefined,
    timeline: Array.isArray(parsed.timeline) ? parsed.timeline.map(normalizeTimeline).filter(Boolean) as any : undefined,
    isAddendum: !!parsed.isAddendum,
    aiNotes: parsed.aiNotes ? {
      inferred: Array.isArray(parsed.aiNotes.inferred) ? parsed.aiNotes.inferred.map(String) : [],
      missing: Array.isArray(parsed.aiNotes.missing) ? parsed.aiNotes.missing.map(String) : [],
      summary: String(parsed.aiNotes.summary || ""),
    } : undefined,
  };
}

function normalizeSection(s: any): any | null {
  if (!s || !s.heading) return null;
  return {
    heading: String(s.heading),
    blocks: Array.isArray(s.blocks) ? s.blocks.map((b: any) => {
      if (b?.kind === "bullets" && Array.isArray(b.items)) return { kind: "bullets", items: b.items.map(String) };
      return { kind: "paragraph", text: String(b?.text || "") };
    }).filter(Boolean) : [],
  };
}

function normalizeCost(c: any): any {
  return {
    lines: Array.isArray(c.lines) ? c.lines.map((l: any) => ({
      description: String(l.description || ""),
      standardRate: l.standardRate ? String(l.standardRate) : undefined,
      discountedRate: l.discountedRate ? String(l.discountedRate) : undefined,
      unit: l.unit ? String(l.unit) : undefined,
      bullets: Array.isArray(l.bullets) ? l.bullets.map(String) : undefined,
    })) : [],
    guaranteedUsers: c.guaranteedUsers ? String(c.guaranteedUsers) : undefined,
    combinedRate: c.combinedRate ? String(c.combinedRate) : undefined,
    totalCost: String(c.totalCost || ""),
  };
}

function normalizeTimeline(p: any): any | null {
  if (!p || !p.phase) return null;
  return {
    phase: String(p.phase),
    detailedSteps: String(p.detailedSteps || ""),
    responsible: String(p.responsible || ""),
    targetDate: String(p.targetDate || ""),
  };
}
