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
  accountMemberships,
} from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { getModelForApp, generateWithRetry, readAIConfig } from "@/lib/ai";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { buildGeminiTools, executeTool, type ToolContext } from "@/lib/arima/tools";
import { markScheduleResponded } from "@/lib/arima/checkins";
import { buildGuardrailsPrompt, checkInputAgainstGuardrails } from "@/lib/arima/guardrails";

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
- Do NOT add "Is there anything else I can help with?" to closers. Let the conversation end naturally.

ACTION HONESTY (critical):
- You have callable tools. Talking about doing something is NOT doing it.
- NEVER claim "I've scheduled", "I've booked", "I've sent the invite", "I've notified the team", "the calendar invite is on its way", etc., unless a real tool returned success.
- If the user asks you to schedule a meeting and you can't actually book it, call create_request (category="meeting") and say honestly: "I've logged your meeting request — someone from the team will confirm a time and send the calendar invite shortly."
- Never invent Zoom links, calendar IDs, or confirmation numbers.

TOOL CALLS ARE INVISIBLE (critical):
- Tool names, JSON payloads, function arguments, and code-fenced tool blocks are PLUMBING. The user must NEVER see them in your reply.
- NEVER write things like "I'll now use schedule_meeting", "Let me check the result", "I'll fetch via get_recent_meetings", or any code block containing tool args.
- Speak only the human-readable outcome. Example good: "Got it — your meeting request for tomorrow with Lester is logged. A teammate will confirm a time and send the invite." Example bad: anything mentioning the tool name or showing JSON.`;

const REQUEST_REGEX = /\[REQUEST\]([\s\S]*?)\[\/REQUEST\]/i;

export interface ParsedRequest {
  title: string;
  description: string;
  category: string;
  priority: string;
}

export interface MessageAttachment {
  type: "image";
  url?: string;            // for storage-hosted attachments (portal)
  mime: string;            // image/png | image/jpeg | image/webp
  width?: number;
  height?: number;
  source: "telegram" | "portal";
  // If we already downloaded the bytes (telegram), include them here. The runtime
  // will inline-embed them so Gemini can read the image without a public URL.
  base64?: string;
}

export interface MentionRef {
  type: "internal" | "external" | "arima";
  id: string | null;
  name: string;
  telegramUsername?: string | null;
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
  /** Phase 13: real sender attribution */
  senderType?: "internal" | "external" | "arima" | "system";
  senderUserId?: string | null;
  senderName?: string | null;
  senderChannel?: "telegram" | "portal" | "web";
  /** Phase 13: image (and future file) attachments that should be fed to vision */
  attachments?: MessageAttachment[];
  /** Phase 13: parsed @mentions */
  mentions?: MentionRef[];
  /**
   * Phase 13: silent-by-default gating. If true, persist the user message but
   * skip the model call entirely (no reply). Used for human-to-human chatter
   * in a group chat where ARIMA wasn't @-mentioned.
   */
  skipModelCall?: boolean;
}

export interface ArimaRunResult {
  replyText: string;
  capturedRequestId: string | null;
  capturedRequest: ParsedRequest | null;
  provider: string;
  assistantMessageId: string;
  /** True when the runtime decided not to call the model (silent listener mode). */
  skipped?: boolean;
}

/**
 * Decide whether ARIMA should actually reply, given a group-chat context.
 * In a DM/portal-1:1, always reply. In a Telegram group / shared portal thread,
 * only reply when explicitly engaged.
 */
export function shouldArimaRespond(args: {
  senderChannel?: "telegram" | "portal" | "web";
  isGroup: boolean;
  text: string;
  mentions?: MentionRef[];
  hasAttachments?: boolean;
}): boolean {
  if (!args.isGroup) return true;
  const lower = (args.text || "").toLowerCase();
  if (lower.includes("@arima")) return true;
  if ((args.mentions || []).some(m => m.type === "arima")) return true;
  // Photo-only message in a group is ambiguous; stay silent unless explicitly asked.
  return false;
}

/**
 * Pull out function-call structures from a Gemini response (or any adapter that
 * passes them through). Returns [] for non-tool responses (e.g. Claude, plain text).
 */
function extractFunctionCalls(modelResult: any): Array<{ name: string; args: any }> {
  try {
    const candidates = modelResult?.response?.candidates;
    if (!candidates?.length) return [];
    const parts = candidates[0]?.content?.parts || [];
    const calls: Array<{ name: string; args: any }> = [];
    for (const p of parts) {
      if (p?.functionCall?.name) {
        calls.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
      }
    }
    return calls;
  } catch {
    return [];
  }
}

/**
 * Always get text out of a model result, even if the adapter throws on
 * text() when the response is a function-call message.
 */
function safeExtractText(modelResult: any): string {
  try {
    if (typeof modelResult?.response?.text === "function") {
      return modelResult.response.text() || "";
    }
  } catch {
    // Gemini throws if there's no text part — fall through to manual extraction
  }
  try {
    const parts = modelResult?.response?.candidates?.[0]?.content?.parts || [];
    return parts.map((p: any) => p?.text || "").join("").trim();
  } catch {
    return "";
  }
}

/**
 * Strip tool-call narration the model sometimes leaks into the visible reply,
 * even when the system prompt forbids it. Removes:
 *  - Triple-backtick fenced blocks whose label looks like a tool name
 *  - Lines that announce a tool invocation ("I'll now use foo", "Let me check…")
 *  - Trailing whitespace cleanup
 */
/**
 * Strip every form of tool-call narration that has leaked into past replies.
 * This runs both at write-time (in runArima) and at render-time (the portal
 * mirrors this logic via a shared regex pack), so even legacy messages stored
 * before Phase 17 display cleanly without us having to mutate the DB.
 */
export function scrubToolNarration(text: string, toolDefs?: any, knownToolNames?: string[]): string {
  if (!text) return text;
  let out = text;

  // Collect tool names from either the live tool defs (server-side) or a
  // statically-passed list (used by the render-side variant).
  const toolNames: string[] = [];
  try {
    const decls = toolDefs?.[0]?.functionDeclarations || [];
    for (const t of decls) if (t?.name) toolNames.push(String(t.name));
  } catch {}
  if (knownToolNames) for (const n of knownToolNames) if (n) toolNames.push(n);

  // Always include the common tool names we ship by default, so render-side
  // scrubbing works without round-tripping the tool registry.
  const builtIns = [
    "get_client_profile", "get_recent_meetings", "get_account_intelligence",
    "schedule_meeting", "create_request", "search_meetings",
    "list_open_requests", "send_check_in",
  ];
  for (const b of builtIns) if (!toolNames.includes(b)) toolNames.push(b);

  // 1) Drop fenced code blocks whose label or content is a tool call.
  if (toolNames.length > 0) {
    const escaped = toolNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    // ```tool_name … ```
    out = out.replace(new RegExp(`\`\`\`(?:${escaped.join("|")})[^\`]*\`\`\``, "gi"), "");
  }
  // Any fenced block whose body is pure JSON (single object/array) — almost
  // always an argument dump.
  out = out.replace(/```[a-zA-Z_-]*\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/g, "");
  // ```json … ``` blocks regardless of body shape (very common Gemini leak)
  out = out.replace(/```json[\s\S]*?```/gi, "");

  // 2) Scrub MID-SENTENCE tool references. The model loves to write things
  //    like "I'll call the `schedule_meeting` tool to ..." or "using the
  //    `get_recent_meetings` tool to fetch the details". We rewrite those
  //    into innocuous phrasing.
  if (toolNames.length > 0) {
    const escaped = toolNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const toolToken = `(?:\`)?(?:${escaped.join("|")})(?:\`)?`;
    // "I'll call the `foo` tool" / "I'll invoke `foo`" / "I'll use the `foo` tool"
    out = out.replace(new RegExp(`\\bI'?(?:ll|m going to) (?:now )?(?:use|call|invoke|run|fire|trigger) (?:the )?${toolToken}(?: tool)?\\b`, "gi"), "Let me check");
    // "using the `foo` tool" / "via the `foo` tool"
    out = out.replace(new RegExp(`\\b(?:using|via|through|with) (?:the )?${toolToken}(?: tool)?\\b`, "gi"), "");
    // "I'll need to use `foo` to …" / "I need to call `foo`"
    out = out.replace(new RegExp(`\\bI(?:'ll)? need to (?:use|call|invoke|run) (?:the )?${toolToken}(?: tool)?\\b`, "gi"), "Let me check");
    // Bare backtick references — "the `foo` tool", "the `foo`"
    out = out.replace(new RegExp(`\\b(?:the )?\`(?:${escaped.join("|")})\`(?: tool)?`, "gi"), "");
  }
  // Generic backticked snake_case looking like a tool name (anything_with_underscores)
  out = out.replace(/`[a-z][a-z0-9_]*_[a-z0-9_]+`/g, "");

  // 3) Whole filler lines / phrases.
  const fillerLines = [
    /^\s*I'?ll (now )?(?:use|invoke|call|fetch.*using|attempt to call|check via|need to)\b.*$/gim,
    /^\s*Let me (?:check|verify|fetch|look up|pull|grab|see).{0,80}(?:result|details|history|status)?\.?\s*$/gim,
    /^\s*I'?(?:ve|m) (?:attempting|going to) (?:to )?(?:call|invoke|use|run)\b.*$/gim,
    /^\s*I'?ve attempted to .*$/gim,
    /^\s*using the [`']?[a-zA-Z_]+[`']?(?: tool)?\.?\s*$/gim,
    /^\s*To give you (?:an? )?(?:overview|summary|view|look)(?: of [^,]+)?, I'?ll .*$/gim,
  ];
  for (const re of fillerLines) out = out.replace(re, "");

  // 4) Dangling empty parentheticals left by mid-sentence scrubs
  out = out.replace(/\s+\(\s*\)/g, "");
  // Empty quotes left by removed code
  out = out.replace(/``\s*``/g, "");
  // Double spaces, leading punctuation that became orphaned
  out = out.replace(/[ \t]+([.,;!?])/g, "$1");
  out = out.replace(/[ \t]{2,}/g, " ");

  // 5) Collapse 3+ newlines and trim
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  return out;
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

  // 1) Persist user message (with full Phase 13 attribution)
  const userMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  await db.insert(arimaMessages).values({
    id: userMsgId,
    conversationId: args.conversationId,
    role: "user",
    content: args.userMessage,
    senderType: args.senderType || "external",
    senderUserId: args.senderUserId || null,
    senderName: args.senderName || null,
    senderChannel: args.senderChannel || "web",
    mentions: args.mentions && args.mentions.length > 0 ? JSON.stringify(args.mentions) : null,
    attachments: args.attachments && args.attachments.length > 0
      ? JSON.stringify(args.attachments.map(a => ({
          type: a.type, url: a.url || null, mime: a.mime,
          width: a.width || null, height: a.height || null, source: a.source,
        })))
      : null,
    createdAt: now,
  });

  // Inbound message → reset the check-in no-response counter (if a schedule exists)
  if (args.clientProfileId) {
    markScheduleResponded(args.clientProfileId).catch(() => {});
  }

  // Phase 13 silent-listener mode: persist the message and exit without calling the model.
  if (args.skipModelCall) {
    return {
      replyText: "",
      capturedRequestId: null,
      capturedRequest: null,
      provider: "silent",
      assistantMessageId: "",
      skipped: true,
    };
  }

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
  // If the DB-stored skill doesn't yet have the Phase 17/18 "tool calls
  // are invisible" rule, force-append it so we don't depend on an admin
  // running POST /api/skills/seed. This makes the rule a hard runtime
  // guarantee — no race between deploy and seed.
  const TOOL_INVIS_MARKER = "Tool calls are INVISIBLE";
  let baseInstruction = arimaSkill || FALLBACK_INSTRUCTION;
  if (!baseInstruction.includes(TOOL_INVIS_MARKER)) {
    baseInstruction += `\n\n---\n\n## CRITICAL: Tool calls are INVISIBLE plumbing\n\nWhen you call a tool, that's between you and the system — the user must NEVER see tool names, JSON payloads, code blocks with arguments, or process narration like "I'll now use X", "Let me check the result", "I've attempted to call Y", "I'll fetch via Z", "using the \`tool_name\` tool".\n\nJust speak the OUTCOME in plain language. "Got it — meeting request logged. A teammate will confirm a time." That's it. Never name the tool you used. Never echo its arguments.`;
  }

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

  // 4) Build contents (prior history + new user message + any image attachments)
  const contents: any[] = [...(args.priorContents || [])];
  const newParts: any[] = [];
  // Senders identify themselves so multi-speaker group context is readable to the model
  const speakerLabel = args.senderName ? `[${args.senderName}]: ` : "";
  newParts.push({ text: speakerLabel + (args.userMessage || "") });
  for (const att of (args.attachments || [])) {
    if (att.type !== "image") continue;
    if (att.base64) {
      newParts.push({ inlineData: { mimeType: att.mime, data: att.base64 } });
    } else if (att.url) {
      // Some adapters accept fileData with a URL; fall back to a textual note for those that don't.
      newParts.push({ fileData: { mimeType: att.mime, fileUri: att.url } });
    }
  }
  contents.push({ role: "user", parts: newParts });

  // 5) Resolve model + provider label
  const model = await getModelForApp("arima");
  const aiConfig = await readAIConfig();
  const providerLabel = (model as any)?.__provider || aiConfig.primaryProvider || "unknown";

  // 6) Load tools FIRST so we can list them in the system prompt
  const toolDefs = await buildGeminiTools().catch(() => undefined);
  const toolCtx: ToolContext = {
    conversationId: args.conversationId,
    userId: args.userId,
    clientProfileId: args.clientProfileId || null,
    channel: "web", // overridden by Telegram/portal callers if needed in future
  };

  // Tool-aware preamble: many models will silently ignore the `tools` config
  // unless the system prompt explicitly tells them what's available and
  // commands them to USE the tools instead of pretending.
  let toolPreamble = "";
  if (toolDefs && toolDefs.length > 0 && toolDefs[0]?.functionDeclarations?.length > 0) {
    const list = toolDefs[0].functionDeclarations.map((t: any) =>
      `- ${t.name}: ${t.description}`
    ).join("\n");
    toolPreamble = `\n\n---\n\n## AVAILABLE TOOLS\n\nYou have these callable functions. When the user requests an action that matches one of these, CALL IT — do not just talk about doing it. After the tool returns, report what actually happened. If a tool returns ok:false with "awaitingApproval", DO NOT claim the action succeeded — tell the user it's been queued/logged for the team to confirm.\n\n${list}\n\nIf none of these match what the user is asking for an action, call \`create_request\` with an appropriate category so the human team is notified. NEVER claim to have scheduled, booked, sent, or completed anything unless a tool actually returned success.`;
  }

  // Build guardrails block (forbidden phrases, required disclosures, forbidden topics)
  const guardrailsPrompt = await buildGuardrailsPrompt().catch(() => "");

  const systemInstruction = (clientContext
    ? `${baseInstruction}\n\n---\n\n${clientContext}`
    : baseInstruction)
    + (guardrailsPrompt ? `\n\n---\n\n${guardrailsPrompt}` : "")
    + toolPreamble;

  // Run input-side guardrail checks (forbidden topics, escalation triggers, off-hours)
  const inputCheck = await checkInputAgainstGuardrails(args.userMessage).catch(() => null);

  // Short-circuit: forbidden topic → refuse + escalate, skip model call entirely
  if (inputCheck?.forbidden) {
    const refusal = `I'm not able to help with that one — it's outside what I can handle directly. Let me bring in a human teammate to follow up. ${inputCheck.escalationLabel ? `(Topic flagged: ${inputCheck.escalationLabel})` : ""}`;
    const assistantMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(arimaMessages).values({
      id: assistantMsgId,
      conversationId: args.conversationId,
      role: "assistant",
      content: refusal,
      provider: "guardrail",
      senderType: "arima",
      senderName: "ARIMA",
      senderChannel: args.senderChannel || "web",
      createdAt: new Date().toISOString(),
    });
    // Notify team
    if (args.clientProfileId) {
      try {
        const members = await db.select({ userId: accountMemberships.userId })
          .from(accountMemberships)
          .where(eq(accountMemberships.clientProfileId, args.clientProfileId));
        if (members.length > 0) {
          await dispatchNotification({
            userIds: members.map(m => m.userId),
            type: "mention",
            title: `⚠️ Guardrail: ${inputCheck.forbiddenTopicLabel} flagged`,
            body: `Client message blocked by guardrail. Please follow up:\n\n"${args.userMessage.slice(0, 200)}"`,
            link: `/arima?clientId=${args.clientProfileId}`,
          });
        }
      } catch (e) {
        console.warn("[guardrails] escalation notification failed:", e);
      }
    }
    return {
      replyText: refusal,
      capturedRequestId: null,
      capturedRequest: null,
      provider: "guardrail",
      assistantMessageId: assistantMsgId,
    };
  }

  // Off-hours: prepend the message as additional system context so ARIMA leans into "human follows up tomorrow"
  const offHoursNote = inputCheck?.offHoursReply
    ? `\n\n---\n\n## OFF-HOURS NOTICE\n\nIt's currently outside business hours. Acknowledge the message and tell the user: "${inputCheck.offHoursReply}" — DO NOT promise immediate action. Capture any request via create_request so the team picks it up first thing.`
    : "";

  const finalSystemInstruction = systemInstruction + offHoursNote;

  const baseInput: any = {
    contents,
    systemInstruction: { role: "system", parts: [{ text: finalSystemInstruction }] },
  };
  if (toolDefs) baseInput.tools = toolDefs;

  let result = await generateWithRetry(model, baseInput);

  // Fire-and-forget: if an escalation trigger matched, notify the team about it
  if (inputCheck?.escalate && !inputCheck?.forbidden && args.clientProfileId) {
    (async () => {
      try {
        const members = await db.select({ userId: accountMemberships.userId })
          .from(accountMemberships)
          .where(eq(accountMemberships.clientProfileId, args.clientProfileId!));
        if (members.length > 0) {
          await dispatchNotification({
            userIds: members.map(m => m.userId),
            type: "mention",
            title: `⚡ Escalation: ${inputCheck.escalationLabel}`,
            body: `Client message matched an escalation trigger. ARIMA is replying, but please review:\n\n"${args.userMessage.slice(0, 200)}"`,
            link: `/arima?clientId=${args.clientProfileId}`,
          });
        }
      } catch {}
    })();
  }

  // Tool-call loop: if the model wants to call functions, execute and feed back.
  // Capped at 4 iterations to prevent runaway loops.
  let rawReply = "";
  for (let iter = 0; iter < 4; iter++) {
    const fnCalls = extractFunctionCalls(result);
    if (fnCalls.length === 0) {
      rawReply = safeExtractText(result);
      break;
    }

    // Execute each function call
    const fnResponses: Array<{ name: string; response: any }> = [];
    for (const call of fnCalls) {
      try {
        const exec = await executeTool({
          name: call.name,
          input: call.args || {},
          context: toolCtx,
        });
        fnResponses.push({
          name: call.name,
          response: exec.ok ? exec.data || { ok: true, summary: exec.summary } : { ok: false, error: exec.error },
        });
      } catch (e: any) {
        fnResponses.push({ name: call.name, response: { ok: false, error: e?.message || "Tool error" } });
      }
    }

    // Build the next request: include the model's function-call message + our responses
    contents.push({
      role: "model",
      parts: fnCalls.map(c => ({ functionCall: { name: c.name, args: c.args || {} } })),
    });
    contents.push({
      role: "user",
      parts: fnResponses.map(r => ({ functionResponse: { name: r.name, response: r.response } })),
    });

    result = await generateWithRetry(model, {
      contents,
      systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
      ...(toolDefs ? { tools: toolDefs } : {}),
    });
  }

  if (!rawReply) rawReply = safeExtractText(result);

  let { cleanText: replyText, request: parsedRequest } = parseRequestBlock(rawReply);

  // Post-process safety net: strip tool-call narration even if the model ignores
  // the system-prompt rule. Removes triple-backtick blocks whose label is a known
  // tool name, and common filler phrases like "I'll now use X" / "Let me check
  // the result". This is plumbing — the client never needs to see it.
  replyText = scrubToolNarration(replyText, toolDefs);

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
    senderType: "arima",
    senderName: "ARIMA",
    senderChannel: args.senderChannel || "web",
    createdAt: replyAt,
  });

  // 8) Persist captured request (if any) + notify team
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

      // Notify everyone who has membership on this client account
      void notifyRequestCaptured({
        requestId: capturedRequestId,
        clientProfileId: args.clientProfileId || null,
        title: parsedRequest.title,
        category: parsedRequest.category,
        priority: parsedRequest.priority,
        capturedByUserId: args.userId,
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

/**
 * Notify everyone who has access to a client when ARIMA captures a request.
 * Fire-and-forget — never blocks the chat reply.
 */
async function notifyRequestCaptured(args: {
  requestId: string;
  clientProfileId: string | null;
  title: string;
  category: string;
  priority: string;
  capturedByUserId: string;
}): Promise<void> {
  try {
    let recipientIds: string[] = [];
    let clientName = "(no client)";

    if (args.clientProfileId) {
      // Pull every CST OS user who is a member of this client account. Primary
      // owner first so the bell/DM lands with them at the top of the recipient list.
      const members = await db
        .select({ userId: accountMemberships.userId, isPrimary: accountMemberships.isPrimary })
        .from(accountMemberships)
        .where(eq(accountMemberships.clientProfileId, args.clientProfileId));
      const sorted = [...members].sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary));
      recipientIds = sorted.map(m => m.userId);

      // Get client name for the notification body
      const clientRows = await db
        .select({ companyName: clientProfilesTable.companyName })
        .from(clientProfilesTable)
        .where(eq(clientProfilesTable.id, args.clientProfileId))
        .limit(1);
      if (clientRows[0]?.companyName) clientName = clientRows[0].companyName;
    } else {
      // No client linked → just notify the capturer
      recipientIds = [args.capturedByUserId];
    }

    if (recipientIds.length === 0) return;

    const priorityEmoji =
      args.priority === "urgent" ? "🚨" :
      args.priority === "high" ? "⚡" :
      args.priority === "low" ? "📌" : "📬";

    await dispatchNotification({
      userIds: recipientIds,
      type: "request_captured",
      title: `${priorityEmoji} New ${args.category} request from ${clientName}`,
      body: args.title,
      link: `/arima?view=requests&id=${args.requestId}`,
      payload: { requestId: args.requestId, priority: args.priority },
    });
  } catch (e) {
    console.warn("[arima/runtime] notifyRequestCaptured failed:", e);
  }
}
