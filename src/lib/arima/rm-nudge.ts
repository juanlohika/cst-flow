/**
 * Phase 2 — proactive RM nudges into each RM's own team room.
 *
 * Deliberately narrow in scope: one message per RM, into the `rm-team` room
 * already bound for them, listing only THEIR accounts that need a courtesy call
 * plus their overdue timeline tasks. No DMs, no Super Admin GC — an RM should
 * not learn about another RM's book from a nudge.
 *
 * Anti-annoyance rules, because a nudge that fires too often gets muted:
 *   · only rooms with an active rm-team binding are messaged
 *   · an RM with nothing due is skipped entirely rather than sent "all clear"
 *   · ArimaCheckInSchedule.consecutiveNoResponse backs the cadence off, so a
 *     silent room is nudged less, not more
 *   · at most one nudge per RM per NUDGE_COOLDOWN_HOURS
 */
import { db } from "@/db";
import {
  clientProfiles, accountMemberships, users as usersTable,
  arimaChannelBindings, courtesyCallHistory, timelineItems, globalSettings,
} from "@/db/schema";
import { and, eq, desc, inArray, ne, isNull, or, sql } from "drizzle-orm";
import { tgSendMessage, truncateForTelegram } from "@/lib/telegram/api";
import { getTelegramConfig } from "@/lib/telegram/config";
import { loadTierFrequencyMap, resolveAccountFrequency } from "@/lib/accounts/tier-frequency";

const NUDGE_COOLDOWN_HOURS = 20;      // so a daily cron cannot double-post
const LAST_NUDGE_KEY = "ARIMA_RM_NUDGE_LAST";

export type RmNudgeRow = {
  accountId: string;
  accountName: string;
  tier: string | null;
  cadence: string;
  cadenceDays: number | null;
  lastCall: string | null;
  daysSince: number | null;
  overdueBy: number | null;       // days past the cadence
  momMissing: boolean;            // call logged, minutes never recorded
};

export type RmTaskRow = {
  accountName: string;
  taskCode: string;
  subject: string;
  plannedEnd: string;
  overdueDays: number;
};

function today() { return new Date().toISOString().slice(0, 10); }
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * What one RM needs to act on. Courtesy-call standing is computed from
 * CourtesyCallHistory (MAX(callDate)), never from a denormalised field, so this
 * cannot disagree with the Courtesy Calls tab.
 */
export async function collectRmWork(rmUserId: string): Promise<{
  calls: RmNudgeRow[];
  tasks: RmTaskRow[];
  /** Accounts with no tier and no call — a setup gap, not an overdue call. */
  unconfigured: string[];
}> {
  // Primary membership = the RM actually accountable, not merely with access.
  const mem = await db
    .select({ accountId: accountMemberships.clientProfileId })
    .from(accountMemberships)
    .where(and(
      eq(accountMemberships.userId, rmUserId),
      eq(accountMemberships.isPrimary, true),
    ));
  const ids = mem.map(m => m.accountId).filter(Boolean) as string[];
  if (ids.length === 0) return { calls: [], tasks: [], unconfigured: [] };

  const accounts = await db
    .select({
      id: clientProfiles.id,
      name: clientProfiles.companyName,
      short: clientProfiles.clientShortName,
      tier: clientProfiles.tier,
      frequencyOverride: clientProfiles.frequencyOverride,
    })
    .from(clientProfiles)
    .where(inArray(clientProfiles.id, ids));

  const tierMap = await loadTierFrequencyMap();

  // One grouped query for latest call + whether its MOM is missing, rather than
  // a query per account.
  const latest = await db
    .select({
      accountId: courtesyCallHistory.clientProfileId,
      lastCall: sql<string>`MAX(${courtesyCallHistory.callDate})`,
    })
    .from(courtesyCallHistory)
    .where(inArray(courtesyCallHistory.clientProfileId, ids))
    .groupBy(courtesyCallHistory.clientProfileId);
  const lastByAccount = new Map(latest.map(r => [r.accountId, r.lastCall]));

  const openMom = await db
    .select({ accountId: courtesyCallHistory.clientProfileId })
    .from(courtesyCallHistory)
    .where(and(
      inArray(courtesyCallHistory.clientProfileId, ids),
      isNull(courtesyCallHistory.momSentDate),
    ));
  const momMissing = new Set(openMom.map(r => r.accountId));

  const t = today();
  const calls: RmNudgeRow[] = [];
  const unconfigured: string[] = [];
  for (const a of accounts) {
    const cad = resolveAccountFrequency({ tier: a.tier, frequencyOverride: a.frequencyOverride, tierMap });
    const lastCall = lastByAccount.get(a.id) || null;
    const daysSince = lastCall ? daysBetween(lastCall, t) : null;
    const overdueBy = cad.days != null && daysSince != null && daysSince > cad.days
      ? daysSince - cad.days : null;
    const needsMom = momMissing.has(a.id);

    // Only surface what is genuinely ACTIONABLE.
    //
    // A never-called account with no tier has no cadence to be late against —
    // listing it is a data-setup complaint, not a nudge, and on a 48-account
    // book it drowns the real items. Those are counted and mentioned once at
    // the end instead of itemised.
    if (!lastCall && cad.days == null) { unconfigured.push(a.short || a.name); continue; }
    if (lastCall && overdueBy == null && !needsMom) continue;
    calls.push({
      accountId: a.id,
      accountName: a.short || a.name,
      tier: a.tier,
      cadence: cad.label,
      cadenceDays: cad.days,
      lastCall, daysSince, overdueBy,
      momMissing: needsMom,
    });
  }

  // Overdue timeline tasks on those same accounts.
  const rawTasks = await db
    .select({
      accountId: timelineItems.clientProfileId,
      taskCode: timelineItems.taskCode,
      subject: timelineItems.subject,
      plannedEnd: timelineItems.plannedEnd,
    })
    .from(timelineItems)
    .where(and(
      inArray(timelineItems.clientProfileId, ids),
      ne(timelineItems.status, "completed"),
      or(isNull(timelineItems.actualEnd), eq(timelineItems.actualEnd, "")),
    ))
    .orderBy(timelineItems.plannedEnd);

  const nameById = new Map(accounts.map(a => [a.id, a.short || a.name]));
  const tasks: RmTaskRow[] = rawTasks
    .filter(r => r.plannedEnd && r.plannedEnd < t)
    .map(r => ({
      accountName: nameById.get(r.accountId!) || "—",
      taskCode: r.taskCode,
      subject: r.subject,
      plannedEnd: r.plannedEnd,
      overdueDays: daysBetween(r.plannedEnd, t),
    }));

  // Worst first — an RM reads the top of a message, not the bottom.
  calls.sort((a, b) => (b.overdueBy ?? 9999) - (a.overdueBy ?? 9999));
  tasks.sort((a, b) => b.overdueDays - a.overdueDays);
  return { calls, tasks, unconfigured };
}

/** The message an RM sees. Specific, actionable, and short enough to read. */
export function buildRmNudge(args: {
  rmName: string;
  calls: RmNudgeRow[];
  tasks: RmTaskRow[];
  unconfigured?: string[];
}): string {
  const L: string[] = [];
  L.push(`*Your accounts — what needs a move*`);
  L.push("");

  if (args.calls.length) {
    L.push(`*Courtesy calls*`);
    for (const c of args.calls.slice(0, 8)) {
      if (!c.lastCall) {
        L.push(`• *${c.accountName}* — no call logged yet (${c.cadence})`);
      } else if (c.overdueBy != null) {
        L.push(`• *${c.accountName}* — ${c.daysSince}d since last call, ${c.overdueBy}d past the ${c.cadence} cadence`);
      } else if (c.momMissing) {
        L.push(`• *${c.accountName}* — called ${c.lastCall}, minutes not recorded yet`);
      }
    }
    if (args.calls.length > 8) L.push(`  …and ${args.calls.length - 8} more`);
    L.push("");
  }

  if (args.tasks.length) {
    L.push(`*Overdue timeline tasks*`);
    for (const t of args.tasks.slice(0, 10)) {
      L.push(`• ${t.accountName} — ${t.taskCode} ${t.subject} (${t.overdueDays}d late)`);
    }
    if (args.tasks.length > 10) L.push(`  …and ${args.tasks.length - 10} more`);
    L.push("");
  }

  if (args.unconfigured?.length) {
    L.push(`${args.unconfigured.length} account${args.unconfigured.length === 1 ? " has" : "s have"} no tier set, so I can't tell when a call is due: ${args.unconfigured.slice(0, 5).join(", ")}${args.unconfigured.length > 5 ? `, +${args.unconfigured.length - 5} more` : ""}.`);
    L.push("");
  }
  L.push(`_Tell me when one is done — e.g. "called Landlite today" or "T-12 is finished" — and I'll record it._`);
  return L.join("\n");
}

/**
 * Post one nudge into each RM's own team room. Returns a per-RM outcome so a
 * cron run is auditable rather than silent.
 */
export async function runRmNudgeSweep(opts: { force?: boolean } = {}): Promise<{
  ok: boolean;
  rooms: number;
  sent: number;
  skipped: Array<{ rm: string; reason: string }>;
}> {
  const skipped: Array<{ rm: string; reason: string }> = [];

  const cfg = await getTelegramConfig();
  if (!cfg.botToken) return { ok: false, rooms: 0, sent: 0, skipped: [{ rm: "—", reason: "Telegram bot token not configured" }] };

  // Only rooms explicitly bound as rm-team, and still active.
  const rooms = await db
    .select({
      chatId: arimaChannelBindings.chatId,
      rmUserId: arimaChannelBindings.scopeRef,
      title: arimaChannelBindings.chatTitle,
    })
    .from(arimaChannelBindings)
    .where(and(
      eq(arimaChannelBindings.channel, "telegram"),
      eq(arimaChannelBindings.scopeType, "rm-team"),
      eq(arimaChannelBindings.status, "active"),
    ));

  if (rooms.length === 0) {
    return { ok: true, rooms: 0, sent: 0, skipped: [{ rm: "—", reason: "No active rm-team rooms are bound" }] };
  }

  // Cooldown marker, so a cron misfire cannot spam the same rooms twice.
  let lastRun: Record<string, string> = {};
  try {
    const row = await db.select().from(globalSettings)
      .where(eq(globalSettings.key, LAST_NUDGE_KEY)).limit(1);
    if (row[0]?.value) lastRun = JSON.parse(row[0].value);
  } catch { /* first run */ }

  let sent = 0;
  for (const room of rooms) {
    const rmId = room.rmUserId;
    if (!rmId) { skipped.push({ rm: room.title || room.chatId, reason: "binding has no scopeRef (RM user id)" }); continue; }

    if (!opts.force) {
      const prev = lastRun[rmId];
      if (prev && (Date.now() - Date.parse(prev)) < NUDGE_COOLDOWN_HOURS * 3600_000) {
        skipped.push({ rm: rmId, reason: `nudged ${Math.round((Date.now() - Date.parse(prev)) / 3600_000)}h ago` });
        continue;
      }
    }

    const who = await db.select({ name: usersTable.name }).from(usersTable)
      .where(eq(usersTable.id, rmId)).limit(1);

    const work = await collectRmWork(rmId);
    if (work.calls.length === 0 && work.tasks.length === 0) {
      // Silence is the feature — do not send "nothing due".
      skipped.push({ rm: who[0]?.name || rmId, reason: "nothing due" });
      continue;
    }

    const text = buildRmNudge({
      rmName: who[0]?.name || "there",
      calls: work.calls, tasks: work.tasks, unconfigured: work.unconfigured,
    });
    try {
      await tgSendMessage(cfg.botToken, room.chatId, truncateForTelegram(text), { parseMode: "Markdown" });
      lastRun[rmId] = new Date().toISOString();
      sent++;
    } catch (e: any) {
      skipped.push({ rm: who[0]?.name || rmId, reason: `send failed: ${e?.message || e}` });
    }
  }

  try {
    await db.run(sql`
      INSERT INTO GlobalSetting (id, key, value)
      VALUES (${"gs_" + LAST_NUDGE_KEY}, ${LAST_NUDGE_KEY}, ${JSON.stringify(lastRun)})
      ON CONFLICT(key) DO UPDATE SET value = ${JSON.stringify(lastRun)}`);
  } catch (e) {
    console.warn("[rm-nudge] could not persist cooldown markers", e);
  }

  return { ok: true, rooms: rooms.length, sent, skipped };
}
