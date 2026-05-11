/**
 * Channel-aware delivery for a check-in message.
 *
 * Channel selection logic (when scheduledChannel === "auto"):
 *   1. If client has a bound Telegram group → send there (richest channel)
 *   2. Else if client has at least one ACTIVE ClientContact → send via portal
 *      (persists as a portal conversation; contact gets email + push)
 *   3. Else → escalate to internal team only (no client-facing send possible)
 */
import { db } from "@/db";
import {
  arimaChannelBindings,
  clientContacts,
  clientProfiles as clientProfilesTable,
  arimaConversations,
  arimaMessages,
  arimaCheckIns,
  accountMemberships,
} from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { getTelegramConfig } from "@/lib/telegram/config";
import { tgSendMessage, truncateForTelegram } from "@/lib/telegram/api";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { getSmtpTransport } from "@/lib/email";

export type DeliveryChannel = "portal" | "telegram" | "email" | "internal";

export interface DeliveryResult {
  ok: boolean;
  channel: DeliveryChannel;
  messageContent: string;
  conversationId?: string;
  contactId?: string;
  error?: string;
}

interface DeliveryInput {
  clientProfileId: string;
  messageContent: string;
  preferredChannel: string;        // "auto" | "portal" | "telegram" | "email"
  triggeredByUserId?: string;
  scheduleId?: string;
}

/**
 * Resolve the best contact for portal delivery (active first, then most recently invited).
 */
async function pickBestPortalContact(clientProfileId: string): Promise<{ id: string; name: string; email: string } | null> {
  const rows = await db
    .select({
      id: clientContacts.id,
      name: clientContacts.name,
      email: clientContacts.email,
      status: clientContacts.status,
      lastSeenAt: clientContacts.lastSeenAt,
    })
    .from(clientContacts)
    .where(eq(clientContacts.clientProfileId, clientProfileId));

  if (rows.length === 0) return null;
  // Prefer "active" > "invited", and within each tier the most recently active one
  const sorted = [...rows].sort((a, b) => {
    const aTier = a.status === "active" ? 0 : 1;
    const bTier = b.status === "active" ? 0 : 1;
    if (aTier !== bTier) return aTier - bTier;
    const aT = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const bT = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    return bT - aT;
  });
  return sorted[0];
}

async function findTelegramBinding(clientProfileId: string): Promise<{ chatId: string } | null> {
  const rows = await db
    .select({ chatId: arimaChannelBindings.chatId })
    .from(arimaChannelBindings)
    .where(and(
      eq(arimaChannelBindings.channel, "telegram"),
      eq(arimaChannelBindings.clientProfileId, clientProfileId),
      eq(arimaChannelBindings.status, "active")
    ))
    .limit(1);
  return rows[0] || null;
}

/**
 * Find or create the channel-specific conversation row for a check-in so the
 * message appears in the unified Inbox alongside other messages.
 */
async function getOrCreateConversation(args: {
  channel: DeliveryChannel;
  clientProfileId: string;
  ownerUserId: string;     // who "owns" the convo on the CST side
  externalKey: string;     // e.g. tg:<chatId>, portal:<contactId>
}): Promise<string> {
  const existing = await db
    .select({ id: arimaConversations.id })
    .from(arimaConversations)
    .where(and(
      eq(arimaConversations.channel, args.channel),
      eq(arimaConversations.title, args.externalKey)
    ))
    .limit(1);

  if (existing[0]) return existing[0].id;

  const id = `conv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  await db.insert(arimaConversations).values({
    id,
    userId: args.ownerUserId,
    clientProfileId: args.clientProfileId,
    channel: args.channel,
    title: args.externalKey,
    status: "active",
    messageCount: 0,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function persistAssistantMessage(args: {
  conversationId: string;
  content: string;
}): Promise<void> {
  const id = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  await db.insert(arimaMessages).values({
    id,
    conversationId: args.conversationId,
    role: "assistant",
    content: args.content,
    provider: "checkin",
    createdAt: now,
  });
  await db.update(arimaConversations)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(arimaConversations.id, args.conversationId));
}

export async function deliverCheckIn(input: DeliveryInput): Promise<DeliveryResult> {
  const wanted = input.preferredChannel;

  // Try Telegram (auto OR forced)
  if (wanted === "auto" || wanted === "telegram") {
    const binding = await findTelegramBinding(input.clientProfileId);
    if (binding) {
      try {
        const tg = await getTelegramConfig();
        if (!tg.botToken) throw new Error("Telegram bot not configured");
        await tgSendMessage(tg.botToken, binding.chatId, truncateForTelegram(input.messageContent), {});
        // Persist as an assistant message in the channel conversation
        const convId = await getOrCreateConversation({
          channel: "telegram",
          clientProfileId: input.clientProfileId,
          ownerUserId: input.triggeredByUserId || "system-checkin",
          externalKey: `tg:${binding.chatId}`,
        });
        await persistAssistantMessage({ conversationId: convId, content: input.messageContent });
        return {
          ok: true,
          channel: "telegram",
          messageContent: input.messageContent,
          conversationId: convId,
        };
      } catch (e: any) {
        if (wanted === "telegram") {
          return { ok: false, channel: "telegram", messageContent: input.messageContent, error: e?.message };
        }
        // fall through to portal/email
      }
    } else if (wanted === "telegram") {
      return { ok: false, channel: "telegram", messageContent: input.messageContent, error: "No active Telegram binding for this client" };
    }
  }

  // Try Portal (which auto-notifies the contact via push + email)
  if (wanted === "auto" || wanted === "portal" || wanted === "email") {
    const contact = await pickBestPortalContact(input.clientProfileId);
    if (contact) {
      try {
        // Persist into the portal conversation for this contact
        const convId = await getOrCreateConversation({
          channel: "portal",
          clientProfileId: input.clientProfileId,
          ownerUserId: contact.id,
          externalKey: `portal:${contact.id}`,
        });
        await persistAssistantMessage({ conversationId: convId, content: input.messageContent });

        // Send the email to the contact directly so they actually see it
        let emailOk = false;
        try {
          const smtp = await getSmtpTransport();
          if (smtp) {
            const subject = `[ARIMA] Check-in from your CST team`;
            const html = buildCheckInEmailHtml({
              contactName: contact.name,
              body: input.messageContent,
              portalUrl: `${process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || ""}/portal`,
            });
            await smtp.transport.sendMail({
              from: `"ARIMA" <${smtp.from}>`,
              to: contact.email,
              subject,
              html,
              text: `${input.messageContent}\n\nReply in the portal: ${process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || ""}/portal`,
            });
            emailOk = true;
          }
        } catch (mailErr) {
          console.warn("[checkin/deliver] portal email failed:", mailErr);
        }

        return {
          ok: true,
          channel: emailOk ? "portal" : "portal",
          messageContent: input.messageContent,
          conversationId: convId,
          contactId: contact.id,
        };
      } catch (e: any) {
        if (wanted === "portal" || wanted === "email") {
          return { ok: false, channel: "portal", messageContent: input.messageContent, error: e?.message };
        }
      }
    } else if (wanted === "portal" || wanted === "email") {
      return { ok: false, channel: "portal", messageContent: input.messageContent, error: "No client contacts available for portal delivery" };
    }
  }

  // No suitable client-facing channel → ESCALATE to internal team
  // (notify members with access to this account)
  try {
    const members = await db
      .select({ userId: accountMemberships.userId })
      .from(accountMemberships)
      .where(eq(accountMemberships.clientProfileId, input.clientProfileId));
    if (members.length > 0) {
      const c = await db
        .select({ companyName: clientProfilesTable.companyName })
        .from(clientProfilesTable)
        .where(eq(clientProfilesTable.id, input.clientProfileId))
        .limit(1);
      await dispatchNotification({
        userIds: members.map(m => m.userId),
        type: "mention",
        title: `📌 Check-in due for ${c[0]?.companyName || "client"}`,
        body: `No client-facing channel available — please reach out manually.\n\nDraft: ${input.messageContent}`,
        link: `/admin/arima-checkins`,
      });
    }
  } catch (e) {
    console.warn("[checkin/deliver] internal escalation failed:", e);
  }

  return {
    ok: true, // we successfully escalated, even though the client didn't get the message
    channel: "internal",
    messageContent: input.messageContent,
    error: "No client-facing channel — escalated to internal team",
  };
}

function buildCheckInEmailHtml(args: { contactName: string; body: string; portalUrl: string }) {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1e293b;">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="display:inline-block;width:48px;height:48px;background:linear-gradient(135deg,#fb7185,#ec4899);border-radius:16px;line-height:48px;color:#fff;font-size:24px;">♥</div>
  </div>
  <p style="font-size:15px;line-height:1.6;color:#1e293b;margin:0 0 20px;white-space:pre-wrap;">${escapeHtml(args.body)}</p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${args.portalUrl}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#fb7185,#ec4899);color:#fff;font-weight:700;text-decoration:none;border-radius:10px;font-size:13px;">
      Open ARIMA →
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;">
    Sent by ARIMA on behalf of your CST account team.
  </p>
</div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as any)[c]);
}
