/**
 * GET /pin-validator/welcome?token=...
 *
 * Magic-link redemption endpoint. Implemented as a Route Handler (NOT a
 * Page) because Next.js only allows cookie WRITES from Route Handlers and
 * Server Actions — calling cookies().set() inside a Server Component
 * throws and triggers the "Server Components render" error the client saw.
 *
 * Flow:
 *   1. Read the token from the query string.
 *   2. Run consumePinValidatorMagicLink() against the DB.
 *   3. On success: set the HTTP-only cookie via the response, redirect
 *      to /pin-validator/<projectId>.
 *   4. On failure: redirect to /pin-validator/error?reason=...&code=...
 *      The error page is a plain Server Component (reads, no writes) so
 *      it renders the friendly card without a cookie-write tripping
 *      anything.
 */
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { consumePinValidatorMagicLink } from "@/lib/pin-validator/session";

export const dynamic = "force-dynamic";

const SESSION_COOKIE_NAME = "cst_pin_validator_session";
const SESSION_TTL_DAYS = 30;

// Firebase App Hosting runs the Next.js container with internal bind
// http://0.0.0.0:8080, so req.nextUrl.origin reports that internal value
// instead of the external https://cst-flow--... domain. NextResponse.redirect
// then writes that internal origin into the Location header, and the
// browser tries to follow it and fails ("0.0.0.0 refused to connect").
//
// The fix is to derive the external origin from the X-Forwarded-* headers
// the proxy sets, falling back to the hardcoded prod URL only as a last
// resort.
const PRODUCTION_BASE_URL = "https://cst-flow--cst-flowdesk.asia-east1.hosted.app";

function externalOrigin(req: NextRequest, hdrs: Headers): string {
  const forwardedHost = hdrs.get("x-forwarded-host") || hdrs.get("host");
  const forwardedProto = hdrs.get("x-forwarded-proto");
  if (forwardedHost && !/^(0\.0\.0\.0|127\.0\.0\.1|localhost)/i.test(forwardedHost)) {
    const proto = forwardedProto || "https";
    return `${proto}://${forwardedHost}`;
  }
  // req.nextUrl.origin is only trustworthy in non-containerized envs.
  // Use it only when the host is sensible; otherwise fall to prod.
  const origin = req.nextUrl.origin;
  if (origin && !/0\.0\.0\.0|127\.0\.0\.1/.test(origin)) {
    return origin;
  }
  return PRODUCTION_BASE_URL;
}

function buildErrorRedirect(
  origin: string,
  reason: string,
  code: string,
  title: string,
): NextResponse {
  const url = new URL("/pin-validator/error", origin);
  url.searchParams.set("title", title);
  url.searchParams.set("reason", reason);
  url.searchParams.set("code", code);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const h = await headers();
  const origin = externalOrigin(req, h);

  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return buildErrorRedirect(
      origin,
      "No token provided.",
      "missing",
      "Missing link",
    );
  }

  const userAgent = h.get("user-agent") || undefined;
  const ipAddress =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    undefined;

  const result = await consumePinValidatorMagicLink(token, {
    userAgent,
    ipAddress,
  });

  if (!result.ok) {
    const title =
      result.code === "expired"
        ? "Link expired"
        : "Link invalid";
    return buildErrorRedirect(origin, result.reason, result.code, title);
  }

  const redirectUrl = new URL(
    `/pin-validator/${result.session.projectId}`,
    origin,
  );
  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set(SESSION_COOKIE_NAME, result.sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
  return res;
}
