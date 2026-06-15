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
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return buildErrorRedirect(
      req.nextUrl.origin,
      "No token provided.",
      "missing",
      "Missing link",
    );
  }

  const h = await headers();
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
      result.code === "already_used"
        ? "Link already used"
        : result.code === "expired"
        ? "Link expired"
        : "Link invalid";
    return buildErrorRedirect(
      req.nextUrl.origin,
      result.reason,
      result.code,
      title,
    );
  }

  const redirectUrl = new URL(
    `/pin-validator/${result.session.projectId}`,
    req.nextUrl.origin,
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
