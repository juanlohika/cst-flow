/**
 * Reusable ARIMA core that both /api/arima/generate (web) and /api/telegram/webhook (chat) call.
 * Handles: skill lookup, client-context injection, model call, [REQUEST] parsing, persistence.
 */
import { db } from "@/db";
import {
  skills as skillsTable,
  arimaConversations,
  arimaMessages,
  arimaRequests,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { getModelForApp, generateWithRetry, readAIConfig } from "@/lib/ai";

const FALLBACK_INSTRUCTION = `You are ARIMA, an AI Relationship Manager for the CST team at MobileOptima/Tarkie.

CRITICAL RULES:
- NEVER stay silent. Every message gets a reply, even if the reply is "I don't have that info, let me get a human teammate."
- Be warm, CONCISE, professional. Identify yourself as an AI on the first message ONLY.
- Match the user's energy: short message → short reply.
- NEVER end every reply with a follow-up question. If the user is just saying thanks or goodbye, just acknowledge and STOP.
- Never invent contract terms, commit to deadlines, or share info about other clients.
- Escalate sensitive topics (legal, billing, scope changes, complaints) by SAYING SO out loud, not by going silent.
- If asked for information you don't have, plainly say "I don't have that detail in my context — let me bring in a human teammate."

CLOSURE RULES (important):
- If the user says "thanks", "ok", "got it", "bye", or sends 👍 — reply with ONE short sentence and DO NOT ask anything back.
- Examples: "You're welcome." / "Sounds good." / "Take care." / "👍"
- Do NOT add "Is there anything else I can help with?" to closers. Let the conversation end naturally.`;

const REQUEST_REGEX = /\[REQUEST\]([\s\S]*?)\[\/REQUEST\]/i;

export interface ParsedRequest {
  title: string;
  description: string;
  category: string;
  priority: string;
}

export interface ArimaRunArgs {
  /** The conversation to append to. Required (create one beforehand if needed). */
  conversationId: string;
  /** CST OS user this conversation belongs to (use a system-user id for webhook flows). */
  userId: string;
  /** Optional client profile to inject as context. */
  clientProfileId?: string | null;
  /** Latest user message text. */
  userMessage: string;
  /** Full prior conversation as Gemini-format contents (excluding the new user message). */
  priorContents?: Array<{ role: "user" | "model"; parts: { text: string }[] }>;
}

export interface ArimaRunResult {
  replyText: string;
  capturedRequestId: string | null;
  capturedRequest: ParsedRequest | null;
  provider: string;
  assistantMessageId: string;
}

function parseRequestBlock(text: string): { cleanText: string; request: ParsedRequest | null } {
  const match = text.match(REQUEST_REGEX);
  if (!match) return { cleanText: text, request: null };

  const inside = match[1];
  const grab = (key: string) => {
    const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "im");
    const m = inside.match(re);
    return m ? m[1].trim() : "";
  };

  const title = grab("title");
  const description = grab("description");
  const categoryRaw = (grab("category") || "other").toLowerCase();
  const priorityRaw = (grab("priority") || "medium").toLowerCase();

  const validCategories = ["feature", "bug", "question", "config", "meeting", "other"];
  const validPriorities = ["low", "medium", "high", "urgent"];
  const category = validCategories.includes(categoryRaw) ? categoryRaw : "other";
  const priority = validPriorities.includes(priorityRaw) ? priorityRaw : "medium";

  const cleanText = text.replace(REQUEST_REGEX, "").replace(/```\s*```/g, "").trim();

  if (!title) return { cleanText, request: null };
  return { cleanText, request: { title, description, category, priority } };
}

function buildClientContext(profile: any): string {
  if (!profile) return "";
  const modules = (() => {
    try {
      const arr = JSON.parse(profile.modulesAvailed || "[]");
      return Array.isArray(arr) && arr.length > 0 ? arr.join(", ") : "(none specified)";
    } catch {
      return profile.modulesAvailed || "(none specified)";
    }
  })();

  const lines: string[] = [];
  lines.push("## CURRENT CLIENT CONTEXT");
  lines.push("");
  lines.push(`You are talking ABOUT or ON BEHALF OF the following client account. Use this context to ground every reply. Do not invent fields that are not present.`);
  lines.push("");
  lines.push(`- **Company:** ${profile.companyName || "Unknown"}`);
  lines.push(`- **Industry:** ${profile.industry || "Unknown"}`);
  if (profile.companySize) lines.push(`- **Company size:** ${profile.companySize}`);
  lines.push(`- **Modules contracted:** ${modules}`);
  lines.push(`- **Engagement status:** ${profile.engagementStatus || "unknown"}`);
  if (profile.primaryContact) lines.push(`- **Primary contact:** ${profile.primaryContact}${profile.primaryContactEmail ? ` (${profile.primaryContactEmail})` : ""}`);
  if (profile.specialConsiderations) {
    lines.push("");
    lines.push(`**Special considerations:** ${profile.specialConsiderations}`);
  }
  if (profile.intelligenceContent) {
    lines.push("");
    lines.push("### Account intelligence");
    // Cap at 2500 chars to be safe with token limits + safety filters
    const cap = 2500;
    lines.push(profile.intelligenceContent.length > cap
      ? profile.intelligenceContent.slice(0, cap) + "\n\n[…truncated]"
      : profile.intelligenceContent);
  }
  lines.push("");
  lines.push("Reference these facts naturally when helpful. Never share information about other clients.");
  return lines.join("\n");
}

/**
 * The shared ARIMA run loop.
 * - Persists the user message.
 * - Loads the ARIMA skill + (optional) client context.
 * - Calls the configured model.
 * - Parses any [REQUEST] block, strips it from the visible reply.
 * - Persists the assistant reply + any captured request.
 * - Updates conversation aggregates.
 */
export async function runArima(args: ArimaRunArgs): Promise<ArimaRunResult> {
  const now = new Date().toISOString();

  // 1) Persist user message
  const userMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  await db.insert(arimaMessages).values({
    id: userMsgId,
    conversationId: args.conversationId,
    role: "user",
    content: args.userMessage,
    createdAt: now,
  });

  // 2) Load skill text (concat all active arima skills)
  let arimaSkill = "";
  try {
    const skills = await db
      .select()
      .from(skillsTable)
      .where(and(eq(skillsTable.category, "arima"), eq(skillsTable.isActive, true)))
      .orderBy(desc(skillsTable.updatedAt));
    if (skills.length > 0) {
      arimaSkill = skills.map(s => s.content).join("\n\n---\n\n");
    }
  } catch (err) {
    console.error("[arima/runtime] skill fetch failed:", err);
  }
  const baseInstruction = arimaSkill || FALLBACK_INSTRUCTION;

  // 3) Load client profile if requested
  let clientProfile: any = null;
  if (args.clientProfileId) {
    try {
      const rows = await db
        .select()
        .from(clientProfilesTable)
        .where(eq(clientProfilesTable.id, args.clientProfileId))
        .limit(1);
      clientProfile = rows[0] || null;
    } catch (e) {
      console.warn("[arima/runtime] client profile lookup failed:", e);
    }
  }

  const clientContext = buildClientContext(clientProfile);
  const systemInstruction = clientContext
    ? `${baseInstruction}\n\n---\n\n${clientContext}`
    : baseInstruction;

  // 4) Build contents (prior history + new user message)
  const contents: any[] = [...(args.priorContents || [])];
  contents.push({ role: "user", parts: [{ text: args.userMessage }] });

  // 5) Resolve model + provider label
  const model = await getModelForApp("arima");
  const aiConfig = await readAIConfig();
  const providerLabel = (model as any)?.__provider || aiConfig.primaryProvider || "unknown";

  // 6) Call the model with retry
  const result = await generateWithRetry(model, {
    contents,
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
  });
  const rawReply = result.response.text();
  let { cleanText: replyText, request: parsedRequest } = parseRequestBlock(rawReply);

  // SAFETY NET: never let an empty reply slip through. If the AI returned
  // nothing (safety-filter block, token limit, etc.), substitute a plain refusal
  // so the user always gets something.
  if (!replyText || !replyText.trim()) {
    console.warn("[arima/runtime] AI returned empty reply — substituting fallback");
    replyText =
      "I'm not able to answer that one right now — it may be outside what I can help with, or the system blocked my response. Let me bring in a human teammate who can follow up. In the meantime, feel free to rephrase your question.";
  }

  // 7) Persist assistant message (clean text)
  const replyAt = new Date().toISOString();
  const assistantMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  await db.insert(arimaMessages).values({
    id: assistantMsgId,
    conversationId: args.conversationId,
    role: "assistant",
    content: replyText,
    provider: providerLabel,
    createdAt: replyAt,
  });

  // 8) Persist captured request (if any)
  let capturedRequestId: string | null = null;
  if (parsedRequest) {
    try {
      capturedRequestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      await db.insert(arimaRequests).values({
        id: capturedRequestId,
        conversationId: args.conversationId,
        sourceMessageId: assistantMsgId,
        userId: args.userId,
        clientProfileId: args.clientProfileId || null,
        title: parsedRequest.title.slice(0, 200),
        description: parsedRequest.description || null,
        category: parsedRequest.category,
        priority: parsedRequest.priority,
        status: "new",
        createdAt: replyAt,
        updatedAt: replyAt,
      });
    } catch (reqErr) {
      console.warn("[arima/runtime] failed to insert captured request:", reqErr);
      capturedRequestId = null;
    }
  }

  // 9) Update conversation aggregate
  await db
    .update(arimaConversations)
    .set({
      messageCount: sql`COALESCE(${arimaConversations.messageCount}, 0) + 2`,
      lastMessageAt: replyAt,
      updatedAt: replyAt,
    })
    .where(eq(arimaConversations.id, args.conversationId));

  return {
    replyText,
    capturedRequestId,
    capturedRequest: parsedRequest,
    provider: providerLabel,
    assistantMessageId: assistantMsgId,
  };
}
