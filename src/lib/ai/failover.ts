/**
 * Provider failover and error suppression.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-10-09 a bound Telegram group received 48 identical error messages.
 * Gemini was returning 503 "high demand", and three separate faults compounded:
 *
 *   1. NO CROSS-PROVIDER FAILOVER. `generateWithRetry` retried Gemini three
 *      times and then threw. The `fallbackModel` path existed only for Claude
 *      billing errors, so a Gemini outage took the agent down even though Groq
 *      and Ollama were configured and healthy.
 *
 *   2. NO MEMORY BETWEEN MESSAGES. Every inbound message repeated the full
 *      retry sequence from scratch. With a provider that is down, that is ~27
 *      seconds of retries per message, every message, indefinitely.
 *
 *   3. THE RAW ERROR WAS SENT TO THE USER. Each failure posted the provider
 *      URL, model id and stack-ish text into a client-facing group. Forty-eight
 *      times.
 *
 * WHAT THIS MODULE ADDS
 * ---------------------
 *   · An ordered failover chain, so one provider being down is survivable.
 *   · A short-lived circuit breaker per provider, so a known-down provider is
 *     skipped rather than retried on every message.
 *   · A per-conversation notice cooldown, so a user is told once that something
 *     is wrong, not once per message.
 *
 * DESIGN NOTE — WHY IN-MEMORY
 * ---------------------------
 * Both the breaker and the cooldown are process-local. On App Hosting a second
 * container has its own copy, so in the worst case a user sees one notice per
 * container rather than one in total. That is an acceptable trade for not
 * adding a database write to every failed turn; the failure mode it prevents
 * (48 messages) is three orders of magnitude worse than the one it leaves (2-3).
 */

export type ProviderName = "claude" | "gemini" | "groq" | "ollama";

/** How long a provider stays "open" (skipped) after repeated failures. */
const BREAKER_MS = 3 * 60_000;
/** Consecutive failures before a provider is considered down. */
const BREAKER_THRESHOLD = 2;
/**
 * Minimum gap between user-visible error notices in one conversation.
 *
 * Raised from 10 to 45 minutes on 2026-10-09: with a 10-minute window a group
 * still received a notice every 10-12 minutes through a sustained outage, which
 * reads as spam even though each one was technically within policy. During an
 * outage the useful number of notices is one.
 */
const NOTICE_COOLDOWN_MS = 45 * 60_000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
  lastError: string | null;
}

const breakers = new Map<ProviderName, BreakerState>();
const noticeSentAt = new Map<string, number>();

function state(p: ProviderName): BreakerState {
  let s = breakers.get(p);
  if (!s) { s = { failures: 0, openedAt: null, lastError: null }; breakers.set(p, s); }
  return s;
}

/** True when a provider is currently being skipped. */
export function isProviderDown(p: ProviderName): boolean {
  const s = state(p);
  if (s.openedAt === null) return false;
  if (Date.now() - s.openedAt > BREAKER_MS) {
    // Cooldown elapsed — let one request through to test the water.
    s.openedAt = null; s.failures = 0;
    return false;
  }
  return true;
}

export function recordProviderFailure(p: ProviderName, err: any) {
  const s = state(p);
  s.failures += 1;
  s.lastError = err?.message ? String(err.message).slice(0, 200) : "unknown";
  if (s.failures >= BREAKER_THRESHOLD && s.openedAt === null) {
    s.openedAt = Date.now();
    console.warn(
      `[failover] ${p} marked down after ${s.failures} failures — ` +
        `skipping for ${BREAKER_MS / 60000} min. Last: ${s.lastError}`
    );
  }
}

export function recordProviderSuccess(p: ProviderName) {
  const s = state(p);
  if (s.failures || s.openedAt) console.log(`[failover] ${p} recovered`);
  s.failures = 0; s.openedAt = null; s.lastError = null;
}

/**
 * Should we post a user-visible error notice for this conversation?
 *
 * Returns true at most once per cooldown window. Everything else fails
 * silently to the user and loudly to the logs — which is the right balance for
 * a group chat full of people who cannot act on a provider outage.
 */
export function shouldNotifyError(conversationKey: string): boolean {
  const last = noticeSentAt.get(conversationKey);
  const now = Date.now();
  if (last && now - last < NOTICE_COOLDOWN_MS) return false;
  noticeSentAt.set(conversationKey, now);
  return true;
}

/**
 * Durable version of the check above.
 *
 * The in-memory map is per-container. App Hosting starts fresh containers
 * freely, so on 2026-10-09 a group still received a notice every ten minutes
 * through an outage: each new container had an empty map and believed it was
 * the first to report. The timestamp now lives in GlobalSetting so every
 * container sees the same last-notified time.
 *
 * Falls back to the in-memory check if the write fails — a notice getting
 * through is better than an exception swallowing the error path entirely.
 */
export async function shouldNotifyErrorDurable(conversationKey: string): Promise<boolean> {
  const key = `ai_error_notice:${conversationKey}`;
  try {
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const res: any = await db.run(
      sql`SELECT value FROM GlobalSetting WHERE key = ${key} LIMIT 1`);
    const prev = res?.rows?.[0]?.value;
    const now = Date.now();
    if (prev && now - Number(prev) < NOTICE_COOLDOWN_MS) return false;
    await db.run(sql`
      INSERT INTO GlobalSetting (id, key, value)
      VALUES (${"gs_" + key}, ${key}, ${String(now)})
      ON CONFLICT(key) DO UPDATE SET value = ${String(now)}`);
    return true;
  } catch (e: any) {
    console.warn("[failover] durable notice check failed, using memory:", e?.message);
    return shouldNotifyError(conversationKey);
  }
}

/** For the admin diagnostics view. */
export function failoverSnapshot() {
  return Array.from(breakers.entries()).map(([p, s]) => ({
    provider: p,
    down: isProviderDown(p),
    failures: s.failures,
    openedAt: s.openedAt ? new Date(s.openedAt).toISOString() : null,
    lastError: s.lastError,
  }));
}

/**
 * Classify an error so the caller knows whether another provider would help.
 *
 * A capacity or outage error is worth failing over. A bad request or a missing
 * key is not — the next provider would fail the same way, or worse, succeed and
 * hide a configuration problem.
 */
export function isTransientProviderError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  const msg = String(err?.message || "").toLowerCase();
  if (status === 503 || status === 529 || status === 502 || status === 504) return true;
  if (status === 429) return true;
  return (
    msg.includes("high demand") ||
    msg.includes("service unavailable") ||
    msg.includes("overload") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

/**
 * The order providers are tried in, starting from whichever one is configured
 * as primary. Only providers with credentials are included.
 */
export function failoverOrder(primary: ProviderName, available: ProviderName[]): ProviderName[] {
  // Preference after the primary: Groq (fast, free tier), Gemini, Claude,
  // Ollama last because it is local and may not be reachable from the host.
  const preference: ProviderName[] = ["groq", "gemini", "claude", "ollama"];
  const rest = preference.filter((p) => p !== primary && available.includes(p));
  return [primary, ...rest].filter((p) => available.includes(p));
}

/** A short, non-technical line for the user when everything is down. */
export function userFacingOutageMessage(): string {
  return (
    "I'm having trouble reaching the AI service right now, so I can't answer this one. " +
    "This is usually temporary. A teammate will pick it up if it's urgent."
  );
}

/**
 * True when every configured provider is currently circuit-broken, or when any
 * provider has failed recently enough that the next turn is likely to fail too.
 *
 * Used by the reply gates to stop an outage from amplifying into a reply on
 * every inbound message.
 */
export function isProviderOutageActive(): boolean {
  if (breakers.size === 0) return false;
  return Array.from(breakers.keys()).some((p) => isProviderDown(p));
}

// ── Outbound circuit breaker ─────────────────────────────────────────────────
//
// The cooldowns above each guard one code path. Twice now a path was missed —
// first the 429 that never reached the retry block, then the empty-reply branch
// that returns before the catch — and each time a group received a stream of
// messages. This is the backstop: a hard cap on how many messages the bot may
// send into one chat in a window, whatever the reason.
//
// It is deliberately generous. A real conversation with a dozen quick replies
// is fine; what it stops is the runaway case where one broken turn repeats
// unattended. If it ever trips during legitimate use, the limit is wrong and
// should be raised — it is not a rate limit on people, it is a fuse.

const OUTBOUND_WINDOW_MS = 10 * 60_000;
const OUTBOUND_MAX = 12;

const outbound = new Map<string, number[]>();

/**
 * Record an outbound message and report whether the chat has gone over its
 * cap. Returns true when the message should be SUPPRESSED.
 */
export function outboundFuseTripped(chatKey: string): boolean {
  const now = Date.now();
  const arr = (outbound.get(chatKey) || []).filter((t) => now - t < OUTBOUND_WINDOW_MS);
  if (arr.length >= OUTBOUND_MAX) {
    outbound.set(chatKey, arr);
    console.error(
      `[failover] OUTBOUND FUSE: ${chatKey} has had ${arr.length} messages in ` +
        `${OUTBOUND_WINDOW_MS / 60000} min — suppressing further sends. ` +
        "If this was legitimate traffic, raise OUTBOUND_MAX."
    );
    return true;
  }
  arr.push(now);
  outbound.set(chatKey, arr);
  return false;
}

export function outboundSnapshot() {
  const now = Date.now();
  return Array.from(outbound.entries()).map(([k, v]) => ({
    chat: k,
    inWindow: v.filter((t) => now - t < OUTBOUND_WINDOW_MS).length,
    cap: OUTBOUND_MAX,
  }));
}

// ── Telegram update de-duplication ───────────────────────────────────────────
//
// Telegram REDELIVERS an update when the webhook does not return 200 quickly
// enough, and keeps redelivering until it does. The webhook awaits the whole
// AI turn before responding — model call, retries, tool calls — so any slow
// turn gets delivered two, three, five times. Each delivery is processed as a
// fresh message, which is why a group saw the same old message answered over
// and over, each reply quoting it and saying "I've already flagged this".
//
// Every update carries a monotonically increasing update_id. Seeing one twice
// means a redelivery, never a new message. Processing stops there.
//
// In-memory and per-container: a redelivery landing on a different container
// still gets through. That is a far smaller leak than the current behaviour,
// and the real fix — responding 200 before doing the work — is a larger change
// to how the webhook is structured.

const SEEN_UPDATE_TTL_MS = 10 * 60_000;
const seenUpdates = new Map<number, number>();

/** True when this update_id has already been processed — caller should stop. */
export function isDuplicateUpdate(updateId: number | undefined | null): boolean {
  if (typeof updateId !== "number") return false;
  const now = Date.now();
  // Opportunistic prune so the map cannot grow without bound.
  if (seenUpdates.size > 500) {
    for (const [id, t] of Array.from(seenUpdates.entries())) {
      if (now - t > SEEN_UPDATE_TTL_MS) seenUpdates.delete(id);
    }
  }
  const prev = seenUpdates.get(updateId);
  if (prev !== undefined && now - prev < SEEN_UPDATE_TTL_MS) {
    console.warn(`[telegram] duplicate update_id ${updateId} — Telegram redelivered, skipping`);
    return true;
  }
  seenUpdates.set(updateId, now);
  return false;
}
