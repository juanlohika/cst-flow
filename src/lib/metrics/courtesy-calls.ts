/**
 * Courtesy-call component of an RM's monthly scorecard.
 *
 * Mirrors the "Courtesy Calls" block of the manual metrics sheet:
 *   Account | Tier | Planned CC This Month | Completed
 *   score    = mean of (completed / planned) across the RM's accounts
 *   weighted = score * areaWeight   (0.10 in the current sheet)
 *
 * Two deliberate differences from the sheet, both because the sheet is wrong:
 *
 *  1. Its formula is AVERAGE(H17,H18,H19,H20). H17 is the HEADER row and the
 *     data runs H18:H22, so it silently drops the last two accounts. On the
 *     July tab that turns 3-of-5 completed into a perfect 10.00% when the
 *     honest figure is 0.6 -> 6.00%. We average every account.
 *
 *  2. "Planned this month" uses the tier that APPLIED during the period
 *     (AccountTierHistory), not today's tier, so a promotion cannot
 *     retroactively change a past month's target.
 */
import { db } from "@/db";
import {
  clientProfiles, accountMemberships, courtesyCallHistory, courtesyCallEvidence,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { loadTierFrequencyMap, resolveAccountFrequency } from "@/lib/accounts/tier-frequency";
import { periodsForYear, periodCompliance, type PeriodSlot } from "@/lib/courtesy/periods";
import { tierOn } from "@/lib/courtesy/tier-history";

export type CcAccountRow = {
  accountId: string;
  accountName: string;
  tier: string | null;
  cadence: string;
  planned: number;
  completed: number;
  compliant: number;
  score: number;
  periods: Array<{
    label: string; display: string; start: string; end: string;
    callDate: string | null; momSentDate: string | null;
    status: string; evidenceCount: number;
  }>;
};

export type CcMetric = {
  month: string;
  accounts: CcAccountRow[];
  planned: number;
  completed: number;
  compliant: number;
  score: number;
  weight: number;
  weightedScore: number;
  excludedNoTier: string[];
};

function overlapsMonth(slot: PeriodSlot, month: string) {
  const first = `${month}-01`;
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return slot.start <= last && slot.end >= first;
}

export async function courtesyCallMetric(args: {
  rmUserId: string;
  month: string;
  weight?: number;
}): Promise<CcMetric> {
  const weight = args.weight ?? 0.10;
  const year = Number(args.month.slice(0, 4));

  const mem = await db
    .select({ accountId: accountMemberships.clientProfileId })
    .from(accountMemberships)
    .where(and(eq(accountMemberships.userId, args.rmUserId), eq(accountMemberships.isPrimary, true)));
  const ids = mem.map(m => m.accountId).filter(Boolean) as string[];

  const empty: CcMetric = {
    month: args.month, accounts: [], planned: 0, completed: 0, compliant: 0,
    score: 0, weight, weightedScore: 0, excludedNoTier: [],
  };
  if (ids.length === 0) return empty;

  const accounts = await db
    .select({ id: clientProfiles.id, name: clientProfiles.companyName, short: clientProfiles.clientShortName })
    .from(clientProfiles).where(inArray(clientProfiles.id, ids));

  const calls = await db.select().from(courtesyCallHistory)
    .where(inArray(courtesyCallHistory.clientProfileId, ids));

  const evRows = await db.select({ callId: courtesyCallEvidence.courtesyCallId }).from(courtesyCallEvidence);
  const evCount = new Map<string, number>();
  for (const e of evRows) evCount.set(e.callId, (evCount.get(e.callId) || 0) + 1);

  const tierMap = await loadTierFrequencyMap();
  const rows: CcAccountRow[] = [];
  const excludedNoTier: string[] = [];

  for (const a of accounts) {
    const name = a.short || a.name;
    const t = await tierOn(a.id, `${args.month}-15`);
    const cad = resolveAccountFrequency({ tier: t.tier, frequencyOverride: t.frequencyOverride, tierMap });
    if (!cad.days) { excludedNoTier.push(name); continue; }

    const slots = periodsForYear(year, cad.label).filter(s => overlapsMonth(s, args.month));
    const mine = calls.filter(c => c.clientProfileId === a.id);

    const periods = slots.map(slot => {
      const rec = mine.find(c => c.periodLabel === slot.label)
        || mine.find(c => c.callDate && c.callDate >= slot.start && c.callDate <= slot.end)
        || null;
      return {
        label: slot.label, display: slot.display, start: slot.start, end: slot.end,
        callDate: rec?.callDate ?? null,
        momSentDate: rec?.momSentDate ?? null,
        status: periodCompliance({ slot, callDate: rec?.callDate, momSentDate: rec?.momSentDate }),
        evidenceCount: rec ? (evCount.get(rec.id) || 0) : 0,
      };
    });

    const planned = periods.length;
    const completed = periods.filter(p => p.callDate).length;
    const compliant = periods.filter(p => p.status === "compliant").length;
    rows.push({
      accountId: a.id, accountName: name, tier: t.tier, cadence: cad.label,
      planned, completed, compliant,
      score: planned > 0 ? completed / planned : 0,
      periods,
    });
  }

  const planned = rows.reduce((s, r) => s + r.planned, 0);
  const completed = rows.reduce((s, r) => s + r.completed, 0);
  const compliant = rows.reduce((s, r) => s + r.compliant, 0);
  const score = rows.length > 0 ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;

  return {
    month: args.month, accounts: rows,
    planned, completed, compliant,
    score, weight, weightedScore: score * weight,
    excludedNoTier,
  };
}
