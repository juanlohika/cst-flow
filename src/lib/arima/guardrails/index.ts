/**
 * Guardrails system: structured safety rules that get injected into every
 * ARIMA system prompt, plus runtime pre-checks on user input.
 *
 * The design splits responsibility:
 *  - Rules that affect ARIMA's OUTPUT (forbidden_phrase, required_disclosure,
 *    off_hours_message) get inlined into the system prompt
 *  - Rules that affect ARIMA's INPUT (forbidden_topic, escalation_trigger,
 *    rate_limit) are checked BEFORE we call the model, so we can short-circuit
 *    and respond without burning tokens
 */
import { db } from "@/db";
import { arimaGuardrails } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export type GuardrailType =
  | "forbidden_topic"
  | "forbidden_phrase"
  | "escalation_trigger"
  | "off_hours_message"
  | "rate_limit"
  | "required_disclosure";

export interface Guardrail {
  id: string;
  type: GuardrailType;
  label: string;
  pattern: string;
  description: string | null;
  enabled: boolean;
  isBuiltIn: boolean;
  priority: number;
}

// ─── Loading ─────────────────────────────────────────────────────────────

export async function listGuardrails(opts?: { enabledOnly?: boolean }): Promise<Guardrail[]> {
  try {
    const rows = await db.select().from(arimaGuardrails);
    return rows
      .filter(r => !opts?.enabledOnly || r.enabled)
      .map(r => ({ ...r, description: r.description ?? null })) as Guardrail[];
  } catch (e) {
    console.warn("[guardrails] load failed:", e);
    return [];
  }
}

// ─── Default seed ─────────────────────────────────────────────────────────

const DEFAULT_GUARDRAILS: Array<Omit<Guardrail, "id">> = [
  {
    type: "forbidden_topic",
    label: "Legal advice",
    pattern: "legal,lawyer,lawsuit,attorney,litigation,subpoena,contract dispute",
    description: "Refuse to give legal advice and escalate to a human teammate.",
    enabled: true,
    isBuiltIn: true,
    priority: 10,
  },
  {
    type: "forbidden_topic",
    label: "Refunds / billing disputes",
    pattern: "refund,chargeback,billing dispute,money back,reverse charge,invoice problem",
    description: "Don't promise refunds or discuss billing problems — escalate to finance team.",
    enabled: true,
    isBuiltIn: true,
    priority: 10,
  },
  {
    type: "forbidden_topic",
    label: "Contract renegotiation",
    pattern: "renegotiate,cancel contract,terminate contract,new pricing,discount,downgrade plan",
    description: "Don't commit to contract changes — these go to the human RM.",
    enabled: true,
    isBuiltIn: true,
    priority: 9,
  },
  {
    type: "forbidden_phrase",
    label: "Don't claim phantom actions",
    pattern: "I've booked|I've scheduled|the invite is on its way|the calendar invite has been sent|I've sent the email|I've notified everyone",
    description: "Never claim a side effect happened unless a tool actually executed successfully.",
    enabled: true,
    isBuiltIn: true,
    priority: 8,
  },
  {
    type: "forbidden_phrase",
    label: "Don't invent commercial details",
    pattern: "your discount,your pricing,your special rate,your contract value,your account balance",
    description: "Pricing and contract terms aren't in ARIMA's context — never make them up.",
    enabled: true,
    isBuiltIn: true,
    priority: 8,
  },
  {
    type: "escalation_trigger",
    label: "Urgent / emergency keywords",
    pattern: "urgent,emergency,ASAP,critical,blocker,production down,outage",
    description: "Auto-notify internal team via dispatcher.notify when these appear.",
    enabled: true,
    isBuiltIn: true,
    priority: 7,
  },
  {
    type: "escalation_trigger",
    label: "Complaint signals",
    pattern: "complaint,unhappy,frustrated,disappointed,not working,never works,worst",
    description: "Negative sentiment → ping the team so a human can intervene.",
    enabled: true,
    isBuiltIn: true,
    priority: 7,
  },
  {
    type: "required_disclosure",
    label: "Identify as AI on first message",
    pattern: "On your FIRST message in any new conversation, identify yourself as an AI assistant (e.g. 'Hi, I'm ARIMA — an AI assistant for the CST team').",
    description: "Required transparency — clients must know they're talking to an AI.",
    enabled: true,
    isBuiltIn: true,
    priority: 5,
  },
  {
    type: "required_disclosure",
    label: "Always mention the human RM is available",
    pattern: "When refusing to do something or escalating, always mention that a human teammate will follow up.",
    description: "Reassures clients they aren't being stonewalled.",
    enabled: true,
    isBuiltIn: true,
    priority: 5,
  },
  {
    type: "off_hours_message",
    label: "Business hours (PH timezone)",
    pattern: JSON.stringify({ timezone: "Asia/Manila", startHour: 9, endHour: 18, days: [1,2,3,4,5], outsideMessage: "Thanks for the message! I'll log this and a human teammate will follow up first thing in the morning." }),
    description: "Outside 9am-6pm Mon-Fri Manila time, the AI acknowledges and defers to morning follow-up.",
    enabled: false,
    isBuiltIn: true,
    priority: 4,
  },
  {
    type: "rate_limit",
    label: "Anti-spam: 30 msgs / hour per contact",
    pattern: JSON.stringify({ maxPerHour: 30, scope: "contact" }),
    description: "If a client sends more than 30 messages in an hour, ARIMA pauses and notifies admins.",
    enabled: false,
    isBuiltIn: true,
    priority: 3,
  },
];

export async function seedDefaultGuardrails(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const g of DEFAULT_GUARDRAILS) {
    const existing = await db
      .select({ id: arimaGuardrails.id })
      .from(arimaGuardrails)
      .where(and(eq(arimaGuardrails.type, g.type), eq(arimaGuardrails.label, g.label)))
      .limit(1);

    if (existing[0]) {
      skipped++;
      continue;
    }

    const id = `grd_${g.type}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(arimaGuardrails).values({
      id,
      type: g.type,
      label: g.label,
      pattern: g.pattern,
      description: g.description,
      enabled: g.enabled,
      isBuiltIn: g.isBuiltIn,
      priority: g.priority,
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }
  return { created, skipped };
}

// ─── Prompt injection ──────────────────────────────────────────────────

/**
 * Builds a guardrails block that gets appended to the system prompt.
 * Only output-affecting rules go here (input checks happen separately).
 */
export async function buildGuardrailsPrompt(): Promise<string> {
  const rules = await listGuardrails({ enabledOnly: true });
  if (rules.length === 0) return "";

  const forbiddenPhrases = rules.filter(r => r.type === "forbidden_phrase");
  const requiredDisclosures = rules.filter(r => r.type === "required_disclosure");
  const forbiddenTopics = rules.filter(r => r.type === "forbidden_topic");

  const lines: string[] = [];
  lines.push("## GUARDRAILS (mandatory rules from admin)");
  lines.push("");

  if (forbiddenTopics.length > 0) {
    lines.push("### Topics you MUST refuse + escalate:");
    for (const r of forbiddenTopics) {
      const keywords = r.pattern.split(",").map(k => k.trim()).filter(Boolean);
      lines.push(`- **${r.label}** (e.g. ${keywords.slice(0, 5).join(", ")}): refuse to handle and say "Let me bring in a human teammate to help with this."`);
    }
    lines.push("");
  }

  if (forbiddenPhrases.length > 0) {
    lines.push("### Phrases you must NEVER use:");
    for (const r of forbiddenPhrases) {
      lines.push(`- ${r.label}: ${r.description || ""}`);
    }
    lines.push("");
  }

  if (requiredDisclosures.length > 0) {
    lines.push("### Required behaviors:");
    for (const r of requiredDisclosures) {
      lines.push(`- ${r.pattern}`);
    }
    lines.push("");
  }

  lines.push("These rules override anything else. If any conflict arises, follow the guardrails.");
  return lines.join("\n");
}

// ─── Runtime input checks ──────────────────────────────────────────────

export interface InputCheckResult {
  forbidden: boolean;                              // user is asking about a forbidden topic
  forbiddenTopicLabel?: string;
  escalate: boolean;                               // matched an escalation keyword
  escalationLabel?: string;
  offHoursReply?: string;                          // pre-written reply for off-hours
}

/**
 * Run input-side checks before calling the model. Returns the result
 * so the caller can short-circuit (e.g. refuse a forbidden topic) or
 * augment the response (e.g. add an off-hours notice).
 *
 * Uses simple case-insensitive keyword matching for now — admins can tune
 * the patterns. Future: regex or vector-similarity matching.
 */
export async function checkInputAgainstGuardrails(userMessage: string): Promise<InputCheckResult> {
  const rules = await listGuardrails({ enabledOnly: true });
  const lowerMsg = (userMessage || "").toLowerCase();

  // Topic check (returns immediately for first match)
  for (const r of rules.filter(r => r.type === "forbidden_topic")) {
    const keywords = r.pattern.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.some(k => lowerMsg.includes(k))) {
      return { forbidden: true, forbiddenTopicLabel: r.label, escalate: true, escalationLabel: r.label };
    }
  }

  // Escalation check (don't return immediately — only flags)
  let escalationLabel: string | undefined;
  for (const r of rules.filter(r => r.type === "escalation_trigger")) {
    const keywords = r.pattern.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.some(k => lowerMsg.includes(k))) {
      escalationLabel = r.label;
      break;
    }
  }

  // Off-hours check
  let offHoursReply: string | undefined;
  const offHoursRules = rules.filter(r => r.type === "off_hours_message");
  for (const r of offHoursRules) {
    try {
      const cfg = JSON.parse(r.pattern);
      const tz = cfg.timezone || "Asia/Manila";
      const startHour = cfg.startHour ?? 9;
      const endHour = cfg.endHour ?? 18;
      const days: number[] = cfg.days || [1, 2, 3, 4, 5];

      // Get current hour + day in the configured timezone
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
        weekday: "short",
      });
      const parts = formatter.formatToParts(new Date());
      const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
      const weekday = parts.find(p => p.type === "weekday")?.value || "";
      const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const dayNum = weekdayMap[weekday] ?? -1;

      const inWorkHours = days.includes(dayNum) && hour >= startHour && hour < endHour;
      if (!inWorkHours) {
        offHoursReply = cfg.outsideMessage || "Thanks for the message! A human teammate will follow up in the morning.";
        break;
      }
    } catch {
      // malformed JSON — skip this rule
    }
  }

  return {
    forbidden: false,
    escalate: !!escalationLabel,
    escalationLabel,
    offHoursReply,
  };
}
