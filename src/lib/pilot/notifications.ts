/**
 * Pilot Tracker — CST-facing notifications.
 *
 * Fires web-push + email notifications to CST admins with access to an
 * account when specific events happen on a pilot participant:
 *   - Mobile number corrected by participant → CST needs to update source
 *   - CLICKED_NOT_REGISTERED contradiction    → dev needs to add email now
 *   - Version screenshot uploaded             → CST review queue has a new item
 *   - Any stage transition to VERSION_VERIFIED (auto-complete) — optional
 *
 * Reads the account's memberships to figure out who to notify. Fires
 * fire-and-forget from mutation handlers; failures are logged not thrown.
 */
import { db } from "@/db";
import { pilotParticipants, pilotProjects, accountMemberships } from "@/db/schema";
import { eq } from "drizzle-orm";
import { dispatchNotification } from "@/lib/notifications/dispatcher";

interface PilotNotifyArgs {
  participantId: string;
  title: string;
  body: string;
  link?: string;
  // For payload/audit — the event kind that fired this.
  event: "mobile_corrected" | "contradiction" | "screenshot_uploaded" | "auto_verified";
}

/**
 * Broadcast a beta-registration request to every currently-bound internal
 * Telegram channel. One-way: no reply parsing, no threading, no read
 * receipts. Simply posts the participant's Play Store email and a short
 * context blurb so a dev can copy the email into the Play Console tester
 * list.
 *
 * Best-effort — logs and swallows per-channel failures (a temporarily
 * kicked bot or a revoked chat shouldn't block the caller). Never throws.
 */
export async function broadcastPilotRegistrationRequest(args: {
  participantId: string;
  fullName: string;
  employeeId: string;
  playstoreEmail: string;
  clientCompanyName?: string | null;
}): Promise<void> {
  try {
    const { listInternalActiveChatIds } = await import("@/lib/telegram/bind-keys");
    const targets = await listInternalActiveChatIds();
    if (targets.length === 0) return;

    const { getTelegramConfig } = await import("@/lib/telegram/config");
    const cfg = await getTelegramConfig();
    if (!cfg.botToken) {
      console.warn("[pilot/notifications] internal broadcast skipped — no bot token");
      return;
    }

    const { tgSendMessage, truncateForTelegram } = await import("@/lib/telegram/api");
    const clientLine = args.clientCompanyName ? ` · ${args.clientCompanyName}` : "";
    const text = truncateForTelegram(
      [
        `🆕 *Add to Play Store tester list*`,
        ``,
        `\`${args.playstoreEmail}\``,
        ``,
        `_${args.fullName} · ${args.employeeId}${clientLine}_`,
      ].join("\n"),
    );
    // Fan out in parallel — one bad chat shouldn't hold up the rest.
    await Promise.all(
      targets.map((t) =>
        tgSendMessage(cfg.botToken, t.chatId, text, {
          parseMode: "Markdown",
          disablePreview: true,
        }).catch((e: any) => {
          console.warn(
            `[pilot/notifications] broadcast failed for chatId=${t.chatId}:`,
            e?.message || e,
          );
        }),
      ),
    );
  } catch (e) {
    console.warn("[pilot/notifications] internal broadcast crashed:", e);
  }
}

/**
 * Notify all admins who have access to the account owning the given
 * participant. Never throws — best-effort delivery, logs on failure.
 */
export async function notifyPilotEvent(args: PilotNotifyArgs): Promise<void> {
  try {
    // Resolve project → clientProfileId → user IDs with membership access.
    const [participant] = await db
      .select({ projectId: pilotParticipants.projectId })
      .from(pilotParticipants)
      .where(eq(pilotParticipants.id, args.participantId))
      .limit(1);
    if (!participant) return;
    const [project] = await db
      .select({ clientProfileId: pilotProjects.clientProfileId })
      .from(pilotProjects)
      .where(eq(pilotProjects.id, participant.projectId))
      .limit(1);
    if (!project) return;
    const members = await db
      .select({ userId: accountMemberships.userId })
      .from(accountMemberships)
      .where(eq(accountMemberships.clientProfileId, project.clientProfileId));
    const userIds = members.map((m) => m.userId);
    if (userIds.length === 0) return;

    await dispatchNotification({
      userIds,
      type: "pilot_issue",
      title: args.title,
      body: args.body,
      link: args.link || `/meeting-prep?clientId=${project.clientProfileId}&activeTab=pilotTracker`,
      payload: {
        event: args.event,
        participantId: args.participantId,
        projectId: participant.projectId,
      },
    });
  } catch (e) {
    console.warn("[pilot/notifications] dispatch failed:", e);
  }
}
