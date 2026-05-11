/**
 * Cadence math + rule resolution for ARIMA check-ins.
 */
import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  arimaCheckInSchedules,
  arimaScheduleRules,
  arimaCheckIns,
} from "@/db/schema";
import { and, eq, desc, lte, asc, isNotNull } from "drizzle-orm";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "custom";

export function cadenceToDays(cadence: Cadence, customIntervalDays?: number | null): number {
  switch (cadence) {
    case "weekly": return 7;
    case "biweekly": return 14;
    case "monthly": return 30;
    case "quarterly": return 90;
    case "custom": return Math.max(1, customIntervalDays || 30);
    default: return 30;
  }
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * Find the highest-priority enabled rule that matches a client's engagement status.
 * Returns null if no rule matches.
 */
export async function resolveRuleForClient(client: { id: string; engagementStatus: string | null | undefined }): Promise<{
  cadence: Cadence;
  customIntervalDays: number | null;
  ruleName: string;
} | null> {
  const rules = await db
    .select()
    .from(arimaScheduleRules)
    .where(eq(arimaScheduleRules.enabled, true))
    .orderBy(desc(arimaScheduleRules.priority));

  const status = client.engagementStatus || null;
  const matched = rules.find(r => !r.matchEngagementStatus || r.matchEngagementStatus === status);
  if (!matched) return null;
  return {
    cadence: matched.cadence as Cadence,
    customIntervalDays: matched.customIntervalDays,
    ruleName: matched.name,
  };
}

/**
 * Ensure every confirmed client has a schedule row. If a client doesn't have one,
 * apply the matching rule and seed an ArimaCheckInSchedule with nextDueAt set
 * to NOW + cadence (so we don't blast everyone immediately on first run).
 */
export async function backfillSchedules(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  const clients = await db
    .select({
      id: clientProfilesTable.id,
      engagementStatus: clientProfilesTable.engagementStatus,
    })
    .from(clientProfilesTable);

  for (const c of clients) {
    const existing = await db
      .select({ id: arimaCheckInSchedules.id })
      .from(arimaCheckInSchedules)
      .where(eq(arimaCheckInSchedules.clientProfileId, c.id))
      .limit(1);

    if (existing[0]) { skipped++; continue; }

    const rule = await resolveRuleForClient(c);
    if (!rule) { skipped++; continue; }

    const now = new Date().toISOString();
    const days = cadenceToDays(rule.cadence, rule.customIntervalDays);
    const nextDueAt = addDays(now, days);

    await db.insert(arimaCheckInSchedules).values({
      id: `cisch_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      clientProfileId: c.id,
      cadence: rule.cadence,
      customIntervalDays: rule.customIntervalDays,
      preferredChannel: "auto",
      nextDueAt,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }

  return { created, skipped };
}

/**
 * Return the list of active schedules that are due now (nextDueAt <= now).
 * Joined with client profile so callers can see the company name in one query.
 */
export async function listDueSchedules(asOf: Date = new Date()): Promise<Array<{
  scheduleId: string;
  clientProfileId: string;
  companyName: string;
  engagementStatus: string | null;
  cadence: string;
  customIntervalDays: number | null;
  preferredChannel: string;
  nextDueAt: string;
  consecutiveNoResponse: number;
  lastSentAt: string | null;
}>> {
  const nowIso = asOf.toISOString();
  const rows = await db
    .select({
      scheduleId: arimaCheckInSchedules.id,
      clientProfileId: arimaCheckInSchedules.clientProfileId,
      companyName: clientProfilesTable.companyName,
      engagementStatus: clientProfilesTable.engagementStatus,
      cadence: arimaCheckInSchedules.cadence,
      customIntervalDays: arimaCheckInSchedules.customIntervalDays,
      preferredChannel: arimaCheckInSchedules.preferredChannel,
      nextDueAt: arimaCheckInSchedules.nextDueAt,
      consecutiveNoResponse: arimaCheckInSchedules.consecutiveNoResponse,
      lastSentAt: arimaCheckInSchedules.lastSentAt,
    })
    .from(arimaCheckInSchedules)
    .innerJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaCheckInSchedules.clientProfileId))
    .where(and(
      eq(arimaCheckInSchedules.status, "active"),
      lte(arimaCheckInSchedules.nextDueAt, nowIso)
    ))
    .orderBy(asc(arimaCheckInSchedules.nextDueAt));

  return rows.map(r => ({
    ...r,
    engagementStatus: r.engagementStatus || null,
    customIntervalDays: r.customIntervalDays ?? null,
    lastSentAt: r.lastSentAt ?? null,
  }));
}

/**
 * After a check-in is sent, advance the schedule:
 * - Set nextDueAt = now + cadence (with adaptive backoff factor)
 * - Set lastSentAt = now
 */
export async function advanceSchedule(args: {
  scheduleId: string;
  consecutiveNoResponseIncrement?: boolean;
}): Promise<void> {
  const rows = await db
    .select()
    .from(arimaCheckInSchedules)
    .where(eq(arimaCheckInSchedules.id, args.scheduleId))
    .limit(1);
  const sch = rows[0];
  if (!sch) return;

  const baseDays = cadenceToDays(sch.cadence as Cadence, sch.customIntervalDays);
  const noResp = sch.consecutiveNoResponse + (args.consecutiveNoResponseIncrement ? 1 : 0);
  // Adaptive backoff: after 2 no-responses, extend cadence by 1.5x; after 3 → pause
  let nextDays = baseDays;
  if (noResp >= 3) {
    // We'll pause separately in the runner — but if not paused, double interval
    nextDays = Math.round(baseDays * 2);
  } else if (noResp === 2) {
    nextDays = Math.round(baseDays * 1.5);
  }

  const now = new Date().toISOString();
  await db
    .update(arimaCheckInSchedules)
    .set({
      lastSentAt: now,
      nextDueAt: addDays(now, nextDays),
      consecutiveNoResponse: noResp,
      updatedAt: now,
    })
    .where(eq(arimaCheckInSchedules.id, args.scheduleId));
}

/**
 * Mark a schedule as having received a response → reset the no-response counter.
 * Called whenever a message comes IN on a channel where this client is scoped.
 */
export async function markScheduleResponded(clientProfileId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(arimaCheckInSchedules)
    .set({
      lastResponseAt: now,
      consecutiveNoResponse: 0,
      updatedAt: now,
    })
    .where(eq(arimaCheckInSchedules.clientProfileId, clientProfileId));

  // Also update the most recent check-in's status if it's still 'sent'
  const recent = await db
    .select({ id: arimaCheckIns.id })
    .from(arimaCheckIns)
    .where(and(
      eq(arimaCheckIns.clientProfileId, clientProfileId),
      eq(arimaCheckIns.status, "sent")
    ))
    .orderBy(desc(arimaCheckIns.sentAt))
    .limit(1);

  if (recent[0]) {
    await db
      .update(arimaCheckIns)
      .set({ status: "responded", respondedAt: now })
      .where(eq(arimaCheckIns.id, recent[0].id));
  }
}
