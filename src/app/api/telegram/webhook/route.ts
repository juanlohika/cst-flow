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
import { lookupKeyByToken, findActiveBindingForKey } from "@/lib/telegram/bind-keys";
import { runArima, shouldArimaRespond, shouldElianaRespond, type MessageAttachment, type MentionRef } from "@/lib/arima/runtime";
import { loadActiveSuperAdminContext, extendSuperAdminContext } from "@/lib/super-admin/context";
import { superAdminContext as saCtxTable, superAdminUsers as saUsersTable } from "@/db/schema";
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
  "In RM team rooms (or the Super Admin GC):\n" +
  "• `/myaccounts` — list your accounts grouped by health\n" +
  "• `/redaccounts` — flagged-red accounts only\n" +
  "• `/overdue` — accounts overdue for CC or F2F\n" +
  "• `/ccstatus` — courtesy-call compliance snapshot\n" +
  "• `/maintenanceupdate` — maintenance-status update\n" +
  "• `/hypercarecheck` — accounts past 90-day hypercare window\n\n" +
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
 * Phase E.8 — Shared bind handler for both /bind <token> and /start BIND_<token>.
 * Validates: caller is a Telegram group admin AND a linked CST OS admin AND
 * the token matches a key whose key is not already bound elsewhere.
 * On success, creates the binding and posts a confirmation + capabilities msg.
 */
async function performKeyAwareBind(args: {
  botToken: string;
  chat: { id: number; title?: string };
  fromTelegramUserId: number;
  replyToMessageId: number;
  token: string;
}): Promise<void> {
  const { botToken, chat, fromTelegramUserId, replyToMessageId, token } = args;
  const isGroupAdmin = await isUserGroupAdmin(botToken, chat.id, fromTelegramUserId);
  if (!isGroupAdmin) {
    await safeReply(botToken, chat.id, "❌ You must be a Telegram group admin to bind this group.", replyToMessageId);
    return;
  }
  const cst = await resolveCstUserFromTelegram(fromTelegramUserId);
  if (!cst) {
    await safeReply(botToken, chat.id, "❌ Your Telegram isn't linked to a CST OS account.\nDM me `/link <code>` first (generate the code in CST OS → Admin → Channels → Telegram → My Account).", replyToMessageId);
    return;
  }
  if (cst.role !== "admin") {
    await safeReply(botToken, chat.id, "❌ Only CST OS admins can bind groups.", replyToMessageId);
    return;
  }

  const resolved = await lookupKeyByToken(token);
  if (!resolved) {
    await safeReply(botToken, chat.id, "❌ That bind token isn't valid or has been revoked. Generate a fresh one in CST OS → Admin → Telegram Bindings.", replyToMessageId);
    return;
  }

  // Refuse if this key is already actively bound to a DIFFERENT chat. Same chat
  // re-binding the same key is fine (no-op refresh).
  const existing = await findActiveBindingForKey(resolved.key.id);
  if (existing && existing.chatId !== String(chat.id)) {
    const where = existing.chatTitle ? `"${existing.chatTitle}"` : `chat ${existing.chatId}`;
    await safeReply(
      botToken,
      chat.id,
      `❌ This bind key is already in use by ${where}.\n\nIn CST OS → Admin → Telegram Bindings you can either:\n• Revoke that key (the old GC will stop receiving messages) and try again, or\n• Add a NEW key for this account ("+ Add Key") and use that link here instead.`,
      replyToMessageId,
    );
    return;
  }

  await createBinding({
    chatId: chat.id,
    chatTitle: chat.title || null,
    clientProfileId: resolved.clientProfileId,
    boundByUserId: cst.cstUserId,
    bindKeyId: resolved.key.id,
    scopeType: resolved.key.scopeType,
    scopeRef: resolved.key.scopeRef,
  });

  // Scope-aware confirmation message.
  if (resolved.key.scopeType === "rm-team") {
    await safeReply(
      botToken,
      chat.id,
      [
        `✅ This group is bound as **${resolved.key.label}**.`,
        `_${resolved.display.secondaryLine}_`,
        ``,
        `I'm **ARIMA**. I can see ${resolved.display.primaryLine.split("—")[1]?.trim() || "the RM's accounts"} and answer questions about any of them.`,
        ``,
        `Try:`,
        `• \`/myaccounts\` — full list with health colors`,
        `• \`/redaccounts\` — accounts that need attention`,
        `• \`/overdue\` — courtesy-call overdue accounts`,
        `• \`/ccstatus\` — full CC compliance snapshot`,
        `• \`@arima_tarkie_bot what's the package of MX?\` — natural-language single-account lookup`,
        ``,
        `Type \`/help\` for the full command list.`,
      ].join("\n"),
      replyToMessageId,
    );
  } else {
    await safeReply(
      botToken,
      chat.id,
      [
        `✅ This group is bound to **${resolved.display.primaryLine}** via key "**${resolved.key.label}**".`,
        ``,
        `I'm **ARIMA**, this account's AI Relationship Manager. I can help with:`,
        `• Pulling the account profile, meeting history, intelligence notes`,
        `• Scheduling meetings + capturing action items`,
        `• Drafting requests / BRDs (switch with \`/mode eliana\`)`,
        ``,
        `Just chat normally and @mention me when you want a reply. Type \`/help\` for the full command list.`,
      ].join("\n"),
      replyToMessageId,
    );
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
        // Phase E.8 — Deep-link bind. The CST OS admin generates a
        // t.me/<bot>?startgroup=BIND_<token> link; when an admin taps it
        // and picks a group, Telegram fires `/start BIND_<token>` here.
        if (cmd === "start" && argText.startsWith("BIND_") && isGroup) {
          await performKeyAwareBind({
            botToken: config.botToken,
            chat,
            fromTelegramUserId: from.id,
            replyToMessageId: message.message_id,
            token: argText.slice("BIND_".length),
          });
          return NextResponse.json({ ok: true });
        }
        // Phase 21: /start <consentToken> means a user tapped the permission-grant
        // button. Honor it ONLY in private chat (consent has to come from the
        // target themselves, not by anyone tapping in a group).
        if (cmd === "start" && argText && isPrivate) {
          const consumed = await consumeConsentToken({
            token: argText,
            botToken: config.botToken,
            tappingTelegramUserId: String(from.id),
            tappingTelegramUsername: from.username || null,
            tappingTelegramName: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
            tappingChatId: chat.id,
          });
          if (consumed.handled) {
            return NextResponse.json({ ok: true });
          }
          // Not a valid consent token → fall through to generic help
        }
        const replyText = isGroup
          ? ((await getActiveBindingForChat(chat.id))
              ? "Hi! I'm ARIMA. This group is bound and ready. Just chat with me normally."
              : "Hi! I'm ARIMA. This group isn't bound yet. " + HELP_TEXT)
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
          await safeReply(config.botToken, chat.id, "Usage: `/bind <accessToken>`\nGet the token from CST OS → Admin → Telegram Bindings.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        await performKeyAwareBind({
          botToken: config.botToken,
          chat,
          fromTelegramUserId: from.id,
          replyToMessageId: message.message_id,
          token: argText,
        });
        return NextResponse.json({ ok: true });
      }

      if (cmd === "sabind") {
        // Bind THIS Telegram group as the Super Admin Context.
        // Caller must be Telegram group admin + linked CST OS admin.
        // The bind token (from /admin/super-admin-context) must match an active draft.
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "`/sabind` only works in a group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        if (!argText) {
          await safeReply(config.botToken, chat.id, "Usage: `/sabind <token>`\nGet the token from CST OS → Admin → Super Admin Context.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const isGroupAdmin = await isUserGroupAdmin(config.botToken, chat.id, from.id);
        if (!isGroupAdmin) {
          await safeReply(config.botToken, chat.id, "❌ You must be a Telegram group admin to bind the Super Admin Context.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const cst = await resolveCstUserFromTelegram(from.id);
        if (!cst || cst.role !== "admin") {
          await safeReply(config.botToken, chat.id, "❌ Only CST OS admins can bind the Super Admin Context.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // Look up by bindToken
        const rows = await db.select().from(saCtxTable).where(eq(saCtxTable.bindToken, argText.trim())).limit(1);
        const ctx = rows[0];
        if (!ctx) {
          await safeReply(config.botToken, chat.id, "❌ That bind token isn't valid. Generate a new one in CST OS → Admin → Super Admin Context.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        if (ctx.status !== "active") {
          await safeReply(config.botToken, chat.id, `❌ That bind token is ${ctx.status}. Generate a new one.`, message.message_id);
          return NextResponse.json({ ok: true });
        }
        if (new Date(ctx.expiresAt).getTime() < Date.now()) {
          await safeReply(config.botToken, chat.id, "❌ That bind token has expired. Generate a new one.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // Update the row with the actual chat id
        await db.update(saCtxTable)
          .set({ telegramChatId: String(chat.id), boundAt: new Date().toISOString() })
          .where(eq(saCtxTable.id, ctx.id));

        // Auto-enable the Super Admin tools so ARIMA can actually answer
        // portfolio questions in this GC without an extra admin step.
        try {
          const { ensureSuperAdminToolsEnabled } = await import("@/lib/arima/tools/registry");
          await ensureSuperAdminToolsEnabled();
        } catch (e) {
          console.warn("[sabind] failed to auto-enable SA tools:", e);
        }

        const expiryStr = new Date(ctx.expiresAt).toLocaleString();
        await safeReply(
          config.botToken,
          chat.id,
          `✅ *Super Admin Context bound to this group.*\n\nExpires: ${expiryStr}\n\n⚠️ This GC now has access to portfolio-wide CRM data via ARIMA. Only allowlisted users can interact. Run \`/extend <hours>\` to push the expiry forward. Run \`/saunbind\` to revoke.\n\nData discussed here may not be repeated to other channels.`,
          message.message_id
        );
        return NextResponse.json({ ok: true });
      }

      if (cmd === "extend") {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "`/extend` only works inside the Super Admin group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const saCtx = await loadActiveSuperAdminContext();
        if (!saCtx || saCtx.telegramChatId !== String(chat.id)) {
          await safeReply(config.botToken, chat.id, "❌ This group isn't the bound Super Admin Context.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // Caller must be on the allowlist
        const cst = await resolveCstUserFromTelegram(from.id);
        if (!cst) {
          await safeReply(config.botToken, chat.id, "❌ Your Telegram account isn't linked to a CST OS account.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const allow = await db.select({ id: saUsersTable.id }).from(saUsersTable).where(eq(saUsersTable.cstUserId, cst.cstUserId)).limit(1);
        if (!allow[0]) {
          await safeReply(config.botToken, chat.id, "❌ You aren't on the Super Admin allowlist.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const hours = Math.max(1, Math.min(168, parseInt(argText, 10) || 24));
        const newExpiry = await extendSuperAdminContext({ hours, byUserId: cst.cstUserId });
        await safeReply(config.botToken, chat.id, `✅ Super Admin Context extended by ${hours}h.\nNew expiry: ${newExpiry ? new Date(newExpiry).toLocaleString() : "(unknown)"}`, message.message_id);
        return NextResponse.json({ ok: true });
      }

      if (cmd === "saunbind") {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "`/saunbind` only works in the bound Super Admin group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const cst = await resolveCstUserFromTelegram(from.id);
        if (!cst || cst.role !== "admin") {
          await safeReply(config.botToken, chat.id, "❌ Only CST OS admins can revoke the Super Admin Context.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        const now = new Date().toISOString();
        await db.update(saCtxTable)
          .set({ status: "revoked", revokedBy: cst.cstUserId, revokedAt: now })
          .where(eq(saCtxTable.status, "active"));
        await safeReply(config.botToken, chat.id, "✅ Super Admin Context revoked. ARIMA will stop providing portfolio data here.", message.message_id);
        return NextResponse.json({ ok: true });
      }

      // Phase E.7/E.9 — portfolio snapshot commands.
      // Works in SA GC (full portfolio) and in any RM team room (auto-scoped to that RM's accounts).
      const portfolioCommands = new Set([
        "ccstatus",
        "maintenanceupdate", "maintenance",
        "hypercarecheck",
        "myaccounts", "redaccounts", "overdue",
      ]);
      if (portfolioCommands.has(cmd)) {
        if (!isGroup) {
          await safeReply(config.botToken, chat.id, "This command only works in a bound group.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // Figure out scope: SA GC vs team room vs anything else
        const saCtx = await loadActiveSuperAdminContext();
        const inSaChat = !!(saCtx && saCtx.telegramChatId === String(chat.id));
        const binding = inSaChat ? null : await getActiveBindingForChat(chat.id);
        const inTeamRoom = !!(binding && binding.scopeType === "rm-team" && binding.scopeRef);

        if (!inSaChat && !inTeamRoom) {
          await safeReply(config.botToken, chat.id, "These commands only work in the Super Admin group or an RM team room.", message.message_id);
          return NextResponse.json({ ok: true });
        }
        // SA GC: only allowlisted users
        if (inSaChat) {
          const cst = await resolveCstUserFromTelegram(from.id);
          if (!cst) {
            await safeReply(config.botToken, chat.id, "❌ Your Telegram account isn't linked to a CST OS account.", message.message_id);
            return NextResponse.json({ ok: true });
          }
          const allow = await db.select({ id: saUsersTable.id }).from(saUsersTable).where(eq(saUsersTable.cstUserId, cst.cstUserId)).limit(1);
          if (!allow[0]) {
            await safeReply(config.botToken, chat.id, "❌ You aren't on the Super Admin allowlist.", message.message_id);
            return NextResponse.json({ ok: true });
          }
        }
        // Team room: any member of the GC can run these; scope is already enforced by the binding

        try {
          const rmUserId = inTeamRoom ? (binding!.scopeRef as string) : null;
          const { handlePortfolioCommand } = await import("@/lib/arima/portfolio-commands");
          const result = await handlePortfolioCommand({
            command: cmd,
            rmUserId,
            botToken: config.botToken,
            chatId: chat.id,
            replyToMessageId: message.message_id,
          });
          if (!result.posted && result.errorReason) {
            await safeReply(config.botToken, chat.id, `❌ ${result.errorReason}`, message.message_id);
          }
        } catch (e: any) {
          await safeReply(config.botToken, chat.id, `❌ Command failed: ${e?.message || "unknown"}`, message.message_id);
        }
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
        if (!current.clientProfileId) {
          await safeReply(config.botToken, chat.id, "`/contacts` only works in a client-bound group. Team rooms span multiple accounts, so there's no single contact directory.", message.message_id);
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
      // If no client binding, check whether this is the bound Super Admin GC.
      // SA GC has its own dedicated routing — portfolio mode (no clientProfileId).
      if (!binding) {
        const saCtx = await loadActiveSuperAdminContext();
        if (saCtx && saCtx.telegramChatId === String(chat.id)) {
          // Resolve the sender's CST user id — we need a real userId to own the
          // arimaConversations row (NOT NULL FK). If the sender isn't linked,
          // the SA gate inside handleArimaChat will refuse politely anyway.
          const senderCst = await resolveCstUserFromTelegram(from.id);
          await handleArimaChat({
            botToken: config.botToken,
            chatId: chat.id,
            chatTitle: chat.title || null,
            userMessage: text,
            replyToMessageId: message.message_id,
            clientProfileId: null,                          // portfolio mode — no client scope
            bindingId: `sa-${saCtx.id}`,
            agentMode: "arima",
            cstUserId: senderCst?.cstUserId || "",          // empty triggers the unauthenticated refusal path
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
        return NextResponse.json({ ok: true, ignored: "unbound-group" });
      }
      // Team-room bindings (rm-team) — clientProfileId is null. Resolve the
      // sender's cst user id so we have a valid conversation owner FK.
      if (binding.scopeType === "rm-team") {
        const senderCst = await resolveCstUserFromTelegram(from.id);
        await handleArimaChat({
          botToken: config.botToken,
          chatId: chat.id,
          chatTitle: chat.title || null,
          userMessage: text,
          replyToMessageId: message.message_id,
          clientProfileId: null,
          bindingId: binding.id,
          agentMode: binding.agentMode,
          cstUserId: senderCst?.cstUserId || binding.boundByUserId || "",
          senderName: from.first_name || from.username || "Telegram user",
          senderTelegramId: String(from.id),
          senderTelegramUsername: from.username || null,
          channel: "telegram",
          photos,
          entities,
          isGroup: true,
          rmTeamUserId: binding.scopeRef,
        });
        return NextResponse.json({ ok: true });
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
      // Phase 21: Any DM from a user counts as implicit consent that the bot
      // may DM them in the future. Record idempotently.
      try {
        const { recordDmConsent } = await import("@/lib/arima/coordinator");
        await recordDmConsent({
          telegramUserId: String(from.id),
          telegramUsername: from.username || null,
          telegramName: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
          grantedVia: "auto_first_dm",
        });
      } catch {}

      // Phase 21: Check if this DM is a REPLY to an active coordinator relay.
      // If so, relay the response back to the source GC.
      const relayHandled = await tryRelayDmReply({
        botToken: config.botToken,
        fromTelegramUserId: String(from.id),
        replyText: text,
        replyMessageId: message.message_id,
        photos,
      });
      if (relayHandled) return NextResponse.json({ ok: true });

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
  clientProfileId: string | null;
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
  /** Phase E.9 — team-room scope. When set, ARIMA is scoped to this RM's primary accounts. */
  rmTeamUserId?: string | null;
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

  // Portfolio (SA) mode short-circuit: if there's no client scope AND the
  // sender isn't a CST OS user, refuse politely and bail (we can't create the
  // conversation row without a valid userId FK).
  if (!args.clientProfileId && !args.cstUserId && !senderCstUserId) {
    try {
      await tgSendMessage(args.botToken, args.chatId, "Hi — this is a restricted Super Admin group. I can only respond to authorized members. Link your Telegram account first via DM with `/link <code>` and ask an admin to add you to the allowlist.", { replyToMessageId: args.replyToMessageId });
    } catch {}
    return;
  }
  // In portfolio mode, use the sender as the conversation owner.
  const conversationOwnerId = args.cstUserId || senderCstUserId || "";

  // Parse @mentions out of the message entities + plain text. bindingId scopes
  // portal-contact resolution so a tag in group A can only resolve to contacts
  // routed to group A. Skipped in portfolio (SA) mode — no client scope.
  const mentions: MentionRef[] = args.clientProfileId
    ? await resolveTelegramMentions({
        text: args.userMessage,
        entities: args.entities,
        clientProfileId: args.clientProfileId,
        bindingId: args.bindingId,
      }).catch(() => [] as MentionRef[])
    : [];

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
      userId: conversationOwnerId,
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

  let shouldReply = args.agentMode === "eliana"
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

  // Super Admin Context gate — when this chat is the bound SA GC, only
  // allowlisted users may interact with ARIMA. Polite refusal otherwise.
  // We do NOT bypass for /commands (those are handled above before this
  // function is even reached).
  // Use senderCstUserId (resolved from the actual message sender), NOT
  // args.cstUserId which is the conversation owner.
  if (shouldReply) {
    try {
      const saCtx = await loadActiveSuperAdminContext();
      if (saCtx && saCtx.telegramChatId === String(args.chatId)) {
        if (!senderCstUserId) {
          shouldReply = false;
          try {
            await tgSendMessage(args.botToken, args.chatId, "Hi — this is a restricted Super Admin group. I can only respond to authorized members. Link your Telegram account first via DM with `/link <code>` and ask an admin to add you to the allowlist.", { replyToMessageId: args.replyToMessageId });
          } catch {}
        } else {
          const allow = await db.select({ id: saUsersTable.id }).from(saUsersTable).where(eq(saUsersTable.cstUserId, senderCstUserId)).limit(1);
          if (!allow[0]) {
            shouldReply = false;
            try {
              await tgSendMessage(args.botToken, args.chatId, "Sorry — this is the Super Admin group. I can only respond to authorized members. Ask an admin to add you to the allowlist.", { replyToMessageId: args.replyToMessageId });
            } catch {}
          }
        }
      }
    } catch (e: any) {
      console.warn("[telegram/webhook] SA gate check failed:", e?.message);
    }
  }

  // Show "typing" only if we'll actually reply
  if (shouldReply) {
    try { await tgSendChatAction(args.botToken, args.chatId, "typing"); } catch {}
  }

  try {
    const result = await runArima({
      conversationId: convoId,
      userId: conversationOwnerId,
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
      // Phase 21: pass speaker context so send_telegram_dm can authority-check
      // and post permission-grant buttons back into the originating group.
      speakerTelegramUserId: args.senderTelegramId,
      sourceTelegramChatId: String(args.chatId),
      // Phase E.9 — team-room scope. runArima uses this to enable rm-team mode
      // (auto-filters portfolio tools to the RM's primary accounts).
      rmTeamUserId: args.rmTeamUserId || null,
    });

    // Notify portal viewers for this client so they refresh and see the message
    // (Skipped in portfolio mode — no per-client portal channel.)
    if (args.clientProfileId) {
      broadcastToClient(args.clientProfileId, { type: "refresh" });
    }

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

// ─── Phase 21: Consent / Relay handlers ────────────────────────────────

/**
 * Handle /start <consentToken> in a DM. Validates the token, records consent,
 * sends the queued DM body, marks the relay row as awaiting-reply.
 *
 * Strict mode: the user who taps MUST match the target the relay was intended
 * for (matched via Telegram user id). Prevents accidental cross-consent.
 *
 * Returns { handled: true } if the token was a valid consent token (caller
 * should stop processing); otherwise { handled: false } and the caller falls
 * through to normal /start help text.
 */
async function consumeConsentToken(args: {
  token: string;
  botToken: string;
  tappingTelegramUserId: string;
  tappingTelegramUsername: string | null;
  tappingTelegramName: string | null;
  tappingChatId: number;
}): Promise<{ handled: boolean }> {
  const { coordinatorRelays } = await import("@/db/schema");
  const { recordDmConsent } = await import("@/lib/arima/coordinator");
  const { tgSendMessage, truncateForTelegram } = await import("@/lib/telegram/api");

  const rows = await db
    .select()
    .from(coordinatorRelays)
    .where(eq(coordinatorRelays.consentToken, args.token))
    .limit(1);
  const relay = rows[0];
  if (!relay) return { handled: false };

  const now = new Date().toISOString();

  // Reject expired tokens
  if (relay.expiresAt && new Date(relay.expiresAt).getTime() < Date.now()) {
    await tgSendMessage(args.botToken, args.tappingChatId,
      "This permission link has expired. Ask the team to send a fresh one.",
      { parseMode: "Markdown" }
    );
    await db.update(coordinatorRelays)
      .set({ status: "timed-out" })
      .where(eq(coordinatorRelays.id, relay.id));
    return { handled: true };
  }

  // Reject already-consumed tokens
  if (relay.status !== "awaiting-consent") {
    await tgSendMessage(args.botToken, args.tappingChatId,
      "This permission link has already been used.",
      { parseMode: "Markdown" }
    );
    return { handled: true };
  }

  // STRICT: only the intended target can consent
  if (relay.targetTelegramUserId && relay.targetTelegramUserId !== args.tappingTelegramUserId) {
    await tgSendMessage(args.botToken, args.tappingChatId,
      `This invitation was sent to *${(relay.targetDisplayName || "someone else").replace(/[*_]/g, "")}*, not you. If they need a fresh link, ask the team.`,
      { parseMode: "Markdown" }
    );
    return { handled: true };
  }

  // Record consent (idempotent)
  await recordDmConsent({
    telegramUserId: args.tappingTelegramUserId,
    telegramUsername: args.tappingTelegramUsername,
    telegramName: args.tappingTelegramName,
    grantedVia: "button",
  });

  // Send the queued DM body
  const escape = (s: string) => (s || "").replace(/([_*`\[\]()])/g, "\\$1");
  const dmText = [
    `📨 *${escape(relay.requestedByName || "A teammate")}* asked me to relay this${relay.topic ? ` about *${escape(relay.topic)}*` : ""}:`,
    "",
    relay.pendingMessage || "(no content)",
    "",
    "_Reply to this DM and I'll relay your response back to the team._",
  ].join("\n");

  let sentMessageId = "";
  try {
    const sent = await tgSendMessage(args.botToken, args.tappingChatId, truncateForTelegram(dmText), {
      parseMode: "Markdown",
      disablePreview: true,
    });
    sentMessageId = String(sent?.message_id || "");
  } catch (e: any) {
    console.warn("[coordinator] failed to send DM after consent:", e?.message);
  }

  await db.update(coordinatorRelays)
    .set({
      status: "awaiting-reply",
      consentedAt: now,
      sentAt: now,
      sentMessageId,
    })
    .where(eq(coordinatorRelays.id, relay.id));

  // Also notify the source group that consent was granted (optional, helps the
  // requester know their message went out)
  if (relay.sourceTelegramChatId) {
    try {
      await tgSendMessage(args.botToken, relay.sourceTelegramChatId,
        `✅ ${escape(relay.targetDisplayName)} accepted the DM — message delivered. I'll post their reply here when they respond.`,
        { parseMode: "Markdown" }
      );
    } catch {}
  }

  return { handled: true };
}

/**
 * When a target replies in DM after a coordinator-relayed message, find the
 * matching open relay and post the reply back into the source GC.
 *
 * Returns true if the DM was handled as a relay reply (caller should stop
 * normal DM processing).
 */
async function tryRelayDmReply(args: {
  botToken: string;
  fromTelegramUserId: string;
  replyText: string;
  replyMessageId: number;
  photos: any[];
}): Promise<boolean> {
  const { coordinatorRelays } = await import("@/db/schema");
  const { tgSendMessage, truncateForTelegram } = await import("@/lib/telegram/api");

  // Find the most recent awaiting-reply relay for this target
  const rows = await db
    .select()
    .from(coordinatorRelays)
    .where(and(
      eq(coordinatorRelays.targetTelegramUserId, args.fromTelegramUserId),
      eq(coordinatorRelays.status, "awaiting-reply"),
    ))
    .orderBy(asc(coordinatorRelays.sentAt));
  const relay = rows[rows.length - 1]; // most recent
  if (!relay) return false;
  if (!relay.sourceTelegramChatId) return false;

  // Post the reply back to the source GC
  const escape = (s: string) => (s || "").replace(/([_*`\[\]()])/g, "\\$1");
  const heading = `💬 *${escape(relay.targetDisplayName)}* replied${relay.topic ? ` (re: *${escape(relay.topic)}*)` : ""}:`;
  const body = args.replyText.trim() || (args.photos.length > 0 ? "_(sent a photo)_" : "_(empty reply)_");
  const relayedText = `${heading}\n\n${body}`;

  try {
    await tgSendMessage(args.botToken, relay.sourceTelegramChatId, truncateForTelegram(relayedText), {
      parseMode: "Markdown",
      disablePreview: true,
    });
  } catch (e: any) {
    console.warn("[coordinator] failed to relay reply back:", e?.message);
  }

  await db.update(coordinatorRelays)
    .set({
      status: "replied",
      replyMessageId: String(args.replyMessageId),
      replyText: args.replyText.slice(0, 4000),
      repliedAt: new Date().toISOString(),
      relayedBackAt: new Date().toISOString(),
    })
    .where(eq(coordinatorRelays.id, relay.id));

  // Confirm to the target that their reply was relayed
  try {
    await tgSendMessage(args.botToken, args.fromTelegramUserId,
      `✓ Got it — I've passed your reply back to the team.`,
      { parseMode: "Markdown" }
    );
  } catch {}

  return true;
}
