/**
 * Tier → courtesy-call frequency mapping. Stored as a JSON document under
 * GlobalSettings.key = "ACCOUNT_TIER_FREQUENCY". Admins edit it via
 * /admin/account-tiers. Per-account `frequencyOverride` wins when set.
 *
 * Frequency labels are free-form strings the admin types, with a canonical
 * set we recognize for compliance calculation:
 *   monthly · every-2-months · every-3-months · quarterly · every-6-months · yearly
 *
 * Compliance is "days since lastCourtesyCall <= frequencyDays(label)".
 */
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const TIER_FREQUENCY_KEY = "ACCOUNT_TIER_FREQUENCY";

export type TierLabel = "VIP" | "1" | "2" | "3" | "4" | "5";
export const TIER_LABELS: TierLabel[] = ["VIP", "1", "2", "3", "4", "5"];

export const DEFAULT_TIER_FREQUENCY: Record<TierLabel, string> = {
  "VIP": "monthly",
  "1": "monthly",
  "2": "monthly",
  "3": "quarterly",
  "4": "quarterly",
  "5": "yearly",
};

const FREQUENCY_TO_DAYS: Record<string, number> = {
  "monthly": 30,
  "every-2-months": 60,
  "every-3-months": 90,
  "quarterly": 90,
  "every-6-months": 180,
  "yearly": 365,
  "every-2-years": 730,
};

export function frequencyToDays(label: string | null | undefined): number | null {
  if (!label) return null;
  const norm = label.toLowerCase().trim();
  return FREQUENCY_TO_DAYS[norm] ?? null;
}

export async function loadTierFrequencyMap(): Promise<Record<TierLabel, string>> {
  try {
    const rows = await db
      .select()
      .from(globalSettings)
      .where(eq(globalSettings.key, TIER_FREQUENCY_KEY))
      .limit(1);
    if (rows[0]?.value) {
      const parsed = JSON.parse(rows[0].value);
      // Merge with defaults so we never have undefined tiers
      return { ...DEFAULT_TIER_FREQUENCY, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_TIER_FREQUENCY };
}

export async function saveTierFrequencyMap(map: Record<TierLabel, string>): Promise<void> {
  const now = new Date().toISOString();
  const value = JSON.stringify(map);
  const existing = await db.select({ id: globalSettings.id }).from(globalSettings).where(eq(globalSettings.key, TIER_FREQUENCY_KEY)).limit(1);
  if (existing.length > 0) {
    await db.update(globalSettings).set({ value, updatedAt: now }).where(eq(globalSettings.id, existing[0].id));
  } else {
    await db.insert(globalSettings).values({
      id: `gs_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      key: TIER_FREQUENCY_KEY,
      value,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Resolve the effective frequency for an account.
 * Priority: account.frequencyOverride > tier-based default.
 */
export function resolveAccountFrequency(args: {
  tier: string | null | undefined;
  frequencyOverride: string | null | undefined;
  tierMap: Record<TierLabel, string>;
}): { label: string; days: number | null; source: "override" | "tier" | "unknown" } {
  if (args.frequencyOverride) {
    return {
      label: args.frequencyOverride,
      days: frequencyToDays(args.frequencyOverride),
      source: "override",
    };
  }
  if (args.tier && TIER_LABELS.includes(args.tier as TierLabel)) {
    const label = args.tierMap[args.tier as TierLabel] || DEFAULT_TIER_FREQUENCY[args.tier as TierLabel];
    return { label, days: frequencyToDays(label), source: "tier" };
  }
  return { label: "—", days: null, source: "unknown" };
}

/**
 * Compute courtesy-call compliance for an account.
 *   - "compliant": daysSince <= maxDays
 *   - "warning":   daysSince > maxDays && daysSince <= maxDays * 1.5
 *   - "overdue":   daysSince > maxDays * 1.5
 *   - "unknown":   no frequency configured OR no last call logged
 */
export function callCompliance(args: {
  lastCourtesyCall: string | null | undefined;
  frequencyDays: number | null;
}): { status: "compliant" | "warning" | "overdue" | "unknown"; daysSince: number | null } {
  if (!args.lastCourtesyCall) return { status: "unknown", daysSince: null };
  if (!args.frequencyDays) {
    return {
      status: "unknown",
      daysSince: daysSinceDate(args.lastCourtesyCall),
    };
  }
  const daysSince = daysSinceDate(args.lastCourtesyCall);
  if (daysSince === null) return { status: "unknown", daysSince: null };
  if (daysSince <= args.frequencyDays) return { status: "compliant", daysSince };
  if (daysSince <= args.frequencyDays * 1.5) return { status: "warning", daysSince };
  return { status: "overdue", daysSince };
}

function daysSinceDate(iso: string): number | null {
  try {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return null;
    return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}

// ─── F2F (face-to-face) visit cadence ──────────────────────────────────────
// F2F has a single org-wide default of once-per-year. Per-account override
// is the only way to vary it (e.g. VIPs visited twice a year, dormant
// accounts every 18 months). No tier-level mapping — kept simple.

export const F2F_DEFAULT_FREQUENCY: string = "yearly";

export function resolveF2FFrequency(args: {
  f2fFrequencyOverride: string | null | undefined;
}): { label: string; days: number | null; source: "override" | "default" } {
  if (args.f2fFrequencyOverride) {
    return {
      label: args.f2fFrequencyOverride,
      days: frequencyToDays(args.f2fFrequencyOverride),
      source: "override",
    };
  }
  return {
    label: F2F_DEFAULT_FREQUENCY,
    days: frequencyToDays(F2F_DEFAULT_FREQUENCY),
    source: "default",
  };
}

/**
 * F2F compliance is more lenient than CC:
 *   - "compliant": daysSince <= maxDays
 *   - "warning":   daysSince > maxDays && daysSince <= maxDays * 1.5
 *   - "overdue":   daysSince > maxDays * 1.5
 *   - "unknown":   no F2F visit ever logged
 */
export function f2fCompliance(args: {
  lastF2FVisit: string | null | undefined;
  frequencyDays: number | null;
}): { status: "compliant" | "warning" | "overdue" | "unknown"; daysSince: number | null } {
  if (!args.lastF2FVisit) return { status: "unknown", daysSince: null };
  if (!args.frequencyDays) {
    return {
      status: "unknown",
      daysSince: daysSinceDate(args.lastF2FVisit),
    };
  }
  const daysSince = daysSinceDate(args.lastF2FVisit);
  if (daysSince === null) return { status: "unknown", daysSince: null };
  if (daysSince <= args.frequencyDays) return { status: "compliant", daysSince };
  if (daysSince <= args.frequencyDays * 1.5) return { status: "warning", daysSince };
  return { status: "overdue", daysSince };
}
