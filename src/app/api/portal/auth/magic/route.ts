import { NextResponse } from "next/server";
import { consumeMagicLink, getPortalSession, setSessionCookie } from "@/lib/portal/auth";
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
      // If the link is already used (or expired) BUT this device already has a
      // valid session, just hand them the existing session — no friction. They
      // probably re-clicked the email from a device they're already signed in on.
      if (result.errorCode === "already_used" || result.errorCode === "expired") {
        const existing = await getPortalSession();
        if (existing) {
          return NextResponse.json({ session: existing, alreadySignedIn: true });
        }
      }
      return NextResponse.json({
        error: result.reason,
        errorCode: result.errorCode || "invalid",
        contactEmail: result.contactEmail || null,
      }, { status: 400 });
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
