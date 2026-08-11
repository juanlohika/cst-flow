/**
 * Which tier APPLIED on a given date — and therefore which courtesy-call
 * cadence a past period should be judged against.
 *
 * Without this, ClientProfile.tier is a single mutable field and promoting an
 * account from 3 to 1 silently rewrites its history: last quarter becomes
 * "should have been monthly" and the RM's past score changes retroactively.
 * Tier reviews happen quarterly, so this is a routine event, not an edge case.
 */
import { db } from "@/db";
import { accountTierHistory, clientProfiles } from "@/db/schema";
import { and, eq, desc, isNull, lte, or, gte, sql } from "drizzle-orm";

export type TierInterval = {
  tier: string;
  frequencyOverride: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

/** Full history for an account, oldest first. */
export async function tierIntervals(accountId: string): Promise<TierInterval[]> {
  const rows = await db
    .select({
      tier: accountTierHistory.tier,
      frequencyOverride: accountTierHistory.frequencyOverride,
      effectiveFrom: accountTierHistory.effectiveFrom,
      effectiveTo: accountTierHistory.effectiveTo,
    })
    .from(accountTierHistory)
    .where(eq(accountTierHistory.clientProfileId, accountId))
    .orderBy(accountTierHistory.effectiveFrom);
  return rows;
}

/**
 * The tier in force on `date`. Falls back to the account's current tier when
 * history does not cover that date (e.g. a date before the seed), so callers
 * always get an answer rather than a hole.
 */
export async function tierOn(accountId: string, date: string): Promise<{
  tier: string | null;
  frequencyOverride: string | null;
  source: "history" | "current" | "none";
}> {
  const rows = await db
    .select({
      tier: accountTierHistory.tier,
      frequencyOverride: accountTierHistory.frequencyOverride,
    })
    .from(accountTierHistory)
    .where(and(
      eq(accountTierHistory.clientProfileId, accountId),
      lte(accountTierHistory.effectiveFrom, date),
      or(isNull(accountTierHistory.effectiveTo), gte(accountTierHistory.effectiveTo, date)),
    ))
    .orderBy(desc(accountTierHistory.effectiveFrom))
    .limit(1);

  if (rows[0]) return { ...rows[0], source: "history" };

  const cur = await db
    .select({ tier: clientProfiles.tier, frequencyOverride: clientProfiles.frequencyOverride })
    .from(clientProfiles).where(eq(clientProfiles.id, accountId)).limit(1);
  if (cur[0]?.tier) return { ...cur[0], source: "current" };
  return { tier: null, frequencyOverride: null, source: "none" };
}

/**
 * Record a tier movement: close the currently-open interval the day before the
 * new one starts, then open the new one. Idempotent for a same-tier no-op.
 */
export async function recordTierChange(args: {
  accountId: string;
  tier: string;
  frequencyOverride?: string | null;
  effectiveFrom: string;              // YYYY-MM-DD — usually the 1st of a quarter
  reason?: string | null;
  changedByUserId?: string | null;
}): Promise<{ ok: boolean; changed: boolean; note?: string }> {
  const open = await db
    .select()
    .from(accountTierHistory)
    .where(and(
      eq(accountTierHistory.clientProfileId, args.accountId),
      isNull(accountTierHistory.effectiveTo),
    ))
    .orderBy(desc(accountTierHistory.effectiveFrom))
    .limit(1);

  const cur = open[0];
  if (cur && cur.tier === args.tier
      && (cur.frequencyOverride || null) === (args.frequencyOverride || null)) {
    return { ok: true, changed: false, note: "Tier is unchanged — nothing recorded." };
  }
  if (cur && args.effectiveFrom <= cur.effectiveFrom) {
    return {
      ok: false, changed: false,
      note: `The new tier must start after the current interval began (${cur.effectiveFrom}).`,
    };
  }

  const dayBefore = new Date(Date.parse(args.effectiveFrom) - 86400000)
    .toISOString().slice(0, 10);

  if (cur) {
    await db.update(accountTierHistory)
      .set({ effectiveTo: dayBefore } as any)
      .where(eq(accountTierHistory.id, cur.id));
  }

  await db.insert(accountTierHistory).values({
    id: `ath_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    clientProfileId: args.accountId,
    tier: args.tier,
    frequencyOverride: args.frequencyOverride ?? null,
    effectiveFrom: args.effectiveFrom,
    effectiveTo: null,
    reason: args.reason ?? null,
    changedByUserId: args.changedByUserId ?? null,
    createdAt: new Date().toISOString(),
  } as any);

  // Keep the denormalised field on ClientProfile in step — lots of existing
  // screens read it — but history remains the source of truth for PAST dates.
  await db.update(clientProfiles)
    .set({ tier: args.tier, ...(args.frequencyOverride !== undefined
      ? { frequencyOverride: args.frequencyOverride } : {}), updatedAt: new Date().toISOString() } as any)
    .where(eq(clientProfiles.id, args.accountId));

  return { ok: true, changed: true };
}
