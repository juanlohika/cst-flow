import { NextResponse } from "next/server";
import { PORTAL_COOKIE } from "@/lib/tools-portal/session";

export const dynamic = "force-dynamic";

/** POST /api/tools-portal/auth/logout: ends the Tools Portal session only. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete({ name: PORTAL_COOKIE, path: "/" });
  return res;
}
