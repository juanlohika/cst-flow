import { NextResponse } from "next/server";
import { clearSessionCookie, getPortalSession, revokeAllSessionsForContact } from "@/lib/portal/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/auth/logout/all
 * Revokes every active SubscriberSession for the current contact (across every
 * device they've signed in from). Used by the "sign out of all my devices"
 * button — the security panic switch for a lost laptop or phone.
 */
export async function POST() {
  try {
    const portal = await getPortalSession();
    if (!portal) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    await revokeAllSessionsForContact(portal.contactId);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[portal/auth/logout/all] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
