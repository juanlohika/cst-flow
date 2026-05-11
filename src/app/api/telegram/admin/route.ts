import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getTelegramConfig,
  setTelegramBotToken,
  setTelegramBotUsername,
  clearTelegramConfig,
  ensureWebhookSecret,
} from "@/lib/telegram/config";
import {
  tgGetMe,
  tgSetWebhook,
  tgDeleteWebhook,
  tgGetWebhookInfo,
} from "@/lib/telegram/api";
import { db } from "@/db";
import { telegramAccountLinks, users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

function getWebhookUrl(req: Request): string {
  // Priority order:
  //   1. PUBLIC_BASE_URL (or NEXT_PUBLIC_BASE_URL) — explicit override
  //   2. AUTH_URL — already set in CST OS for NextAuth (most reliable)
  //   3. x-forwarded-host header from the reverse proxy
  //   4. host header (only safe if it's a real public hostname)
  //
  // The raw req.url often points at the internal container (e.g.
  // http://0.0.0.0:8080) on Firebase App Hosting, which Telegram rejects
  // because it requires public HTTPS on ports 80/88/443/8443.

  const envBase = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (envBase) {
    return `${envBase.replace(/\/$/, "")}/api/telegram/webhook`;
  }

  // NextAuth already needs the public URL, so AUTH_URL is usually correct.
  const authUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (authUrl && /^https:\/\//i.test(authUrl)) {
    return `${authUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  }

  const hdrs = req.headers;
  const forwardedHost = hdrs.get("x-forwarded-host") || hdrs.get("x-original-host") || "";
  const hostHeader = hdrs.get("host") || "";
  const candidate = (forwardedHost || hostHeader).split(",")[0].trim();
  const host = candidate.split(":")[0];

  if (!host || host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    throw new Error(
      "Could not determine the public hostname for the webhook. " +
        "Add PUBLIC_BASE_URL to your environment (e.g. https://your-domain.app) or set AUTH_URL."
    );
  }

  // Force HTTPS — Telegram won't accept HTTP webhooks.
  return `https://${host}/api/telegram/webhook`;
}

/**
 * GET /api/telegram/admin
 *   Returns: bot token (masked), bot username, webhook secret (masked), webhook URL, my-link status, current webhook info
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }
    await ensureAccessSchema();

    const config = await getTelegramConfig();
    let webhookUrl = "";
    try {
      webhookUrl = getWebhookUrl(req);
    } catch {
      webhookUrl = "(unresolved — set PUBLIC_BASE_URL in env)";
    }

    // Webhook live status (if token present)
    let webhookInfo: any = null;
    if (config.botToken) {
      try {
        webhookInfo = await tgGetWebhookInfo(config.botToken);
      } catch (e: any) {
        webhookInfo = { error: e.message };
      }
    }

    // My link status
    const myLinkRows = await db
      .select({
        id: telegramAccountLinks.id,
        telegramUserId: telegramAccountLinks.telegramUserId,
        telegramUsername: telegramAccountLinks.telegramUsername,
        telegramName: telegramAccountLinks.telegramName,
        linkedAt: telegramAccountLinks.linkedAt,
      })
      .from(telegramAccountLinks)
      .where(eq(telegramAccountLinks.cstUserId, session!.user!.id!))
      .limit(1);

    return NextResponse.json({
      botTokenSet: !!config.botToken,
      botToken: config.botToken
        ? `${config.botToken.slice(0, 6)}…${config.botToken.slice(-4)}`
        : null,
      botUsername: config.botUsername || null,
      webhookSecret: config.webhookSecret
        ? `${config.webhookSecret.slice(0, 6)}…${config.webhookSecret.slice(-4)}`
        : null,
      webhookUrl,
      webhookInfo,
      myLink: myLinkRows[0] || null,
    });
  } catch (error: any) {
    console.error("[telegram/admin GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/telegram/admin
 *   body: { action: "save-token", token } → save token + fetch bot info + register webhook
 *   body: { action: "register-webhook" } → re-register webhook
 *   body: { action: "delete-webhook" } → remove webhook on Telegram
 *   body: { action: "clear" }           → clear all bot config locally
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }
    await ensureAccessSchema();

    const body = await req.json();
    const action = body?.action;

    // Only compute the webhook URL for actions that need it
    let webhookUrl = "";
    try {
      if (action === "save-token" || action === "register-webhook") {
        webhookUrl = getWebhookUrl(req);
      }
    } catch (urlErr: any) {
      return NextResponse.json({ error: urlErr.message || "Could not determine webhook URL" }, { status: 400 });
    }

    if (action === "save-token") {
      const token = (body.token || "").trim();
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
        return NextResponse.json({ error: "That doesn't look like a valid Telegram bot token." }, { status: 400 });
      }
      await setTelegramBotToken(token);

      // Validate by calling getMe
      let me: any = null;
      try {
        me = await tgGetMe(token);
      } catch (e: any) {
        return NextResponse.json({ error: `Telegram rejected the token: ${e.message}` }, { status: 400 });
      }
      if (me?.username) await setTelegramBotUsername(me.username);

      // Register webhook with the rotated secret
      const secret = await ensureWebhookSecret();
      try {
        await tgSetWebhook(token, webhookUrl, secret);
      } catch (e: any) {
        return NextResponse.json({ error: `Webhook registration failed: ${e.message}` }, { status: 500 });
      }

      return NextResponse.json({ ok: true, botUsername: me.username, webhookUrl });
    }

    if (action === "register-webhook") {
      const config = await getTelegramConfig();
      if (!config.botToken) {
        return NextResponse.json({ error: "No bot token configured" }, { status: 400 });
      }
      const secret = await ensureWebhookSecret();
      await tgSetWebhook(config.botToken, webhookUrl, secret);
      return NextResponse.json({ ok: true, webhookUrl });
    }

    if (action === "delete-webhook") {
      const config = await getTelegramConfig();
      if (!config.botToken) {
        return NextResponse.json({ error: "No bot token configured" }, { status: 400 });
      }
      await tgDeleteWebhook(config.botToken);
      return NextResponse.json({ ok: true });
    }

    if (action === "clear") {
      const config = await getTelegramConfig();
      if (config.botToken) {
        try { await tgDeleteWebhook(config.botToken); } catch {}
      }
      await clearTelegramConfig();
      return NextResponse.json({ ok: true });
    }

    if (action === "unlink-me") {
      await db
        .delete(telegramAccountLinks)
        .where(eq(telegramAccountLinks.cstUserId, session!.user!.id!));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[telegram/admin POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
