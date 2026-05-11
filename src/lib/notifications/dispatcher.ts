import webpush from "web-push";
import { db } from "@/db";
import {
  notificationSubscriptions,
  notificationPreferences,
  notificationLogs,
  users as usersTable,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { configureWebPush } from "./vapid";

export type NotificationType = "request_captured" | "telegram_message" | "mention";
export type NotificationChannel = "web_push" | "email";

export interface NotifyArgs {
  userIds: string[];                  // CST OS user IDs to notify
  type: NotificationType;
  title: string;                       // Required, short (max ~50 chars)
  body?: string;                       // Optional, longer (max ~200 chars)
  link?: string;                       // Optional URL to open when clicked
  payload?: Record<string, any>;       // Optional extra context (logged)
}

interface PreferenceRow {
  userId: string;
  webPushEnabled: boolean;
  emailEnabled: boolean;
  notifyOnRequest: boolean;
  notifyOnTelegram: boolean;
  notifyOnMention: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  emailCadence: string;
}

/**
 * Returns the user's notification preferences. Auto-creates default prefs if
 * none exist, so the calling code can always assume a value.
 */
export async function getOrCreatePreferences(userId: string): Promise<PreferenceRow> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  if (rows[0]) {
    return rows[0] as PreferenceRow;
  }

  const id = `np_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  await db.insert(notificationPreferences).values({
    id,
    userId,
    webPushEnabled: true,
    emailEnabled: true,
    notifyOnRequest: true,
    notifyOnTelegram: false,
    notifyOnMention: true,
    quietStart: null,
    quietEnd: null,
    emailCadence: "instant",
    updatedAt: now,
  });

  // Read back as a real row
  const readback = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return readback[0] as PreferenceRow;
}

function shouldNotifyForType(prefs: PreferenceRow, type: NotificationType): boolean {
  if (type === "request_captured") return prefs.notifyOnRequest;
  if (type === "telegram_message") return prefs.notifyOnTelegram;
  if (type === "mention") return prefs.notifyOnMention;
  return false;
}

function isInQuietHours(prefs: PreferenceRow): boolean {
  if (!prefs.quietStart || !prefs.quietEnd) return false;
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const currentMin = hh * 60 + mm;
  const parse = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    if (isNaN(h)) return null;
    return h * 60 + (m || 0);
  };
  const start = parse(prefs.quietStart);
  const end = parse(prefs.quietEnd);
  if (start === null || end === null) return false;
  // Same-day window
  if (start <= end) return currentMin >= start && currentMin < end;
  // Crosses midnight (e.g., 22:00 to 07:00)
  return currentMin >= start || currentMin < end;
}

async function sendPushToSubscription(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}, payload: {
  title: string;
  body: string;
  link?: string;
  type: NotificationType;
}): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  try {
    const result = await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true, statusCode: result.statusCode };
  } catch (e: any) {
    return { ok: false, statusCode: e?.statusCode, error: e?.body || e?.message || "unknown" };
  }
}

/**
 * Dispatch a notification to all eligible users via their preferred channels.
 * Honors per-user preferences, quiet hours, and per-channel toggles.
 * Auto-cleans expired/invalid push subscriptions (HTTP 404/410 from the push service).
 */
export async function dispatchNotification(args: NotifyArgs): Promise<{
  attempted: number;
  pushSent: number;
  pushFailed: number;
  skipped: number;
}> {
  let pushSent = 0;
  let pushFailed = 0;
  let skipped = 0;
  let attempted = 0;

  if (args.userIds.length === 0) {
    return { attempted: 0, pushSent: 0, pushFailed: 0, skipped: 0 };
  }

  // Make sure web-push is configured before we send
  await configureWebPush();

  for (const userId of args.userIds) {
    attempted++;

    try {
      const prefs = await getOrCreatePreferences(userId);

      // Type-level opt-out
      if (!shouldNotifyForType(prefs, args.type)) {
        skipped++;
        continue;
      }

      // Quiet hours
      if (isInQuietHours(prefs)) {
        skipped++;
        // Still log so analytics knows we suppressed
        await db.insert(notificationLogs).values({
          id: `nl_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          userId,
          type: args.type,
          channel: "web_push",
          title: args.title,
          body: args.body || null,
          link: args.link || null,
          payload: args.payload ? JSON.stringify(args.payload) : null,
          status: "skipped:quiet-hours" as any,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
        continue;
      }

      // ─── Web Push ──────────────────────────────────────────────────
      if (prefs.webPushEnabled) {
        const subs = await db
          .select()
          .from(notificationSubscriptions)
          .where(and(
            eq(notificationSubscriptions.userId, userId),
            eq(notificationSubscriptions.status, "active")
          ));

        for (const s of subs) {
          const result = await sendPushToSubscription({
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.authSecret },
          }, {
            title: args.title,
            body: args.body || "",
            link: args.link,
            type: args.type,
          });

          if (result.ok) {
            pushSent++;
            await db.update(notificationSubscriptions)
              .set({ lastUsedAt: new Date().toISOString() })
              .where(eq(notificationSubscriptions.id, s.id))
              .catch(() => {});
          } else {
            pushFailed++;
            // 404 or 410 = the subscription is dead (browser cleared it, app uninstalled, etc.)
            if (result.statusCode === 404 || result.statusCode === 410) {
              await db.update(notificationSubscriptions)
                .set({ status: "revoked" })
                .where(eq(notificationSubscriptions.id, s.id))
                .catch(() => {});
            }
          }

          await db.insert(notificationLogs).values({
            id: `nl_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
            userId,
            type: args.type,
            channel: "web_push",
            title: args.title,
            body: args.body || null,
            link: args.link || null,
            payload: args.payload ? JSON.stringify(args.payload) : null,
            status: result.ok ? "sent" : "failed",
            errorMessage: result.ok ? null : (result.error || `HTTP ${result.statusCode}`),
            createdAt: new Date().toISOString(),
            sentAt: result.ok ? new Date().toISOString() : null,
          }).catch(() => {});
        }
      }

      // ─── Email (instant cadence only for Phase 6; hourly/daily come later) ──
      if (prefs.emailEnabled && prefs.emailCadence === "instant") {
        // Email sending is intentionally lazy — we just log it here and let a
        // separate /api/notifications/email-flush job consume the log.
        // (Or we can wire to nodemailer here directly.)
        await db.insert(notificationLogs).values({
          id: `nl_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          userId,
          type: args.type,
          channel: "email",
          title: args.title,
          body: args.body || null,
          link: args.link || null,
          payload: args.payload ? JSON.stringify(args.payload) : null,
          status: "pending",
          createdAt: new Date().toISOString(),
        }).catch(() => {});

        // Fire-and-forget email if SMTP is configured
        sendEmailNotification(userId, args).catch(err => {
          console.warn("[notifications] email send failed:", err?.message);
        });
      }
    } catch (e: any) {
      console.error("[notifications] dispatch failed for user", userId, e);
    }
  }

  return { attempted, pushSent, pushFailed, skipped };
}

async function sendEmailNotification(userId: string, args: NotifyArgs): Promise<void> {
  try {
    // Use the shared SMTP helper — same path the test-email button uses.
    const { getSmtpTransport } = await import("@/lib/email");
    const smtp = await getSmtpTransport();
    if (!smtp) {
      console.warn("[notifications] SMTP not configured — skipping email for user", userId);
      return;
    }

    const userRows = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const recipient = userRows[0];
    if (!recipient?.email) return;

    const linkSection = args.link
      ? `<p><a href="${args.link}" style="color:#e11d48;text-decoration:none;font-weight:bold;">Open in CST OS →</a></p>`
      : "";

    await smtp.transport.sendMail({
      from: `"ARIMA" <${smtp.from}>`,
      to: recipient.email,
      subject: `[ARIMA] ${args.title}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b;">
          <h2 style="font-size:16px;font-weight:700;margin:0 0 12px;">${args.title}</h2>
          <p style="font-size:14px;line-height:1.5;color:#475569;margin:0 0 16px;">${args.body || ""}</p>
          ${linkSection}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
          <p style="font-size:11px;color:#94a3b8;">You're getting this because notifications are enabled for your account in CST OS. <a href="${process.env.PUBLIC_BASE_URL || ""}/arima/notifications" style="color:#64748b;">Manage preferences →</a></p>
        </div>
      `,
      text: `${args.title}\n\n${args.body || ""}${args.link ? `\n\nOpen: ${args.link}` : ""}`,
    });

    // Mark log as sent
    await db.update(notificationLogs)
      .set({ status: "sent", sentAt: new Date().toISOString() })
      .where(and(
        eq(notificationLogs.userId, userId),
        eq(notificationLogs.channel, "email"),
        eq(notificationLogs.title, args.title),
        eq(notificationLogs.status, "pending")
      ))
      .catch(() => {});
  } catch (e: any) {
    console.warn("[notifications] sendEmailNotification error:", e?.message);
  }
}
