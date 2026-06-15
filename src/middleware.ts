import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname.startsWith("/auth");
  const isAuthApi = pathname.startsWith("/api/auth");
  const isPublicApi = pathname.startsWith("/api/meetings/lookup") ||
                     pathname === "/api/debug-db" ||
                     pathname === "/api/branding" ||
                     pathname === "/api/telegram/webhook" ||
                     pathname.startsWith("/api/portal/") ||
                     // Pin Validator API: cookie-session auth + per-project
                     // permission checks in each route. The /pins endpoint
                     // gracefully falls back to internal CST OS auth when
                     // there's no cookie, so this is safe to expose.
                     pathname.startsWith("/api/pin-validator/") ||
                     /^\/api\/meetings\/[^/]+\/register$/.test(pathname) ||
                     /^\/api\/share\/[^/]+$/.test(pathname);
  const isPublicPage = pathname === "/" ||
                      pathname.startsWith("/meetings/attend") ||
                      pathname.startsWith("/meetings/scan") ||
                      pathname.startsWith("/share/") ||
                      pathname.startsWith("/portal") ||
                      pathname.startsWith("/addin") ||
                      // External validator UI — magic-link cookie session,
                      // not NextAuth. Don't bounce through Google sign-in.
                      pathname.startsWith("/pin-validator");

  // Allow auth-related paths to bypass middleware
  if (isAuthPage || isAuthApi) {
    return NextResponse.next();
  }

  // Allow public content
  if (isPublicPage || isPublicApi) {
    return NextResponse.next();
  }

  // Require authentication for everything else
  if (!req.auth) {
    const signInUrl = new URL("/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.xml|arima-portal-manifest\\.json|icon-.*\\.png|debug.txt|tarkie-logo.svg).*)"],
};
