import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { STATE_COOKIE, publicOrigin, safeNext } from "@/lib/tools-portal/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/tools-portal/auth/login?next=/tools/pdf-compressor
 * Starts Google sign-in for the Tools Portal (separate from CST OS sign-in).
 * Uses the same Google OAuth client as CST OS; its redirect URI
 * <origin>/api/tools-portal/auth/callback must be listed on that client.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const clientId = process.env.AUTH_GOOGLE_ID;
  if (!clientId) return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 503 });

  const state = randomBytes(24).toString("base64url");
  const next = safeNext(url.searchParams.get("next"));

  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.searchParams.set("client_id", clientId);
  google.searchParams.set("redirect_uri", `${origin}/api/tools-portal/auth/callback`);
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", "openid email profile");
  google.searchParams.set("state", state);
  google.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(google.toString());
  res.cookies.set(STATE_COOKIE, JSON.stringify({ s: state, n: next }), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/tools-portal", maxAge: 600,
  });
  return res;
}
