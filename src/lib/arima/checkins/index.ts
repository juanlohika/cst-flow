/**
 * Orchestration entrypoint for the check-in subsystem.
 */
import { db } from "@/db";
import {
  arimaCheckIns,
  arimaCheckInSchedules,
  clientContacts,
  accountMemberships,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { listDueSchedules, advanceSchedule, backfillSchedules, type Cadence } from "./cadence";
import { generateCheckInMessage } from "./generate";
import { deliverCheckIn, type DeliveryChannel } from "./deliver";
import { dispatchNotification } from "@/lib/notifications/dispatcher";

export interface SendOneArgs {
  clientProfileId: string;
  scheduleId?: string;             // if provided, advance this schedule afterwards
  preferredChannel?: string;       // override schedule's choice
  triggeredByUserId?: string;
}

export interface SendOneResult {
  ok: boolean;
  checkInId?: string;
  channel?: DeliveryChannel;
  text?: string;
  error?: string;
  escalatedOnly?: boolean;
}

/**
 * Send a single check-in to one client. Used by both the cron runner and the
 * "Send check-in now" manual button.
 */
export async function sendCheckInForClient(args: SendOneArgs): Promise<SendOneResult> {
  try {
    // Load schedule + client context
    const scheduleRows = args.scheduleId
      ? await db.select().from(arimaCheckInSchedules).where(eq(arimaCheckInSchedules.id, args.scheduleId)).limit(1)
      : await db.select().from(arimaCheckInSchedules).where(eq(arimaCheckInSchedules.clientProfileId, args.clientProfileId)).limit(1);
    const schedule = scheduleRows[0] || null;

    // Skip if paused (unless manually triggered)
    if (schedule && schedule.status === "paused" && !args.triggeredByUserId) {
      return { ok: false, error: "Schedule is paused" };
    }

    // Resolve target contact + channel preference
    const channelPref = args.preferredChannel || schedule?.preferredChannel || "auto";

    // Pick a contact to address (used for personalizing the message)
    const contactRows = await db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        status: clientContacts.status,
        lastSeenAt: clientContacts.lastSeenAt,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clientProfileId, args.clientProfileId));

    const activeContact = contactRows
      .filter(c => c.status === "active")
      .sort((a, b) => (new Date(b.lastSeenAt || 0).getTime()) - (new Date(a.lastSeenAt || 0).getTime()))[0];
    const fallbackContact = contactRows[0];
    const targetContact = activeContact || fallbackContact;

    // If there's no contact AND no Telegram binding, the message will escalate
    // but we still generate it so admins can see what ARIMA wanted to say.
    const contactName = targetContact?.name?.split(" ")[0] || "there";
    const isFirstCheckIn = !schedule?.lastSentAt;

    // 1) Generate the message
    const gen = await generateCheckInMessage({
      clientProfileId: args.clientProfileId,
      contactName,
      isFirstCheckIn,
      consecutiveNoResponse: schedule?.consecutiveNoResponse ?? 0,
    });

    // 2) Deliver via best channel
    const delivery = await deliverCheckIn({
      clientProfileId: args.clientProfileId,
      messageContent: gen.text,
      preferredChannel: channelPref,
      triggeredByUserId: args.triggeredByUserId,
      scheduleId: schedule?.id,
    });

    // 3) Log the check-in row
    const checkInId = `cin_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(arimaCheckIns).values({
      id: checkInId,
      scheduleId: schedule?.id || null,
      clientProfileId: args.clientProfileId,
      contactId: delivery.contactId || targetContact?.id || null,
      channel: delivery.channel,
      messageContent: delivery.messageContent,
      conversationId: delivery.conversationId || null,
      status: delivery.ok && delivery.channel !== "internal" ? "sent" : (delivery.channel === "internal" ? "escalated" : "failed"),
      scheduledAt: now,
      sentAt: delivery.ok ? now : null,
      escalatedAt: delivery.channel === "internal" ? now : null,
      errorMessage: delivery.error || null,
      triggeredByUserId: args.triggeredByUserId || null,
      createdAt: now,
    });

    // 4) Advance the schedule if this was a real send
    if (schedule && delivery.ok) {
      await advanceSchedule({
        scheduleId: schedule.id,
        // Mark consecutiveNoResponse increment — we don't know yet if they'll respond.
        // It'll be reset to 0 when markScheduleResponded() is called on the next inbound message.
        consecutiveNoResponseIncrement: true,
      });

      // Pause if they've now missed too many in a row
      if ((schedule.consecutiveNoResponse + 1) >= 3) {
        await db
          .update(arimaCheckInSchedules)
          .set({ status: "paused", updatedAt: now })
          .where(eq(arimaCheckInSchedules.id, schedule.id));

        // Auto-escalate the silent-client signal
        const c = await db
          .select({ companyName: clientProfilesTable.companyName })
          .from(clientProfilesTable)
          .where(eq(clientProfilesTable.id, args.clientProfileId))
          .limit(1);
        const members = await db
          .select({ userId: accountMemberships.userId })
          .from(accountMemberships)
          .where(eq(accountMemberships.clientProfileId, args.clientProfileId));
        if (members.length > 0) {
          await dispatchNotification({
            userIds: members.map(m => m.userId),
            type: "mention",
            title: `⚠️ ${c[0]?.companyName || "Client"} is going silent`,
            body: `3 consecutive check-ins missed. The schedule is now paused. Please reach out personally.`,
            link: `/admin/arima-checkins`,
          });
        }
      }
    }

    return {
      ok: true,
      checkInId,
      channel: delivery.channel,
      text: gen.text,
      escalatedOnly: delivery.channel === "internal",
      error: delivery.error,
    };
  } catch (e: any) {
    console.error("[checkins/send] failed:", e);
    return { ok: false, error: e?.message || "Check-in send failed" };
  }
}

/**
 * Run all due check-ins. This is what the cron calls.
 */
export async function runDueCheckIns(opts?: { ensureSchedules?: boolean }): Promise<{
  processed: number;
  sent: number;
  escalated: number;
  failed: number;
  details: Array<{ clientProfileId: string; result: SendOneResult }>;
}> {
  if (opts?.ensureSchedules) {
    await backfillSchedules();
  }

  const due = await listDueSchedules();
  let sent = 0;
  let escalated = 0;
  let failed = 0;
  const details: Array<{ clientProfileId: string; result: SendOneResult }> = [];

  for (const d of due) {
    const result = await sendCheckInForClient({
      clientProfileId: d.clientProfileId,
      scheduleId: d.scheduleId,
    });
    details.push({ clientProfileId: d.clientProfileId, result });
    if (!result.ok) failed++;
    else if (result.escalatedOnly) escalated++;
    else sent++;
  }

  return { processed: due.length, sent, escalated, failed, details };
}

export { backfillSchedules, listDueSchedules, advanceSchedule };
export { markScheduleResponded } from "./cadence";
