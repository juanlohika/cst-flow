/**
 * Fire a one-time "joined via portal" notification into the bound Telegram
 * group when an external contact first activates their magic link.
 *
 * Best-effort and fire-and-forget — failures are swallowed so they never
 * block the portal sign-in flow.
 */
import { db } from "@/db";
import { arimaChannelBindings } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function notifyPortalJoinToTelegram(args: {
  contactName: string;
  contactEmail: string;
  clientName: string;
  clientProfileId: string;
}): Promise<void> {
  // Is this client account bound to a Telegram group?
  const bindings = await db
    .select({ chatId: arimaChannelBindings.chatId, chatTitle: arimaChannelBindings.chatTitle })
    .from(arimaChannelBindings)
    .where(and(
      eq(arimaChannelBindings.clientProfileId, args.clientProfileId),
      eq(arimaChannelBindings.channel, "telegram"),
      eq(arimaChannelBindings.status, "active"),
    ));
  if (bindings.length === 0) return;

  const { getTelegramConfig } = await import("@/lib/telegram/config");
  const { tgSendMessage, truncateForTelegram } = await import("@/lib/telegram/api");
  const cfg = await getTelegramConfig();
  if (!cfg.botToken) return;

  const escape = (s: string) => s.replace(/([_*`\[\]()])/g, "\\$1");
  const text = [
    `👋 *${escape(args.contactName)}* (${escape(args.clientName)}) just joined the conversation via portal.`,
    `_${escape(args.contactEmail)}_`,
    "",
    "Their messages will appear here tagged with `via portal`. Reply normally — they'll see it on their end in real time.",
  ].join("\n");

  for (const b of bindings) {
    await tgSendMessage(cfg.botToken, b.chatId, truncateForTelegram(text), {
      parseMode: "Markdown",
      disablePreview: true,
    }).catch(() => {});
  }
}
