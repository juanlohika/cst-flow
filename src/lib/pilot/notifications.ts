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
 * Broadcast a beta-registration DIGEST (one message per channel) covering
 * multiple participants at once. Used by the roster import path — a 75-row
 * XLSX would otherwise fire 75 individual messages. Falls through to
 * broadcastPilotRegistrationRequest() when the list has exactly one entry.
 *
 * Best-effort per channel; a bad chat doesn't block the rest. Never throws.
 */
export async function broadcastPilotRegistrationDigest(args: {
  entries: Array<{
    participantId: string;
    fullName: string;
    employeeId: string;
    playstoreEmail: string;
  }>;
  clientCompanyName?: string | null;
  source: "roster-import" | "portal";
}): Promise<void> {
  try {
    if (args.entries.length === 0) return;
    if (args.entries.length === 1) {
      const e = args.entries[0];
      return broadcastPilotRegistrationRequest({
        participantId: e.participantId,
        fullName: e.fullName,
        employeeId: e.employeeId,
        playstoreEmail: e.playstoreEmail,
        clientCompanyName: args.clientCompanyName,
      });
    }
    const { listInternalActiveChatIds } = await import("@/lib/telegram/bind-keys");
    const targets = await listInternalActiveChatIds();
    if (targets.length === 0) return;

    const { getTelegramConfig } = await import("@/lib/telegram/config");
    const cfg = await getTelegramConfig();
    if (!cfg.botToken) {
      console.warn("[pilot/notifications] digest broadcast skipped — no bot token");
      return;
    }

    const { tgSendMessage, truncateForTelegram } = await import("@/lib/telegram/api");
    // Plain-text conversational format — no Markdown, no monospace, no
    // italics. Reads like a note a person would send. Company name goes
    // in the ask line so the ceremonial "for the X company" flows.
    const company = (args.clientCompanyName || "").trim();
    const forCompany = company ? ` for the ${company} company` : "";
    const bullets = args.entries.map((e) => `- ${e.playstoreEmail}`).join("\n");

    await Promise.all(
      targets.map((t) => {
        const greetingName = t.broadcastAssignee
          ? // Strip a leading "@" when composing the greeting so we get
            // "Hi Lester," not "Hi @Lester,". The mention still fires a
            // push because Telegram parses @handles when parseMode is
            // absent, as long as the token appears anywhere in the text.
            (t.broadcastAssignee.startsWith("@")
              ? t.broadcastAssignee.slice(1)
              : t.broadcastAssignee)
          : "team";
        // Include the raw @handle on its own line so Telegram still
        // pings the assignee. Bare "Hi Name," without the handle would
        // not trigger a notification.
        const pingLine = t.broadcastAssignee ? `${t.broadcastAssignee}\n\n` : "";
        const text = truncateForTelegram(
          pingLine +
            [
              `Hi ${greetingName},`,
              ``,
              `Please add the following to the Tarkie V5 Internal Beta Tester list${forCompany}:`,
              ``,
              bullets,
              ``,
              `Thanks.`,
            ].join("\n"),
        );
        return tgSendMessage(cfg.botToken, t.chatId, text, {
          disablePreview: true,
        }).catch((e: any) => {
          console.warn(
            `[pilot/notifications] digest broadcast failed for chatId=${t.chatId}:`,
            e?.message || e,
          );
        });
      }),
    );
  } catch (e) {
    console.warn("[pilot/notifications] digest broadcast crashed:", e);
  }
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
    const company = (args.clientCompanyName || "").trim();
    const forCompany = company ? ` for the ${company} company` : "";
    await Promise.all(
      targets.map((t) => {
        const greetingName = t.broadcastAssignee
          ? t.broadcastAssignee.startsWith("@")
            ? t.broadcastAssignee.slice(1)
            : t.broadcastAssignee
          : "team";
        const pingLine = t.broadcastAssignee ? `${t.broadcastAssignee}\n\n` : "";
        const text = truncateForTelegram(
          pingLine +
            [
              `Hi ${greetingName},`,
              ``,
              `Please add the following to the Tarkie V5 Internal Beta Tester list${forCompany}:`,
              ``,
              `- ${args.playstoreEmail}`,
              ``,
              `Thanks.`,
            ].join("\n"),
        );
        return tgSendMessage(cfg.botToken, t.chatId, text, {
          disablePreview: true,
        }).catch((e: any) => {
          console.warn(
            `[pilot/notifications] broadcast failed for chatId=${t.chatId}:`,
            e?.message || e,
          );
        });
      }),
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
