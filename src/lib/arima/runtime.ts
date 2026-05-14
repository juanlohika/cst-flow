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
const BRD_REGEX = /\[BRD\]([\s\S]*?)\[\/BRD\]/i;

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
  /**
   * Phase 20: which agent is leading this conversation. Defaults to "arima"
   * (the relationship manager). When "eliana", we load the BA skill category
   * + inject Eliana-specific knowledge audience.
   */
  agentMode?: "arima" | "eliana";
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

// Helper: ES5-safe check for "this string is just emoji/symbols, no real text".
// Strips ASCII printable + whitespace; if nothing visible-and-non-emoji remains,
// the original was emoji-only.
function isEmojiOnly(s: string): boolean {
  const stripped = (s || "").replace(/[\x20-\x7E\s]/g, "");
  if (!stripped) return false; // pure ASCII text → not emoji-only
  // Anything left that's not ASCII could be emoji; treat as emoji-only when
  // there were no ASCII letters/digits in the original
  return !/[a-zA-Z0-9]/.test(s);
}

/**
 * Decide whether Eliana should reply in a group chat. She's more proactive
 * than ARIMA — she leads discovery — but she must NOT reply when humans are
 * clearly talking to each other or ABOUT her in 3rd person.
 *
 * Reply when:
 *  - @eliana / @eli / @arima present
 *  - "Eliana," / "Eli," at start of message (direct address)
 *  - Message ends with "?" AND her last reply was the most recent bot message
 *    (i.e., she asked a question; current message is an answer to it)
 *  - First-ever message in the conversation (cold-start greeting)
 *  - hasAttachments + the message clearly references the screenshot (rare)
 *
 * Stay quiet when:
 *  - Message addresses someone else ("Hi Ms. Abigail...", "Hi @Lester ...")
 *  - 3rd-person reference about her ("Eliana references...", "si Eliana ang...",
 *    "let Eliana know", "ask Eliana to")
 *  - Pure inter-human commentary ("yun lang makulit si X", "ok lang", "ay sige")
 *  - Single-emoji reactions
 */
export function shouldElianaRespond(args: {
  isGroup: boolean;
  text: string;
  mentions?: MentionRef[];
  isFirstMessageInConvo: boolean;
  lastBotWasEliana: boolean;
}): boolean {
  // In a 1:1 / DM context, always reply
  if (!args.isGroup) return true;

  const raw = (args.text || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();

  // First-ever message in this discovery convo → greet
  if (args.isFirstMessageInConvo) return true;

  // Explicit @mentions of the agent (any spelling)
  if (lower.includes("@eliana") || lower.includes("@eli ") || lower.endsWith("@eli")) return true;
  if (lower.includes("@arima")) return true;
  if ((args.mentions || []).some(m => m.type === "arima")) return true;

  // 3rd-person references — STAY QUIET even though "eliana" appears in the text
  const thirdPersonPatterns = [
    /\beliana (references|uses|reads|has|asks|will|can|cannot|won't|does|doesn't|is|isn't|was|wasn't|references?|recommends?)\b/i,
    /\b(let|tell|ask|inform|notify|update|alert|cc|loop in) eliana\b/i,
    /\bsi eliana (ay|ang|si|ng|para|na)\b/i,                  // Tagalog: "si Eliana ay/ang/si/ng/para/na ..."
    /\bask eliana (to|about|for|if)\b/i,
    /\bsa eliana\b/i,                                          // Tagalog: "sa Eliana"
    /\b(makulit|kausap|tahimik|natulog) (si )?(arima|eliana|eli)\b/i, // "makulit si Arima", "hindi kausap si Eliana"
    /\b(arima|eliana|eli) (is|was|ay) (just|lang|talaga|kasi)\b/i,
  ];
  if (thirdPersonPatterns.some(re => re.test(raw))) return false;

  // Direct address at the start: "Eliana, ..." / "Eli, ..." / "Ate Eliana..."
  if (/^(eliana|eli|hi eliana|hey eliana|@eliana|ate eliana|sir eliana|ma'am eliana)[\s,:!?-]/i.test(raw)) return true;

  // Message clearly addresses a non-Eliana person: "Hi Ms. X" / "Hi @user" / "@John ..."
  // (must be the FIRST recognizable address — not a later sentence about Eliana)
  if (/^(hi|hello|hey|kumusta|pre|sir|ma'?am|sis|tito|ate)\s+(ms\.?|mr\.?|mrs\.?|dr\.?|@?[A-Z][a-zA-Z]+)/i.test(raw)) {
    // The greeting targets someone — only respond if that someone is Eliana
    if (!/^(hi|hello|hey|kumusta|pre|sir|ma'?am|sis|tito|ate)\s+(eliana|eli|@eliana)\b/i.test(raw)) {
      return false;
    }
  }

  // Question follow-up: if Eliana just asked something, treat any reasonable
  // text response as an answer to her question
  if (args.lastBotWasEliana && raw.length > 2 && !isEmojiOnly(raw)) {
    return true;
  }

  // Single-emoji reactions ("👍", "✅", "🙏") — stay quiet
  if (isEmojiOnly(raw)) return false;

  // Very short reactions ("ok", "sige", "ayos", "thanks") — stay quiet unless
  // they followed an Eliana question (handled above)
  if (raw.length < 8 && /^(ok(ay)?|sige|ayos|thanks?|salamat|noted|got it|👍|✅)[\s.!?]*$/i.test(raw)) return false;

  // Default for ambiguous cases in group: stay quiet. Discovery moves through
  // explicit engagement, not on every passing human comment.
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
/**
 * Defense layer #3 against phantom actions. The system prompt forbids the
 * model from claiming actions it didn't take, and the scrubber removes tool
 * names, but neither catches cases like:
 *   "I've notified the team" (when no notify_internal_team tool ran)
 *   "I've logged your request" (when no create_request tool ran)
 *
 * This guard inspects the visible reply for action claims and verifies that
 * a matching tool ran successfully this turn. If not, the claim is rewritten
 * into something honest. Side benefit: catches hallucinated email/Zoom/SMS
 * sends too.
 */
export function guardPhantomClaims(text: string, successfulTools: Set<string>): string {
  if (!text) return text;
  let out = text;

  // Map of claim patterns → required tool that must have run for the claim to be honest
  type Guard = { pattern: RegExp; requiredTools: string[]; replacement: string };
  const guards: Guard[] = [
    {
      pattern: /\bI've?\s+(?:also\s+)?(?:notif(?:y|ied)|alerted|pinged|messaged)\s+(?:the\s+)?(?:internal\s+)?team\b[^.!?]*[.!?]?/gi,
      requiredTools: ["notify_internal_team"],
      replacement: "I've flagged this with the team — they'll see it on their end.",
    },
    {
      pattern: /\bI(?:'ll|\s+will)\s+(?:now\s+|also\s+)?(?:notify|alert|ping|message)\s+(?:the\s+)?(?:internal\s+)?team\b[^.!?]*[.!?]?/gi,
      requiredTools: ["notify_internal_team"],
      replacement: "The team will see this request on their dashboard.",
    },
    {
      pattern: /\bI've?\s+(?:logged|captured|recorded|saved|filed)\s+(?:your|this|the)\s+request\b[^.!?]*[.!?]?/gi,
      requiredTools: ["create_request"],
      replacement: "Noted — the team will follow up on this shortly.",
    },
    {
      pattern: /\b(?:Your|This|The)\s+request\s+(?:has\s+been|was)\s+(?:notified|sent|logged|captured|recorded)\b[^.!?]*[.!?]?/gi,
      requiredTools: ["create_request", "notify_internal_team"],
      replacement: "The team will follow up on this.",
    },
    {
      pattern: /\bI've?\s+(?:scheduled|booked)\s+(?:the\s+|a\s+|your\s+)?(?:meeting|call|appointment)\b[^.!?]*[.!?]?/gi,
      requiredTools: ["schedule_meeting"],
      replacement: "I've logged your meeting request — someone from the team will confirm a time and send the calendar invite shortly.",
    },
    {
      pattern: /\bI've?\s+(?:sent|emailed|delivered)\s+(?:the\s+|an?\s+)?(?:email|invite|calendar\s+invite|notification)\b[^.!?]*[.!?]?/gi,
      requiredTools: ["schedule_meeting", "send_check_in"],
      replacement: "The team will follow up with the details directly.",
    },
    {
      pattern: /\bI've?\s+(?:sent|delivered)\s+(?:you|the\s+client)?\s*a?\s*check[- ]?in\b[^.!?]*[.!?]?/gi,
      requiredTools: ["send_check_in"],
      replacement: "I've logged a check-in for the team to send.",
    },
  ];

  for (const g of guards) {
    out = out.replace(g.pattern, (match) => {
      // If ANY of the acceptable tools actually ran, leave the claim intact
      if (g.requiredTools.some(t => successfulTools.has(t))) return match;
      // Otherwise replace with honest version
      return g.replacement;
    });
  }

  // Collapse extra whitespace introduced by replacements
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * Strip a leading self-prefix the model sometimes adds because it mimics the
 * "[Name]: <text>" pattern we use in the multi-party conversation history.
 * Removes ANY leading "[Word]:" or "Word:" up to 3 times (catches doubled
 * leaks like "[ARIMA]: [ARIMA]: ...").
 */
export function stripSelfPrefix(text: string, personaName?: string): string {
  if (!text) return text;
  let out = text.trimStart();
  for (let i = 0; i < 3; i++) {
    const before = out;
    // [NAME]: with optional whitespace
    out = out.replace(/^\[[A-Za-z][A-Za-z0-9 _.-]{0,40}\]\s*:\s*/i, "");
    // NAME: at very start (only if it looks like an agent/role label, not natural prose)
    out = out.replace(/^([A-Z][A-Za-z]{1,20})\s*:\s+/, (m, name) => {
      // Only strip if it matches the persona, or if it's all uppercase agent style
      if (personaName && name.toLowerCase() === personaName.toLowerCase()) return "";
      if (name === name.toUpperCase() && name.length >= 3) return "";
      return m;
    });
    if (out === before) break;
  }
  return out;
}

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
    // Phase 20.2 hotfix: PARENTHESIZED tool names — "(create_request)", "(get_client_profile)"
    // These leak as standalone lines or inline plumbing notes the model emits to "show its work".
    out = out.replace(new RegExp(`\\((?:${escaped.join("|")})\\)`, "gi"), "");
  }
  // Generic backticked snake_case looking like a tool name (anything_with_underscores)
  out = out.replace(/`[a-z][a-z0-9_]*_[a-z0-9_]+`/g, "");
  // Generic parenthesized snake_case — "(some_tool_name)" as a whole token
  out = out.replace(/\(\s*[a-z][a-z0-9_]*_[a-z0-9_]+\s*\)/g, "");

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
  // Try [BRD] first (Eliana's structured discovery summary). If found, convert
  // to a ParsedRequest with category="brd" and a multi-line description.
  const brdMatch = text.match(BRD_REGEX);
  if (brdMatch) {
    const inside = brdMatch[1];
    const grab = (key: string) => {
      const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "im");
      const m = inside.match(re);
      return m ? m[1].trim() : "";
    };
    const title = grab("title");
    if (title) {
      const lines: string[] = [];
      const businessGoal = grab("business_goal") || grab("businessGoal");
      const currentWorkaround = grab("current_workaround") || grab("currentWorkaround");
      const proposedApproach = grab("proposed_approach") || grab("proposedApproach");
      const relatedModule = grab("related_module") || grab("relatedModule");
      const complexity = grab("estimated_complexity") || grab("complexity");
      const notes = grab("notes");
      if (businessGoal) lines.push(`**Business goal:** ${businessGoal}`);
      if (currentWorkaround) lines.push(`**Current workaround:** ${currentWorkaround}`);
      if (proposedApproach) lines.push(`**Proposed approach:** ${proposedApproach}`);
      if (relatedModule) lines.push(`**Related module:** ${relatedModule}`);
      if (complexity) lines.push(`**Estimated complexity:** ${complexity}`);
      if (notes) lines.push(`**Notes:** ${notes}`);
      const priorityRaw = (grab("priority") || "medium").toLowerCase();
      const validPriorities = ["low", "medium", "high", "urgent"];
      const priority = validPriorities.includes(priorityRaw) ? priorityRaw : "medium";
      const cleanText = text.replace(BRD_REGEX, "").replace(/```\s*```/g, "").trim();
      return {
        cleanText,
        request: {
          title: title.slice(0, 200),
          description: lines.join("\n"),
          category: "brd",
          priority,
        },
      };
    }
  }

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

  const validCategories = ["feature", "bug", "question", "config", "meeting", "other", "brd"];
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

  // 2) Load skill text. Phase 20: when agentMode === 'eliana', load BA skills
  // (category "eliana" — falls back to "ba", then arima if neither exists).
  const agentMode = args.agentMode || "arima";
  let arimaSkill = "";
  try {
    const skillCategories = agentMode === "eliana"
      ? ["eliana", "ba", "arima"]   // Eliana prompt, BA prompt as fallback, then ARIMA as last-ditch
      : ["arima"];
    for (const cat of skillCategories) {
      const skills = await db
        .select()
        .from(skillsTable)
        .where(and(eq(skillsTable.category, cat), eq(skillsTable.isActive, true)))
        .orderBy(desc(skillsTable.updatedAt));
      if (skills.length > 0) {
        arimaSkill = skills.map(s => s.content).join("\n\n---\n\n");
        break;
      }
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

  // Phase 20: inject the shared Knowledge Repository so the agent has the
  // latest Tarkie playbook, module catalog, and what's-new feed in every reply.
  try {
    const { buildAgentKnowledgeContext } = await import("@/lib/knowledge");
    const knowledgeContext = await buildAgentKnowledgeContext(agentMode);
    if (knowledgeContext) {
      baseInstruction += `\n\n---\n\n${knowledgeContext}`;
    }
  } catch (e) {
    console.warn("[arima/runtime] knowledge context load failed:", e);
  }

  // Phase 20.2 hotfix: enforce the agent's persona name in the prompt. Without
  // this, the model sometimes introduces itself as "ARIMA" even when the BA
  // skill is loaded (because every prior session example mentions ARIMA by
  // name and the model defaults to that label).
  const personaName = agentMode === "eliana" ? "Eliana" : "ARIMA";
  baseInstruction += `\n\n---\n\n## YOUR NAME IS ${personaName.toUpperCase()}\n\nYou are **${personaName}**. Always introduce yourself as ${personaName}, never as the other name. When greeting someone for the first time, say "I'm ${personaName}". Never refer to yourself as the other agent (ARIMA or Eliana) — they are separate teammates. If someone asks who you are, the answer is "${personaName}".`;

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
    toolPreamble = `\n\n---\n\n## AVAILABLE TOOLS — HOW TO ACTUALLY CALL THEM

You have these callable functions:

${list}

**CRITICAL — what is and isn't a tool call:**

A tool call ONLY counts when you emit a proper function-call structure (the system handles that automatically when you decide to invoke a function). Writing a tool name in your visible reply text is NOT a tool call. The following are ALL FAKE — they do nothing:

- Writing \`(create_request)\` or \`(notify_internal_team)\` in your message
- Typing "I'll call create_request" or "Using notify_internal_team"
- Listing a tool name in parentheses to "show your work"
- Putting tool names in code blocks like \`\`\`create_request\`\`\`

If you do any of these, the action did NOT happen. The user will be misled. Trust will break.

**The correct flow:**

1. User asks for an action
2. You decide whether a tool matches → either call it (real function call) or capture as a request
3. The tool either succeeds or fails — you get the result back
4. ONLY THEN can you confirm what happened in plain language

**FORBIDDEN claims unless the corresponding tool actually returned success this turn:**

- "I've logged your request" — only OK if create_request succeeded
- "I've notified the team" / "I'll notify the team" — only OK if notify_internal_team succeeded
- "I've scheduled the meeting" — only OK if schedule_meeting succeeded
- "I've sent the email/invite" — only OK if a real send tool ran
- "Your request has been notified to our internal team" — only OK if notify_internal_team succeeded

**If you cannot call a tool (it's disabled, requires approval, or doesn't exist):**

Do NOT type its name. Do NOT claim it ran. Say honestly: "I've flagged this for the team — they'll follow up shortly." Then call \`create_request\` to actually create the record.

**For an action that requires structured capture (BRD, feature request, bug, etc.):**

Call \`create_request\` with the right category. The tool MUST be invoked through the function-call mechanism, not by typing its name. After it returns success, you may say "Noted — the team will follow up."

If you find yourself about to type a tool name in your reply, STOP and ask: "am I actually invoking this tool through the function-call mechanism?" If the answer is no, do not type the name and do not describe the action as having happened.`;
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
      senderName: personaName,
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
  // Track which tools actually succeeded this turn so we can verify the
  // model's claims after the loop (catches "I've notified the team" when no
  // notify_internal_team call actually happened).
  const successfulToolNames = new Set<string>();
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
        if (exec.ok) successfulToolNames.add(call.name);
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

  // Strip self-prefix the model sometimes adds ("[ARIMA]: ...", "ARIMA: ...")
  // because it mimics the "[Name]:" speaker labels we use in conversation history.
  replyText = stripSelfPrefix(replyText, personaName);

  // Post-process safety net: strip tool-call narration even if the model ignores
  // the system-prompt rule. Removes triple-backtick blocks whose label is a known
  // tool name, and common filler phrases like "I'll now use X" / "Let me check
  // the result". This is plumbing — the client never needs to see it.
  replyText = scrubToolNarration(replyText, toolDefs);

  // PHANTOM-ACTION GUARD: catch the model claiming actions it did NOT actually
  // perform. If the visible reply asserts "I've logged/notified/scheduled/sent"
  // but no corresponding tool actually succeeded this turn, rewrite the claim
  // honestly. This is the third defense layer (after prompt + scrubbing).
  replyText = guardPhantomClaims(replyText, successfulToolNames);

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
    senderName: personaName,
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
