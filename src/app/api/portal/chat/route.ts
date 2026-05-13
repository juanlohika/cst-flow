import { NextResponse } from "next/server";
import { db } from "@/db";
import { arimaConversations, arimaMessages, clientContacts, arimaChannelBindings, bindingContactAccess } from "@/db/schema";
import { and, eq, asc, inArray } from "drizzle-orm";
import { getPortalSession } from "@/lib/portal/auth";
import { runArima, shouldArimaRespond, type MessageAttachment } from "@/lib/arima/runtime";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { resolvePortalMentions, formatMentionsForTelegram } from "@/lib/arima/mentions";
import { broadcastToConversation } from "@/lib/portal/stream";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/chat → return the conversation history for this subscriber
 * POST /api/portal/chat → send a new message (text + optional image attachments).
 *
 * Auth: portal session cookie, NOT NextAuth.
 * Client scoping is automatic — the subscriber's clientProfileId is derived from
 * their ClientContact record, so they CANNOT change it.
 */

/**
 * Resolve which Telegram bindings this contact is allowed to see/post into.
 * Returns the binding chatIds. Phase 16 default policy: if the account has
 * any active bindings AND the contact has NO BindingContactAccess rows yet,
 * fall back to the FIRST binding (so legacy contacts created before Phase 16
 * keep working without an admin migration step).
 */
async function getAccessibleBindings(args: {
  contactId: string;
  clientProfileId: string;
}): Promise<Array<{ id: string; chatId: string }>> {
  const accountBindings = await db
    .select({ id: arimaChannelBindings.id, chatId: arimaChannelBindings.chatId })
    .from(arimaChannelBindings)
    .where(and(
      eq(arimaChannelBindings.clientProfileId, args.clientProfileId),
      eq(arimaChannelBindings.channel, "telegram"),
      eq(arimaChannelBindings.status, "active"),
    ));
  if (accountBindings.length === 0) return [];

  const granted = await db
    .select({ bindingId: bindingContactAccess.bindingId })
    .from(bindingContactAccess)
    .where(eq(bindingContactAccess.contactId, args.contactId));
  const allowedIds = new Set(granted.map(g => g.bindingId));
  const filtered = accountBindings.filter(b => allowedIds.has(b.id));
  if (filtered.length > 0) return filtered;

  // Backwards-compat: no explicit grant exists → fall back to the first binding
  // so legacy contacts don't lose access on the day this ships.
  return accountBindings.slice(0, 1);
}

async function findOrCreateConversation(args: {
  contactId: string;
  clientProfileId: string;
}): Promise<string> {
  const externalKey = `portal:${args.contactId}`;
  const existing = await db
    .select({ id: arimaConversations.id })
    .from(arimaConversations)
    .where(and(
      eq(arimaConversations.channel, "portal"),
      eq(arimaConversations.title, externalKey)
    ))
    .limit(1);

  if (existing[0]) return existing[0].id;

  const convId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  await db.insert(arimaConversations).values({
    id: convId,
    userId: args.contactId,
    clientProfileId: args.clientProfileId,
    channel: "portal",
    title: externalKey,
    status: "active",
    messageCount: 0,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return convId;
}

export async function GET() {
  try {
    await ensureAccessSchema();
    const portal = await getPortalSession();
    if (!portal) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const conversationId = await findOrCreateConversation({
      contactId: portal.contactId,
      clientProfileId: portal.clientProfileId,
    });

    // The portal conversation (this contact's own thread) is always visible.
    // Plus: any Telegram-channel conversation whose binding the contact has
    // access to. NOT every Telegram conversation tied to the account.
    const accessible = await getAccessibleBindings({
      contactId: portal.contactId,
      clientProfileId: portal.clientProfileId,
    });
    const accessibleChatTitles = new Set(accessible.map(b => `tg:${b.chatId}`));

    const convoRows = await db
      .select({
        id: arimaConversations.id,
        channel: arimaConversations.channel,
        title: arimaConversations.title,
      })
      .from(arimaConversations)
      .where(eq(arimaConversations.clientProfileId, portal.clientProfileId));

    const visibleConvoIds = convoRows
      .filter(c => c.id === conversationId
        || c.channel === "portal" && c.id === conversationId
        || (c.channel === "telegram" && c.title && accessibleChatTitles.has(c.title)))
      .map(c => c.id);

    const msgs = visibleConvoIds.length === 0 ? [] : await db
      .select({
        id: arimaMessages.id,
        conversationId: arimaMessages.conversationId,
        role: arimaMessages.role,
        content: arimaMessages.content,
        senderType: arimaMessages.senderType,
        senderName: arimaMessages.senderName,
        senderChannel: arimaMessages.senderChannel,
        mentions: arimaMessages.mentions,
        attachments: arimaMessages.attachments,
        createdAt: arimaMessages.createdAt,
      })
      .from(arimaMessages)
      .where(inArray(arimaMessages.conversationId, visibleConvoIds))
      .orderBy(asc(arimaMessages.createdAt));

    return NextResponse.json({
      session: portal,
      conversationId,
      messages: msgs.map(m => ({
        ...m,
        mentions: m.mentions ? JSON.parse(m.mentions) : [],
        attachments: m.attachments ? JSON.parse(m.attachments) : [],
      })),
    });
  } catch (error: any) {
    console.error("[portal/chat GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureAccessSchema();
    const portal = await getPortalSession();
    if (!portal) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const rawText = (body?.message || "").trim();
    const incomingAttachments: MessageAttachment[] = Array.isArray(body?.attachments) ? body.attachments : [];
    if (!rawText && incomingAttachments.length === 0) {
      return NextResponse.json({ error: "Message or attachment required" }, { status: 400 });
    }

    const conversationId = await findOrCreateConversation({
      contactId: portal.contactId,
      clientProfileId: portal.clientProfileId,
    });

    // Resolve @mentions ahead of time so we can both display them and route notifications
    const { mentions, cleanText } = await resolvePortalMentions({
      text: rawText,
      clientProfileId: portal.clientProfileId,
    });

    // Pull prior history (last 12 turns for context)
    const history = await db
      .select({
        role: arimaMessages.role,
        content: arimaMessages.content,
        senderName: arimaMessages.senderName,
      })
      .from(arimaMessages)
      .where(eq(arimaMessages.conversationId, conversationId))
      .orderBy(asc(arimaMessages.createdAt));
    const priorContents = history.slice(-12).map(m => ({
      role: m.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: m.senderName ? `[${m.senderName}]: ${m.content}` : m.content }],
    }));

    // Portal chat is treated as a "group" when this contact has access to at
    // least one Telegram binding — that's where their human teammates live.
    const accessible = await getAccessibleBindings({
      contactId: portal.contactId,
      clientProfileId: portal.clientProfileId,
    });
    const isGroup = accessible.length > 0;

    const shouldReply = shouldArimaRespond({
      senderChannel: "portal",
      isGroup,
      text: cleanText,
      mentions,
      hasAttachments: incomingAttachments.length > 0,
    });

    const result = await runArima({
      conversationId,
      userId: portal.contactId,
      clientProfileId: portal.clientProfileId,
      userMessage: cleanText || (incomingAttachments.length > 0 ? "(photo)" : ""),
      priorContents,
      senderType: "external",
      senderUserId: portal.contactId,
      senderName: portal.contactName,
      senderChannel: "portal",
      attachments: incomingAttachments,
      mentions,
      skipModelCall: !shouldReply,
    });

    // Refresh contact lastSeenAt
    await db.update(clientContacts)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(clientContacts.id, portal.contactId))
      .catch(() => {});

    // Bridge outbound to Telegram — but ONLY to the bindings this contact
    // has explicit access to (Phase 16). Previously this fired into every
    // bound Telegram group for the account, which leaked the message across
    // contexts the client wasn't meant to see.
    for (const b of accessible) {
      bridgePortalMessageToTelegram({
        chatId: b.chatId,
        senderName: portal.contactName,
        clientName: portal.clientName,
        text: formatMentionsForTelegram(cleanText, mentions),
        hasImages: incomingAttachments.length > 0,
        arimaReply: shouldReply ? (result.replyText || "") : "",
      }).catch(err => console.warn("[portal/chat] bridge to telegram failed:", err?.message));
    }

    // Push to SSE listeners
    broadcastToConversation(conversationId, { type: "refresh" });

    return NextResponse.json({
      content: result.replyText,
      skipped: !!result.skipped,
      conversationId,
      capturedRequest: result.capturedRequestId
        ? { id: result.capturedRequestId, title: result.capturedRequest!.title }
        : null,
    });
  } catch (error: any) {
    console.error("[portal/chat POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function bridgePortalMessageToTelegram(args: {
  chatId: string;
  senderName: string;
  clientName: string;
  text: string;
  hasImages: boolean;
  arimaReply: string;
}): Promise<void> {
  const { getTelegramConfig } = await import("@/lib/telegram/config");
  const { tgSendMessage, truncateForTelegram } = await import("@/lib/telegram/api");
  const cfg = await getTelegramConfig();
  if (!cfg.botToken) return;

  const header = `💬 *${args.senderName}* (${args.clientName}, via portal)`;
  const body = args.text || (args.hasImages ? "_sent an image_" : "");
  const message = `${header}\n${body}`;
  await tgSendMessage(cfg.botToken, args.chatId, truncateForTelegram(message), {
    parseMode: "Markdown",
    disablePreview: true,
  }).catch(() => {});

  if (args.arimaReply?.trim()) {
    await tgSendMessage(cfg.botToken, args.chatId, truncateForTelegram(args.arimaReply), {
      parseMode: "Markdown",
      disablePreview: true,
    }).catch(() => {});
  }
}
