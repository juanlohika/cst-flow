/**
 * Geocoding quota tracker — Pin Validator
 *
 * Why this exists:
 *   Google Maps Geocoding API gives a $200/month free credit, which works out
 *   to ~40,000 free geocodes per month. CST OS team-wide usage should never
 *   exceed that, so we track and hard-cap. Any internal user can see the
 *   current month's usage from the AI Tools landing page so the whole team
 *   knows how much budget is left.
 *
 * How the cap works:
 *   • 0–34,999 calls       : Geocoding runs normally
 *   • 35,000–39,999 calls  : Warning surfaces in the AI Tools meter and in
 *                            the geocode-trigger dialog. Operation still runs.
 *   • 40,000 calls         : Hard stop. canGeocodeBatch() returns false; the
 *                            geocoder refuses to call Google. Auto-resets
 *                            when the calendar month rolls over.
 *
 * Storage:
 *   One GlobalSetting row per month, keyed by `GOOGLE_GEOCODING_USAGE_YYYY_MM`.
 *   value is the integer count as a string. New months auto-create at 0 on
 *   first read. This keeps history queryable forever (one row per month).
 *
 * Atomicity:
 *   SQLite (Turso) doesn't have row-level locks, so concurrent increments
 *   from parallel geocode batches could theoretically race. In practice the
 *   geocoder runs sequential (rate-limited to ~3 req/sec by the 300ms
 *   throttle), so concurrency is effectively single-writer. If we ever fan
 *   out across batches we'd need a CAS loop.
 */
import { db } from '@/db';
import { globalSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

/** Hard cap — geocoder refuses beyond this. Google's $200 free credit
 * covers about this many calls/month ($5 per 1,000 calls). */
export const MONTHLY_FREE_TIER = 40_000;

/** Threshold at which the UI starts warning users. Operation still runs. */
export const WARNING_THRESHOLD = 35_000;

export interface QuotaState {
  /** YYYY-MM string for the month currently being tracked. */
  monthKey: string;
  /** Successful geocodes counted this month so far. */
  used: number;
  /** Hard cap. */
  limit: number;
  /** Cap remaining (limit - used, floored at 0). */
  remaining: number;
  /** True once `used >= WARNING_THRESHOLD`. */
  warning: boolean;
  /** True once `used >= MONTHLY_FREE_TIER` — geocoder refuses. */
  exhausted: boolean;
  /** ISO date for the first day of the next month (when the counter resets). */
  resetsAt: string;
}

/** YYYY_MM key (e.g. "2026_06") for the current month's counter row. */
function currentMonthSuffix(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}_${m}`;
}

function settingKey(monthSuffix: string): string {
  return `GOOGLE_GEOCODING_USAGE_${monthSuffix}`;
}

function nextMonthIsoDate(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}

/** Read the current month's usage. Returns 0 if no row exists yet. */
export async function getCurrentUsage(): Promise<QuotaState> {
  const monthSuffix = currentMonthSuffix();
  const key = settingKey(monthSuffix);
  const rows = await db
    .select({ value: globalSettings.value })
    .from(globalSettings)
    .where(eq(globalSettings.key, key))
    .limit(1);
  const used = rows[0]?.value ? parseInt(rows[0].value, 10) || 0 : 0;
  return buildState(monthSuffix, used);
}

/** Check whether `n` more geocodes would fit under the cap. */
export async function canGeocodeBatch(n: number): Promise<{ ok: boolean; state: QuotaState; reason?: string }> {
  const state = await getCurrentUsage();
  if (state.exhausted) {
    return {
      ok: false,
      state,
      reason: `Monthly free geocoding limit reached (${state.used.toLocaleString()}/${state.limit.toLocaleString()}). Resets ${state.resetsAt.slice(0, 10)}.`,
    };
  }
  if (state.used + n > state.limit) {
    const fits = state.limit - state.used;
    return {
      ok: false,
      state,
      reason: `This batch (${n.toLocaleString()}) would exceed the free tier. Only ${fits.toLocaleString()} geocodes remaining this month.`,
    };
  }
  return { ok: true, state };
}

/**
 * Increment the counter by `delta` (typically 1 per successful geocode).
 * Returns the new state. Creates the month's row on first call.
 *
 * Concurrent callers can race here — a second caller's read can land
 * between the first caller's read and write. We accept that risk in
 * exchange for SQL simplicity; the geocoder is sequential per batch
 * anyway. If we ever parallelize, swap this for an UPDATE … SET value =
 * CAST(value AS INTEGER) + ? RETURNING * CAS loop.
 */
export async function incrementUsage(delta = 1): Promise<QuotaState> {
  if (delta <= 0) return getCurrentUsage();
  const monthSuffix = currentMonthSuffix();
  const key = settingKey(monthSuffix);
  const now = new Date().toISOString();

  const existing = await db
    .select({ id: globalSettings.id, value: globalSettings.value })
    .from(globalSettings)
    .where(eq(globalSettings.key, key))
    .limit(1);

  if (existing.length > 0) {
    const current = parseInt(existing[0].value, 10) || 0;
    const next = current + delta;
    await db
      .update(globalSettings)
      .set({ value: String(next), updatedAt: now })
      .where(eq(globalSettings.id, existing[0].id));
    return buildState(monthSuffix, next);
  }

  // First call this month — create the row.
  await db.insert(globalSettings).values({
    id: `gs_geo_${monthSuffix}_${Math.random().toString(36).substring(2, 7)}`,
    key,
    value: String(delta),
    createdAt: now,
    updatedAt: now,
  });
  return buildState(monthSuffix, delta);
}

function buildState(monthSuffix: string, used: number): QuotaState {
  const monthKey = monthSuffix.replace('_', '-');
  const remaining = Math.max(0, MONTHLY_FREE_TIER - used);
  return {
    monthKey,
    used,
    limit: MONTHLY_FREE_TIER,
    remaining,
    warning: used >= WARNING_THRESHOLD,
    exhausted: used >= MONTHLY_FREE_TIER,
    resetsAt: nextMonthIsoDate(),
  };
}
