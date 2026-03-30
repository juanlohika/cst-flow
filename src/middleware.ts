import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow NextAuth routes
  if (pathname.startsWith("/auth") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Allow public meeting attendee pages and their APIs
  if (
    pathname.startsWith("/meetings/attend") ||
    pathname.startsWith("/meetings/scan") ||
    pathname.startsWith("/api/meetings/lookup") ||
    /^\/api\/meetings\/[^/]+\/register$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Allow the home/explore page and debug routes without authentication
  if (pathname === "/" || pathname === "/api/debug-db") {
    return NextResponse.next();
  }

  // Require authentication for all other routes
  if (!req.auth) {
    const signInUrl = new URL("/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|debug.txt|api/debug-db).*)"],
};
