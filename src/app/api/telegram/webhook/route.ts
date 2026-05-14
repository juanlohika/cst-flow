import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  arimaConversations,
  arimaMessages,
  clientContacts,
  bindingContactAccess,
  accountMemberships,
  users as usersTable,
  telegramAccountLinks,
} from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getTelegramConfig } from "@/lib/telegram/config";
import {
  tgSendMessage,
  tgSendChatAction,
  tgFetchFile,
  isUserGroupAdmin,
  isGroupChatType,
  isPrivateChatType,
  truncateForTelegram,
} from "@/lib/telegram/api";
import { resolveCstUserFromTelegram, consumeLinkCode } from "@/lib/telegram/auth";
import {
  getActiveBindingForChat,
  findClientByAccessToken,
  createBinding,
  revokeBinding,
} from "@/lib/telegram/binding";
import { runArima, shouldArimaRespond, shouldElianaRespond, type MessageAttachment, type MentionRef } from "@/lib/arima/runtime";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { resolveTelegramMentions } from "@/lib/arima/mentions";
import { broadcastToClient } from "@/lib/portal/stream";

export const dynamic = "force-dynamic";

const WELCOME_GROUP_UNBOUND = (
  "Hi! I'm **ARIMA** — an AI Relationship Manager.\n\n" +
  "Before I can help, an admin must bind this group to a client account.\n\n" +
  "A CST OS admin should run `/bind <accessToken>` here (get the token from CST OS → Accounts → Access Control)."
);

const HELP_TEXT = (
  "**ARIMA commands**\n\n" +
  "Group admins (must also be linked to a CST OS admin account):\n" +
  "• `/bind <accessToken>` — bind this group to a client account\n" +
  "• `/unbind` — remove the binding\n\n" +
  "Anyone in a bound group:\n" +
  "• `/status` — show what client this group is bound to\n" +
  "• `/contacts` — list portal users + team members you can @mention\n" +
  "• `/mode` — see / switch the AI agent for this room (admin only)\n" +
  "• Just chat normally and I'll respond when @arima'd.\n\n" +
  "Private DM with the bot:\n" +
  "• `/link LK-XXXX-YYYY` — link your Telegram account to CST OS (generate the code from CST OS → Admin → Channels → Telegram → My Account)."
);

/** Helper to send a reply. Tries Markdown first; if that fails (e.g. malformed
 *  Markdown in the AI output), retries as plain text so the user gets *something*. */
async function safeReply(token: string, chatId: number, text: string, replyToMessageId?: number) {
  const finalText = truncateForTelegram(text || "(empty reply)");
  try {
    await tgSendMessage(token, chatId, finalText, {
      parseMode: "Markdown",
      replyToMessageId,
    });
  } catch (e: any) {
    console.error("[telegram/webhook] markdown reply failed, retrying as plain:", e?.message);
    try {
      await tgSendMessage(token, chatId, finalText, { replyToMessageId });
    } catch (e2: any) {
      console.error("[telegram/webhook] plain reply also failed:", e2?.message);
    }
  }
}

/**
 * POST /api/telegram/webhook
 * Receives every update from Telegram. Validates the secret header, dispatches
 * commands or chat to the right handler. Always returns 200 quickly — we don't
 * want Telegram retrying us.
 */
export async function POST(req: Request) {
  try {
    await ensureAccessSchema();

    const config = await getTelegramConfig();
    if (!config.botToken) {
      console.warn("[telegram/webhook] bot token not configured; ignoring update");
      return NextResponse.json({ ok: true, ignored: "no-token" });
    }

    // Verify Telegram secret header
    const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (config.webhookSecret && incomingSecret !== config.webhookSecret) {
      console.warn("[telegram/webhook] invalid secret header — rejecting");
      return NextResponse.json({ ok: false, error: "invalid secret" }, { status: 401 });
    }

    const update = await req.json();

    // We currently only handle message updates and my_chat_member (joined/left a group).
    const message = update?.message || update?.edited_message;
    if (!message) {
      return NextResponse.json({ ok: true, ignored: "non-message" });
    }

    const chat = message.chat;
    const from = message.from;
    const text: string = message.text || message.caption || "";
    const photos: any[] = Array.isArray(message.photo) ? message.photo : [];
    const entities: any[] = Array.isArray(message.entities)
      ? message.entities
      : (Array.isArray(message.caption_entities) ? message.caption_entities : []);
    if (!chat || !from || (!text && photos.length === 0)) {
      return NextResponse.json({ ok: true, ignored: "no-content" });
    }

    const isGroup = isGroupChatType(chat.type);
    const isPrivate = isPrivateChatType(chat.type);

    // ─── COMMAND DISPATCH ─────────────────────────────────────────────
    const cmdMatch = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/s);
    if (cmdMatch) {
      const cmd = cmdMatch[1].toLowerCase();
      const argText = (cmdMatch[2] || "").trim();

      if (cmd === "start" || cmd === "help") {
        const replyText = isGroup
          ? "Hi! I'm ARIMA. " + (await getActiveBindingForChat(chat.id))
              ? "This group is bound and ready. Just chat with me normally."
              : "This group isn't bound yet. " + HELP_TEXT
          : HELP_TEXT;
        await safeReply(config.botToken, chat.id, String(replyText), message.message_id);
        return NextResponse.json({ ok: true });
      }

      if (cmd === "link") {
        if (!isPrivate) {
          await safeReply(config.botToken, chat.id, "Please run `/link` in a private DM with me, not in a group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        if (!argText) {
          await safeReply(config.botToken, chat.id, "Send `/link <code>` where the code comes from CST OS → Admin → Channels → Telegram.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const result = await consumeLinkCode(argText, {
          id: from.id,
          username: from.username,
          first_name: from.first_name,
          last_name: from.last_name,
        });
        if (!result.ok) {
          await safeReply(config.botToken, chat.id, `❌ ${result.reason}`, message.message_id);
        } else {
          await safeReply(
            config.botToken,
            chat.id,
            "✅ Linked! Your Telegram account is now connected to your CST OS account. You can run admin commands (`/bind`, `/unbind`) in groups where you're also a group admin.",
            message.message_id
          );
        }
        return NextResponse.json({ ok: true });
      }

      if (cmd === "bind") {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "`/bind` only works in a group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        if (!argText) {
          await safeReply(config.botToken, chat.id, "Usage: `/bind <accessToken>`\nGet the token from CST OS → Accounts → [client] → Access Control.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // 1) Caller must be a Telegram group admin
        const isGroupAdmin = await isUserGroupAdmin(config.botToken, chat.id, from.id);
        if (!isGroupAdmin) {
          await safeReply(config.botToken, chat.id, "❌ You must be a Telegram group admin to run `/bind`.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // 2) Caller's Telegram account must be linked to a CST OS admin
        const cst = await resolveCstUserFromTelegram(from.id);
        if (!cst) {
          await safeReply(config.botToken, chat.id, "❌ Your Telegram isn't linked to a CST OS account.\nDM me `/link <code>` first (generate the code in CST OS → Admin → Channels → Telegram → My Account).", message.message_id);
          return NextResponse.json({ ok: true });
        }
        if (cst.role !== "admin") {
          await safeReply(config.botToken, chat.id, "❌ Only CST OS admins can bind groups. Ask an admin to do this for you.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // 3) Token must match a real client
        const client = await findClientByAccessToken(argText);
        if (!client) {
          await safeReply(config.botToken, chat.id, "❌ That access token doesn't match any client account. Double-check it in CST OS.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // All checks pass → create binding
        await createBinding({
          chatId: chat.id,
          chatTitle: chat.title || null,
          clientProfileId: client.id,
          boundByUserId: cst.cstUserId,
        });
        await safeReply(
          config.botToken,
          chat.id,
          `✅ This group is now bound to **${client.companyName}** (${client.clientCode || "no code"}).\nI'll respond as their AI Relationship Manager. Type a message to start.`,
          message.message_id
        );
        return NextResponse.json({ ok: true });
      }

      if (cmd === "unbind") {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "`/unbind` only works in a group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const isGroupAdmin = await isUserGroupAdmin(config.botToken, chat.id, from.id);
        if (!isGroupAdmin) {
          await safeReply(config.botToken, chat.id, "❌ You must be a Telegram group admin to run `/unbind`.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const cst = await resolveCstUserFromTelegram(from.id);
        if (!cst || cst.role !== "admin") {
          await safeReply(config.botToken, chat.id, "❌ Only CST OS admins can unbind groups.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const current = await getActiveBindingForChat(chat.id);
        if (!current) {
          await safeReply(config.botToken, chat.id, "ℹ️ This group isn't currently bound to anything.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        await revokeBinding(chat.id);
        await safeReply(config.botToken, chat.id, `✅ Unbound from **${current.clientName}**. I'll stop responding here until rebound.`, message.message_id);
        return NextResponse.json({ ok: true });
      }

      if (cmd === "status") {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "Run `/status` in a group to see its binding.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const current = await getActiveBindingForChat(chat.id);
        if (!current) {
          await safeReply(config.botToken, chat.id, "ℹ️ This group isn't bound to any client.", message.message_id);
        } else {
          await safeReply(
            config.botToken,
            chat.id,
            `📌 This group is bound to **${current.clientName}** (${current.clientCode || "no code"}).\nBound on ${current.boundAt.split("T")[0]}.`,
            message.message_id
          );
        }
        return NextResponse.json({ ok: true });
      }

      if (cmd === "mode") {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "Run `/mode` in a bound group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const current = await getActiveBindingForChat(chat.id);
        if (!current) {
          await safeReply(config.botToken, chat.id, "ℹ️ This group isn't bound yet. Run `/bind <token>` first.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // Only CST OS admins can change agent mode (it changes which AI leads the room)
        const cstUser = await resolveCstUserFromTelegram(from.id);
        if (!cstUser || cstUser.role !== "admin") {
          await safeReply(config.botToken, chat.id, "❌ Only CST OS admins can change the agent mode.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const target = (argText || "").toLowerCase().trim();
        if (target !== "arima" && target !== "eliana" && target !== "1" && target !== "2" && target !== "") {
          await safeReply(config.botToken, chat.id, "Usage: `/mode arima` (relationship) or `/mode eliana` (BA / requirements). Send `/mode` alone to see the current mode.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // Read current mode from the binding
        const { db } = await import("@/db");
        const { arimaChannelBindings } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const rows = await db
          .select({ id: arimaChannelBindings.id, agentMode: arimaChannelBindings.agentMode })
          .from(arimaChannelBindings)
          .where(eq(arimaChannelBindings.id, current.id))
          .limit(1);
        const currentMode = (rows[0] as any)?.agentMode || "arima";
        if (!target) {
          await safeReply(config.botToken, chat.id, `📌 Current mode: *${currentMode === "eliana" ? "Eliana — Business Analyst" : "ARIMA — Relationship Manager"}*.\n\nSwitch with \`/mode arima\` or \`/mode eliana\`.`, message.message_id);
          return NextResponse.json({ ok: true });
        }
        const next = (target === "eliana" || target === "2") ? "eliana" : "arima";
        await db.update(arimaChannelBindings)
          .set({ agentMode: next } as any)
          .where(eq(arimaChannelBindings.id, current.id));
        const banner = next === "eliana"
          ? "✅ Switched to *Eliana* — Business Analyst mode.\n\nEliana will proactively ask clarifying questions to understand the business case before recommending a solution. She references the Tarkie module catalog and existing playbook, and produces a structured requirements summary at the end."
          : "✅ Switched to *ARIMA* — Relationship Manager mode.\n\nARIMA responds when @mentioned and handles day-to-day client communication.";
        await safeReply(config.botToken, chat.id, banner, message.message_id);
        return NextResponse.json({ ok: true });
      }

      if (cmd === "contacts") {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "Run `/contacts` in a bound group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const current = await getActiveBindingForChat(chat.id);
        if (!current) {
          await safeReply(config.botToken, chat.id, "ℹ️ This group isn't bound yet. Run `/bind <token>` first.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const reply = await buildContactsDirectory(current.id, current.clientProfileId, current.clientName);
        await safeReply(config.botToken, chat.id, reply, message.message_id);
        return NextResponse.json({ ok: true });
      }

      // Unknown command
      await safeReply(config.botToken, chat.id, "Unknown command. Try `/help`.", message.message_id);
      return NextResponse.json({ ok: true });
    }

    // ─── NORMAL CHAT MESSAGE ─────────────────────────────────────────
    if (isGroup) {
      const binding = await getActiveBindingForChat(chat.id);
      if (!binding) {
        // Only send the welcome on the first un-bound message to avoid spam
        // (skip — Telegram doesn't penalize silence, and we don't want to nag).
        return NextResponse.json({ ok: true, ignored: "unbound-group" });
      }
      await handleArimaChat({
        botToken: config.botToken,
        chatId: chat.id,
        chatTitle: chat.title || null,
        userMessage: text,
        replyToMessageId: message.message_id,
        clientProfileId: binding.clientProfileId,
        bindingId: binding.id,
        agentMode: binding.agentMode,
        cstUserId: binding.boundByUserId || "system-telegram", // owner of the conversation row
        senderName: from.first_name || from.username || "Telegram user",
        senderTelegramId: String(from.id),
        senderTelegramUsername: from.username || null,
        channel: "telegram",
        photos,
        entities,
        isGroup: true,
      });
      return NextResponse.json({ ok: true });
    }

    if (isPrivate) {
      // DM with the bot — only respond if this Telegram user is linked AND has access to at least one client.
      const cst = await resolveCstUserFromTelegram(from.id);
      if (!cst) {
        await safeReply(
          config.botToken,
          chat.id,
          "I help CST teams manage their clients. To use me in DM, link your Telegram first: `/link <code>` (generate the code in CST OS → Admin → Channels → Telegram).",
          message.message_id
        );
        return NextResponse.json({ ok: true });
      }
      // For now, DM chat without a specific client just responds with general guidance.
      // (Phase 6+ will support a client picker via inline keyboard.)
      await safeReply(
        config.botToken,
        chat.id,
        "Hi! I work best inside a Telegram group bound to a specific client. For now in DM I can only help with general questions. Type `/help` to see commands.",
        message.message_id
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, ignored: "unhandled-chat-type" });
  } catch (error: any) {
    console.error("[telegram/webhook] crash:", error);
    // Always 200 so Telegram doesn't retry-storm
    return NextResponse.json({ ok: true, error: error.message });
  }
}

// ─── ARIMA chat handler (for bound groups) ───────────────────────────
async function handleArimaChat(args: {
  botToken: string;
  chatId: number;
  chatTitle: string | null;
  userMessage: string;
  replyToMessageId: number;
  clientProfileId: string;
  bindingId: string;
  agentMode: "arima" | "eliana";
  cstUserId: string;
  senderName: string;
  senderTelegramId: string;
  senderTelegramUsername: string | null;
  channel: string;
  photos: any[];
  entities: any[];
  isGroup: boolean;
}) {
  // Resolve the sender to a CST OS internal user if they've linked their Telegram.
  // Falls back to "external" attribution if no link exists (treats it as a client speaker).
  let senderCstUserId: string | null = null;
  let senderType: "internal" | "external" = "external";
  try {
    const linked = await resolveCstUserFromTelegram(args.senderTelegramId);
    if (linked?.cstUserId) {
      senderCstUserId = linked.cstUserId;
      senderType = "internal";
    }
  } catch {}

  // Parse @mentions out of the message entities + plain text. bindingId scopes
  // portal-contact resolution so a tag in group A can only resolve to contacts
  // routed to group A.
  const mentions: MentionRef[] = await resolveTelegramMentions({
    text: args.userMessage,
    entities: args.entities,
    clientProfileId: args.clientProfileId,
    bindingId: args.bindingId,
  }).catch(() => [] as MentionRef[]);

  // Pull the largest photo (Telegram sends multiple sizes); download to bytes.
  const attachments: MessageAttachment[] = [];
  if (args.photos?.length > 0) {
    const largest = [...args.photos].sort((a, b) =>
      (b.width * b.height) - (a.width * a.height)
    )[0];
    if (largest?.file_id) {
      const file = await tgFetchFile(args.botToken, largest.file_id).catch(() => null);
      if (file) {
        attachments.push({
          type: "image",
          mime: file.mime,
          width: largest.width,
          height: largest.height,
          source: "telegram",
          base64: file.buffer.toString("base64"),
        });
      }
    }
  }

  const hasArimaMention = mentions.some(m => m.type === "arima");

  // Find or create a conversation for this Telegram chat.
  const externalKey = `tg:${args.chatId}`;

  let convoId: string;
  const existing = await db
    .select({ id: arimaConversations.id })
    .from(arimaConversations)
    .where(
      and(
        eq(arimaConversations.channel, args.channel),
        eq(arimaConversations.title, externalKey)
      )
    )
    .limit(1);

  if (existing[0]) {
    convoId = existing[0].id;
  } else {
    convoId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(arimaConversations).values({
      id: convoId,
      userId: args.cstUserId,
      clientProfileId: args.clientProfileId,
      channel: args.channel,
      // Use the external key as title so we can find this convo again
      title: externalKey,
      status: "active",
      messageCount: 0,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Load prior history (cap at last 10 turns).
  const history = await db
    .select({
      role: arimaMessages.role,
      content: arimaMessages.content,
      senderName: arimaMessages.senderName,
    })
    .from(arimaMessages)
    .where(eq(arimaMessages.conversationId, convoId))
    .orderBy(asc(arimaMessages.createdAt));
  const trimmedHistory = history.slice(-10);

  const priorContents = trimmedHistory.map(m => ({
    role: m.role === "assistant" ? "model" as const : "user" as const,
    parts: [{ text: m.senderName ? `[${m.senderName}]: ${m.content}` : m.content }],
  }));

  // Decide whether to reply. Different gates per agent mode.
  const isFirstMessageInConvo = history.length === 0;
  // Look at the most recent assistant message to know if Eliana spoke last
  const lastAssistant = [...history].reverse().find(m => m.role === "assistant");
  const lastBotWasEliana = (lastAssistant?.senderName || "").toLowerCase().startsWith("eli");

  const shouldReply = args.agentMode === "eliana"
    ? shouldElianaRespond({
        isGroup: args.isGroup,
        text: args.userMessage,
        mentions,
        isFirstMessageInConvo,
        lastBotWasEliana,
      })
    : shouldArimaRespond({
        senderChannel: "telegram",
        isGroup: args.isGroup,
        text: args.userMessage,
        mentions,
        hasAttachments: attachments.length > 0,
      });

  // Show "typing" only if we'll actually reply
  if (shouldReply) {
    try { await tgSendChatAction(args.botToken, args.chatId, "typing"); } catch {}
  }

  try {
    const result = await runArima({
      conversationId: convoId,
      userId: args.cstUserId,
      clientProfileId: args.clientProfileId,
      userMessage: args.userMessage || (attachments.length > 0 ? "(photo)" : ""),
      priorContents,
      senderType,
      senderUserId: senderCstUserId,
      senderName: args.senderName,
      senderChannel: "telegram",
      attachments,
      mentions,
      skipModelCall: !shouldReply,
      agentMode: args.agentMode,
    });

    // Notify portal viewers for this client so they refresh and see the message
    broadcastToClient(args.clientProfileId, { type: "refresh" });

    if (!shouldReply) return; // silent listener mode — message stored, no reply

    const replyText = (result.replyText || "").trim();
    if (!replyText) {
      console.error("[telegram/webhook] ARIMA returned empty reply");
      await safeReply(
        args.botToken,
        args.chatId,
        "⚠️ I couldn't generate a reply for that message. This usually means the AI's safety filters blocked it or the conversation context got too long. Try asking again with shorter or simpler wording.",
        args.replyToMessageId
      );
      return;
    }
    await safeReply(args.botToken, args.chatId, replyText, args.replyToMessageId);
  } catch (e: any) {
    console.error("[telegram/webhook] ARIMA failed:", e);
    if (!shouldReply) return;
    const errMsg = e?.message || "unknown error";
    await safeReply(
      args.botToken,
      args.chatId,
      `⚠️ Sorry — I hit an error generating a reply.\n\n_${errMsg.slice(0, 300)}_\n\nA human teammate will follow up. You can also try a simpler version of your question.`,
      args.replyToMessageId
    );
  }
}

/**
 * Build the /contacts directory message for a bound group:
 *  - Portal contacts routed to THIS binding (preferred) or all contacts on
 *    the account if no per-binding grants exist yet.
 *  - Internal team members with their Telegram link status.
 *
 * Telegram's Markdown is picky — names with underscores or asterisks would
 * break it. We escape them defensively before formatting.
 */
async function buildContactsDirectory(bindingId: string, clientProfileId: string, clientName: string): Promise<string> {
  const escape = (s: string | null | undefined) => (s || "").replace(/([_*`\[\]()])/g, "\\$1");

  // Portal contacts: prefer the scoped list; fall back to all account contacts
  // when no per-binding grants exist yet (legacy migration path).
  const grants = await db
    .select({ contactId: bindingContactAccess.contactId })
    .from(bindingContactAccess)
    .where(eq(bindingContactAccess.bindingId, bindingId));
  let portalRows: { id: string; name: string; email: string; role: string | null }[];
  if (grants.length > 0) {
    portalRows = await db
      .select({ id: clientContacts.id, name: clientContacts.name, email: clientContacts.email, role: clientContacts.role })
      .from(clientContacts)
      .where(inArray(clientContacts.id, grants.map(g => g.contactId)));
  } else {
    portalRows = await db
      .select({ id: clientContacts.id, name: clientContacts.name, email: clientContacts.email, role: clientContacts.role })
      .from(clientContacts)
      .where(eq(clientContacts.clientProfileId, clientProfileId));
  }

  // Internal team for this account + telegram link badge
  const members = await db
    .select({
      userId: accountMemberships.userId,
      internalRole: accountMemberships.internalRole,
      isPrimary: accountMemberships.isPrimary,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(accountMemberships)
    .leftJoin(usersTable, eq(usersTable.id, accountMemberships.userId))
    .where(eq(accountMemberships.clientProfileId, clientProfileId));
  let linkByUserId = new Map<string, { telegramUsername: string | null }>();
  if (members.length > 0) {
    const links = await db
      .select({ cstUserId: telegramAccountLinks.cstUserId, telegramUsername: telegramAccountLinks.telegramUsername })
      .from(telegramAccountLinks)
      .where(and(
        inArray(telegramAccountLinks.cstUserId, members.map(m => m.userId)),
        eq(telegramAccountLinks.status, "active"),
      ));
    linkByUserId = new Map(links.map(l => [l.cstUserId, l]));
  }

  const lines: string[] = [];
  lines.push(`👥 *${escape(clientName)} — Contacts*`);
  lines.push("");
  if (portalRows.length > 0) {
    lines.push("*Portal users (chat via web):*");
    for (const c of portalRows) {
      const first = (c.name || "").split(/\s+/)[0] || "";
      const full = (c.name || "").replace(/\s+/g, "");
      const handles = [first, full !== first ? full : null].filter(Boolean).map(h => `\`@${h}\``).join(" or ");
      const roleStr = c.role ? ` (${escape(c.role)})` : "";
      lines.push(`• ${escape(c.name || c.email)}${roleStr} — tag with ${handles}`);
    }
  } else {
    lines.push("_No portal users routed to this group yet._");
  }
  lines.push("");
  if (members.length > 0) {
    lines.push("*Internal team:*");
    for (const m of members) {
      const link = linkByUserId.get(m.userId);
      const tg = link?.telegramUsername ? ` — \`@${link.telegramUsername}\`` : "";
      const role = m.internalRole ? ` (${escape(m.internalRole)})` : "";
      const primary = m.isPrimary ? " 👑" : "";
      lines.push(`• ${escape(m.name || m.email || "Team member")}${role}${primary}${tg}`);
    }
  }
  lines.push("");
  lines.push("_Tag a portal user with `@Name` and they'll get a notification on the web side. Internal `@usernames` work as native Telegram pings._");
  return lines.join("\n");
}
