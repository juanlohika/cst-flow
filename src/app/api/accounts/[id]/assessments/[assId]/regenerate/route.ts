import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountAssessments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { rollupAssessment } from "@/lib/accounts/assessment-rollup";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/[id]/assessments/[assId]/regenerate
 * Re-runs the AI rollup for an existing assessment using its stored responses.
 * Useful when the first attempt failed, or after we've updated the rollup prompt.
 */
export async function POST(_: Request, { params }: { params: { id: string; assId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db
      .select({ id: accountAssessments.id, clientProfileId: accountAssessments.clientProfileId })
      .from(accountAssessments)
      .where(eq(accountAssessments.id, params.assId))
      .limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    if (rows[0].clientProfileId !== params.id) return NextResponse.json({ error: "Assessment doesn't belong to this account" }, { status: 400 });

    // Mark as pending then re-run
    await db.update(accountAssessments)
      .set({ aiRollupStatus: "pending", aiRollupError: null, updatedAt: new Date().toISOString() })
      .where(eq(accountAssessments.id, params.assId));

    const result = await rollupAssessment({ assessmentId: params.assId });
    if (!result.ok) return NextResponse.json({ error: result.error || "AI rollup failed" }, { status: 500 });

    return NextResponse.json({ ok: true, summary: result.summary, risks: result.risks, opportunities: result.opportunities, notableRequests: result.notableRequests });
  } catch (error: any) {
    console.error("[assessments regenerate]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
