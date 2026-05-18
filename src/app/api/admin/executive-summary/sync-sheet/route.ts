import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { syncExecutiveSummaryToSheet } from "@/lib/accounts/sheets-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/executive-summary/sync-sheet
 *
 * Pushes the latest Executive Summary into the live Google Sheet in the
 * Dashboards folder. Creates the Sheet on first run, updates in place after
 * that. Always runs the AI clustering pass so the Sheet stays current with
 * the same content as the in-app exec summary.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const result = await syncExecutiveSummaryToSheet({ includeAi: true });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[executive-summary sync-sheet]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
