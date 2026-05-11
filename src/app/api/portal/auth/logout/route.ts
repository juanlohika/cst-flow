import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie, revokeSession } from "@/lib/portal/auth";

export const dynamic = "force-dynamic";

/** POST /api/portal/auth/logout — revoke session + clear cookie */
export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("arima_portal_session")?.value;
    if (sessionId) {
      await revokeSession(sessionId);
    }
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[portal/auth/logout] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
