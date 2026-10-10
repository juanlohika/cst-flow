import { NextResponse } from "next/server";
import { getTelegramConfig } from "@/lib/telegram/config";
import { tgGetWebhookInfo } from "@/lib/telegram/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/telegram/diag?key=<PORTFOLIO_CRON_SECRET>
 *
 * Read-only Telegram delivery diagnostics.
 *
 * This exists because debugging "the bot did not answer" was otherwise
 * guesswork. The existing webhook-info view sits behind a NextAuth admin
 * session, so the one fact that settles whether Telegram is even DELIVERING
 * updates could not be checked while diagnosing — which led to three wrong
 * theories in a row on 10 Oct.
 *
 * Returns no secrets: the bot token is reported only as present/absent, and
 * the webhook URL is public by nature. Gated on the same shared secret the
 * cron routes use.
 *
 * What to read:
 *   pending_update_count > 0   Telegram is holding updates it could not deliver
 *   last_error_message         why delivery failed, and when
 *   allowed_updates            which update types we subscribed to
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const expected = process.env.PORTFOLIO_CRON_SECRET || "";
  if (!expected || key !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getTelegramConfig();
  if (!config?.botToken) {
    return NextResponse.json({ ok: false, reason: "no bot token configured" });
  }

  let info: any = null;
  try {
    info = await tgGetWebhookInfo(config.botToken);
  } catch (e: any) {
    info = { error: e?.message };
  }

  const r = info?.result ?? info;
  return NextResponse.json({
    ok: true,
    botUsername: config.botUsername || null,
    hasToken: true,
    hasWebhookSecret: !!config.webhookSecret,
    webhook: {
      url: r?.url ?? null,
      pending_update_count: r?.pending_update_count ?? null,
      last_error_date: r?.last_error_date
        ? new Date(r.last_error_date * 1000).toISOString() : null,
      last_error_message: r?.last_error_message ?? null,
      last_synchronization_error_date: r?.last_synchronization_error_date
        ? new Date(r.last_synchronization_error_date * 1000).toISOString() : null,
      max_connections: r?.max_connections ?? null,
      allowed_updates: r?.allowed_updates ?? null,
      has_custom_certificate: r?.has_custom_certificate ?? null,
    },
    now: new Date().toISOString(),
  });
}
