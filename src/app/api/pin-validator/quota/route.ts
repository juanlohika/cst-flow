/**
 * GET /api/pin-validator/quota
 *
 * Returns the current month's geocoding usage state. Visible to ANY signed-in
 * CST OS user (not just admins) so the team-wide quota meter on the AI Tools
 * landing page shows for everyone. No mutations here — purely read.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCurrentUsage } from "@/lib/pin-validator/quota";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const state = await getCurrentUsage();
    return NextResponse.json(state);
  } catch (e: any) {
    console.error("[pin-validator/quota] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to read quota" },
      { status: 500 },
    );
  }
}
