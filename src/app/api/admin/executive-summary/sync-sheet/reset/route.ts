import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

const SETTING_KEY = "GOOGLE_ACCOUNT_HEALTH_SHEET_ID";

/**
 * POST /api/admin/executive-summary/sync-sheet/reset
 *
 * Clears the cached Google Sheet ID. Use this when a previously failed sync
 * left a stale ID pointing at an unusable Sheet (wrong folder, missing
 * permissions, etc). The next sync will create a fresh Sheet.
 *
 * Doesn't delete the old Sheet — the admin should clean that up in Drive
 * manually if they want.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    await db.delete(globalSettings).where(eq(globalSettings.key, SETTING_KEY));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[sync-sheet/reset]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
