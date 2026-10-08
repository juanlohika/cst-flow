/**
 * Token-budget throttle for rate-limited AI providers.
 *
 * WHY THIS EXISTS
 * ---------------
 * Groq's free tier caps prompt + completion at 8,000 tokens per minute. Before
 * this module, `src/lib/ai.ts` protected against a single oversized call (via
 * `max_tokens`) but nothing stopped ten calls inside one minute — which is
 * exactly what reading a batch of screenshots does. The eleventh call threw a
 * 429 and the work was simply lost.
 *
 * The rule here is: a burst must get SLOWER, never fail. Callers queue; the
 * drain paces itself against the real budget and waits when the window is full.
 *
 * WHY IT LIVES IN THE CORE
 * ------------------------
 * Every provider call in this app passes through `src/lib/ai.ts`. Putting the
 * budget here means no feature can bypass it by forgetting to opt in — a new
 * caller is protected on the day it is written.
 *
 * IMPORTANT — SINGLE INSTANCE ONLY
 * --------------------------------
 * The budget is in-process memory. On Firebase App Hosting a second container
 * has its own counter, so two containers can together exceed the limit. That is
 * acceptable here because the real guard is `reserve()` reading Groq's own
 * `x-ratelimit-remaining-tokens` header after the first response: once the
 * provider tells us what is actually left, we stop guessing. A distributed
 * budget (Turso row + transaction) is the upgrade if this ever runs hot on
 * multiple containers.
 */

/** A provider's limits. Tokens-per-minute is the one that actually bites. */
export interface RateLimitProfile {
  /** Human label for logs. */
  name: string;
  /** Tokens per minute. Prompt + completion combined. */
  tokensPerMinute: number;
  /** Requests per minute, if the provider caps it. 0 = uncapped. */
  requestsPerMinute: number;
  /**
   * Fraction of the limit we actually spend, leaving room for our own
   * estimation error. 0.85 means we aim to use 85% of the stated cap.
   */
  safetyFactor: number;
}

/**
 * Groq free tier, verified against the documented limits. The 8,000 TPM figure
 * is the one already noted in `src/lib/ai.ts`.
 *
 * safetyFactor is deliberately 0.80 rather than something tighter: our token
 * estimate for an image is a rough heuristic (see `estimateImageTokens`), and
 * underestimating an image is the easiest way to blow the window.
 */
export const GROQ_FREE: RateLimitProfile = {
  name: "groq-free",
  tokensPerMinute: 8000,
  requestsPerMinute: 30,
  safetyFactor: 0.8,
};

/** Generous profile for providers we pay for — effectively no local throttle. */
export const UNTHROTTLED: RateLimitProfile = {
  name: "unthrottled",
  tokensPerMinute: Number.MAX_SAFE_INTEGER,
  requestsPerMinute: 0,
  safetyFactor: 1,
};

const WINDOW_MS = 60_000;

interface Spend {
  at: number;
  tokens: number;
}

class TokenBudget {
  private spends: Spend[] = [];
  /** Set from the provider's own headers once we have seen a response. */
  private reportedRemaining: number | null = null;
  private reportedResetAt: number | null = null;
  /** Serialises reservations so two callers cannot both think there is room. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private profile: RateLimitProfile) {}

  /** Drop spends that have aged out of the rolling window. */
  private prune(now: number) {
    const cutoff = now - WINDOW_MS;
    while (this.spends.length && this.spends[0].at < cutoff) this.spends.shift();
  }

  private usedInWindow(now: number): number {
    this.prune(now);
    return this.spends.reduce((sum, s) => sum + s.tokens, 0);
  }

  private get ceiling(): number {
    return Math.floor(this.profile.tokensPerMinute * this.profile.safetyFactor);
  }

  /**
   * How long to wait before `tokens` would fit.
   *
   * Prefers the provider's own reported headroom when we have it, because our
   * estimate is only a guess. Falls back to our local ledger otherwise.
   */
  private waitFor(tokens: number, now: number): number {
    // Provider told us it is out and when it resets — trust that over our maths.
    if (this.reportedRemaining !== null && this.reportedResetAt !== null) {
      if (this.reportedRemaining >= tokens) return 0;
      if (now < this.reportedResetAt) return this.reportedResetAt - now;
      // Window has rolled over; the reported figure is stale.
      this.reportedRemaining = null;
      this.reportedResetAt = null;
    }

    const used = this.usedInWindow(now);
    if (used + tokens <= this.ceiling) return 0;

    // Wait until enough of the oldest spend ages out to make room.
    let freed = 0;
    const need = used + tokens - this.ceiling;
    for (const s of this.spends) {
      freed += s.tokens;
      if (freed >= need) return Math.max(0, s.at + WINDOW_MS - now);
    }
    // Even an empty window cannot fit this call. Wait a full window and let it
    // through — a single call larger than the cap is the caller's problem, and
    // blocking forever would be worse than one 429.
    return WINDOW_MS;
  }

  /**
   * Wait until `estimatedTokens` fits in the current window, then record the
   * spend. Reservations are serialised, so concurrent callers queue rather than
   * racing on a stale reading.
   */
  async reserve(estimatedTokens: number): Promise<void> {
    const run = this.chain.then(async () => {
      const now = Date.now();
      const wait = this.waitFor(estimatedTokens, now);
      if (wait > 0) {
        console.log(
          `[throttle:${this.profile.name}] window full — holding ${Math.ceil(wait / 1000)}s ` +
            `before a ~${estimatedTokens} token call`
        );
        await sleep(wait);
      }
      this.spends.push({ at: Date.now(), tokens: estimatedTokens });
      if (this.reportedRemaining !== null) {
        this.reportedRemaining = Math.max(0, this.reportedRemaining - estimatedTokens);
      }
    });
    // Keep the chain alive even if one reservation throws.
    this.chain = run.catch(() => {});
    return run;
  }

  /**
   * Correct the ledger once the provider reports real usage, and absorb its
   * rate-limit headers. Call this after every response.
   */
  observe(opts: {
    actualTokens?: number | null;
    estimatedTokens?: number | null;
    remainingTokens?: number | null;
    resetMs?: number | null;
  }) {
    const { actualTokens, estimatedTokens, remainingTokens, resetMs } = opts;

    // Replace our estimate with the truth so the window stays accurate.
    if (actualTokens != null && estimatedTokens != null && this.spends.length) {
      const last = this.spends[this.spends.length - 1];
      if (last.tokens === estimatedTokens) last.tokens = actualTokens;
    }
    if (remainingTokens != null) this.reportedRemaining = remainingTokens;
    if (resetMs != null) this.reportedResetAt = Date.now() + resetMs;
  }

  /** Current state, for the admin diagnostics page. */
  snapshot() {
    const now = Date.now();
    const used = this.usedInWindow(now);
    return {
      provider: this.profile.name,
      limitPerMinute: this.profile.tokensPerMinute,
      ceiling: this.ceiling,
      usedInWindow: used,
      headroom: Math.max(0, this.ceiling - used),
      callsInWindow: this.spends.length,
      providerReportedRemaining: this.reportedRemaining,
    };
  }
}

const budgets = new Map<string, TokenBudget>();

export function budgetFor(profile: RateLimitProfile): TokenBudget {
  let b = budgets.get(profile.name);
  if (!b) {
    b = new TokenBudget(profile);
    budgets.set(profile.name, b);
  }
  return b;
}

/** Every live budget, for the admin page. */
export function allBudgetSnapshots() {
  return Array.from(budgets.values()).map((b) => b.snapshot());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Estimation ───────────────────────────────────────────────────────────────

/**
 * Rough token count for text. ~4 characters per token is the usual rule of
 * thumb for English; Taglish runs a little denser, so this errs slightly high,
 * which is the safe direction.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.6);
}

/**
 * Rough token count for an image.
 *
 * Vision models bill by tiles, not bytes, so file size is a poor proxy — but it
 * is what we have before the call. A 1024x1024 image is commonly ~1,100–1,600
 * tokens. We assume a typical phone screenshot costs ~1,600 and scale mildly
 * with byte size, capped so one large PNG cannot claim the whole window.
 *
 * Deliberately pessimistic: underestimating an image is how the window blows.
 */
export function estimateImageTokens(bytes: number): number {
  const base = 1600;
  const scaled = Math.ceil(base * Math.min(2.5, Math.max(1, bytes / 400_000)));
  return Math.min(4000, scaled);
}

/** Total estimate for a call with a prompt and optional images. */
export function estimateCallTokens(args: {
  promptChars?: number;
  imageBytes?: number[];
  expectedOutputTokens?: number;
}): number {
  const prompt = estimateTextTokens("x".repeat(args.promptChars || 0));
  const images = (args.imageBytes || []).reduce((s, b) => s + estimateImageTokens(b), 0);
  const out = args.expectedOutputTokens ?? 800;
  return prompt + images + out;
}

// ─── 429 handling ─────────────────────────────────────────────────────────────

/** Pull rate-limit facts out of a provider error or response headers. */
export function readRateLimitHeaders(headers: any): {
  remainingTokens: number | null;
  resetMs: number | null;
  retryAfterMs: number | null;
} {
  const get = (k: string): string | null => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(k);
    return headers[k] ?? headers[k.toLowerCase()] ?? null;
  };
  const remaining = get("x-ratelimit-remaining-tokens");
  const reset = get("x-ratelimit-reset-tokens");
  const retry = get("retry-after");
  return {
    remainingTokens: remaining != null ? Number(remaining) : null,
    resetMs: reset != null ? parseDuration(reset) : null,
    retryAfterMs: retry != null ? parseDuration(retry) : null,
  };
}

/** Groq returns durations like "7.66s", "1m30s" or a bare seconds count. */
function parseDuration(v: string): number | null {
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.ceil(parseFloat(s) * 1000);
  const m = s.match(/(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?/);
  if (!m) return null;
  const mins = m[1] ? parseFloat(m[1]) : 0;
  const secs = m[2] ? parseFloat(m[2]) : 0;
  const ms = m[3] ? parseFloat(m[3]) : 0;
  const total = mins * 60_000 + secs * 1000 + ms;
  return total > 0 ? Math.ceil(total) : null;
}

export function isRateLimitError(err: any): boolean {
  const status = err?.status ?? err?.response?.status ?? err?.code;
  if (status === 429 || status === "429") return true;
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests");
}

/**
 * Run `fn` under the budget, waiting out any 429 the provider still returns.
 *
 * The budget prevents most 429s; this catches the rest — another container, a
 * limit we misread, an estimate that was too low. We honour `retry-after`
 * exactly rather than guessing with exponential backoff: guessing either wastes
 * time or walks straight back into the wall.
 */
export async function withBudget<T>(
  profile: RateLimitProfile,
  estimatedTokens: number,
  fn: () => Promise<T>,
  opts: { maxRetries?: number; label?: string } = {}
): Promise<T> {
  const budget = budgetFor(profile);
  const maxRetries = opts.maxRetries ?? 3;
  const label = opts.label || "call";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await budget.reserve(estimatedTokens);
    try {
      const result = await fn();
      // Absorb whatever the provider told us about the real cost.
      const anyResult = result as any;
      const usage = anyResult?.usage || anyResult?.response?.usage;
      const headers = anyResult?.response?.headers || anyResult?.headers;
      budget.observe({
        actualTokens: usage?.total_tokens ?? null,
        estimatedTokens,
        ...(headers ? readRateLimitHeaders(headers) : {}),
      });
      return result;
    } catch (err: any) {
      if (!isRateLimitError(err) || attempt === maxRetries) throw err;
      const { retryAfterMs, resetMs, remainingTokens } = readRateLimitHeaders(
        err?.headers || err?.response?.headers
      );
      budget.observe({ remainingTokens, resetMs });
      // Provider's own figure first; otherwise wait out the rest of the window.
      const wait = retryAfterMs ?? resetMs ?? WINDOW_MS;
      console.warn(
        `[throttle:${profile.name}] 429 on ${label} (attempt ${attempt + 1}/${maxRetries}) — ` +
          `waiting ${Math.ceil(wait / 1000)}s`
      );
      await sleep(wait);
    }
  }
  throw new Error("unreachable");
}
