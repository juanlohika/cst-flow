import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { buildExecutiveSummary, clusterThemes } from "@/lib/accounts/executive-summary";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/executive-summary?ai=1
 *
 * Returns the cross-portfolio executive summary. Pass ?ai=1 to also run
 * the Gemini clustering pass (3-8 second cost). Default omits AI to keep
 * the page fast on first load — the UI fires a follow-up request to fill in
 * the AI section.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const summary = await buildExecutiveSummary();

    const { searchParams } = new URL(req.url);
    if (searchParams.get("ai") === "1") {
      await clusterThemes(summary);
    }

    return NextResponse.json(summary);
  } catch (error: any) {
    console.error("[executive-summary GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
