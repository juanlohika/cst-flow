import { NextResponse } from "next/server";
import { consumeMagicLink, setSessionCookie } from "@/lib/portal/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { notifyPortalJoinToTelegram } from "@/lib/portal/telegramJoin";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/auth/magic
 * Body: { token }
 *
 * Public endpoint (no NextAuth). Validates the magic-link token, creates a
 * session, sets the HTTP-only session cookie, and returns the portal session info.
 */
export async function POST(req: Request) {
  try {
    await ensureAccessSchema();
    const body = await req.json();
    const token = (body?.token || "").trim();
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const userAgent = req.headers.get("user-agent") || undefined;
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    const result = await consumeMagicLink(token, { userAgent, ipAddress });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    await setSessionCookie(result.sessionId);

    // First time this contact ever clicked their magic link → tell the team
    // in the bound Telegram group that they just joined the conversation.
    if (result.firstActivation) {
      notifyPortalJoinToTelegram({
        contactName: result.session.contactName,
        contactEmail: result.session.contactEmail,
        clientName: result.session.clientName,
        clientProfileId: result.session.clientProfileId,
      }).catch(err => console.warn("[portal/magic] telegram join notification failed:", err?.message));
    }

    return NextResponse.json({ session: result.session });
  } catch (error: any) {
    console.error("[portal/auth/magic] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
