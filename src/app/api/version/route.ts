import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/version — which build is actually serving.
 *
 * Public and unauthenticated on purpose. Without this there is no way to tell
 * from outside whether a push has finished deploying: middleware redirects every
 * other path to the sign-in page, so a route that does not exist yet and a route
 * that does return exactly the same 307. The only other middleware-exempt file
 * is a static debug.txt that has not changed since March.
 *
 * Returns no secrets — a schema marker, a feature list and a timestamp. The
 * feature list is what makes it useful: it names capabilities rather than a
 * commit hash, so "is the gathering work live yet?" is answerable without
 * looking up what hash was pushed.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    // Bumped by hand when a change should be externally detectable. Mirrors the
    // ACCESS_SCHEMA_VERSION naming so the two are easy to line up.
    build: "2026-10-08-arima-gathering",
    features: [
      "arima-gather-sessions",
      "arima-evidence-drive",
      "arima-rate-limit-throttle",
      "arima-retention-sweep",
    ],
    now: new Date().toISOString(),
  });
}
