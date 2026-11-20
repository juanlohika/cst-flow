import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OAuth2Client } from "google-auth-library";
import { PORTAL_COOKIE, SESSION_HOURS, STATE_COOKIE, isAllowedEmail, safeNext, signSession } from "@/lib/tools-portal/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools-portal/auth/callback
 * Google returns here. We verify the state, exchange the code, verify the ID
 * token, and admit any verified Google account on an allowed company domain.
 * No CST OS registration needed. Nothing is written to the database.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || url.origin;
  const fail = (reason: string) => {
    const r = NextResponse.redirect(`${origin}/tools?error=${encodeURIComponent(reason)}`);
    r.cookies.delete({ name: STATE_COOKIE, path: "/api/tools-portal" });
    return r;
  };

  let saved: { s?: string; n?: string } = {};
  try { saved = JSON.parse(cookies().get(STATE_COOKIE)?.value || "{}"); } catch {}
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return fail("cancelled");
  if (!code || !saved.s || url.searchParams.get("state") !== saved.s) return fail("expired");

  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) return fail("config");

  try {
    const client = new OAuth2Client(clientId, clientSecret, `${origin}/api/tools-portal/auth/callback`);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return fail("google");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
    const p = ticket.getPayload();
    const email = p?.email?.toLowerCase().trim();
    if (!email || !p?.email_verified) return fail("unverified");
    if (!isAllowedEmail(email)) {
      console.warn(`[tools-portal] blocked sign-in from outside allowed domains: ${email}`);
      return fail("domain");
    }

    console.log(JSON.stringify({ event: "tools_portal_sign_in", email }));
    const res = NextResponse.redirect(`${origin}${safeNext(saved.n)}`);
    res.cookies.set(PORTAL_COOKIE, signSession(email, p?.name || email), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600,
    });
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/tools-portal" });
    return res;
  } catch (e: any) {
    console.error(`[tools-portal] sign-in failed: ${e?.message}`);
    return fail("google");
  }
}
