import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { assessmentCampaigns, assessmentCampaignTargets, accountAssessments, users, clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 };
  if ((session.user as any).role !== "admin") return { error: "Admin only", status: 403 };
  return null;
}

/**
 * GET    /api/admin/assessment-campaigns/[id]   → full detail + target rows
 * PATCH  /api/admin/assessment-campaigns/[id]   → edit (only while draft)
 * DELETE /api/admin/assessment-campaigns/[id]   → delete (only while draft)
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const rows = await db.select().from(assessmentCampaigns).where(eq(assessmentCampaigns.id, params.id)).limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const targets = await db
      .select({
        id: assessmentCampaignTargets.id,
        rmUserId: assessmentCampaignTargets.rmUserId,
        rmName: users.name,
        rmEmail: users.email,
        clientProfileId: assessmentCampaignTargets.clientProfileId,
        companyName: clientProfiles.companyName,
        emailSentAt: assessmentCampaignTargets.emailSentAt,
        emailError: assessmentCampaignTargets.emailError,
        submittedAt: assessmentCampaignTargets.submittedAt,
        submittedAssessmentId: assessmentCampaignTargets.submittedAssessmentId,
      })
      .from(assessmentCampaignTargets)
      .leftJoin(users, eq(users.id, assessmentCampaignTargets.rmUserId))
      .leftJoin(clientProfiles, eq(clientProfiles.id, assessmentCampaignTargets.clientProfileId))
      .where(eq(assessmentCampaignTargets.campaignId, params.id));

    return NextResponse.json({ campaign: rows[0], targets });
  } catch (error: any) {
    console.error("[campaign GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const rows = await db.select({ id: assessmentCampaigns.id, status: assessmentCampaigns.status }).from(assessmentCampaigns).where(eq(assessmentCampaigns.id, params.id)).limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (rows[0].status !== "draft") return NextResponse.json({ error: `Cannot edit a ${rows[0].status} campaign` }, { status: 400 });

    const body = await req.json();
    const updates: any = { updatedAt: new Date().toISOString() };
    if (typeof body?.title === "string") updates.title = body.title.slice(0, 200);
    if (typeof body?.description === "string" || body?.description === null) updates.description = body.description || null;
    if (body?.targetScope !== undefined) updates.targetScope = body.targetScope ? JSON.stringify(body.targetScope) : null;
    if (body?.closesAt !== undefined) updates.closesAt = body.closesAt || null;

    await db.update(assessmentCampaigns).set(updates).where(eq(assessmentCampaigns.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[campaign PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const rows = await db.select({ status: assessmentCampaigns.status }).from(assessmentCampaigns).where(eq(assessmentCampaigns.id, params.id)).limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (rows[0].status !== "draft") return NextResponse.json({ error: `Cannot delete a ${rows[0].status} campaign. Archive it instead.` }, { status: 400 });

    await db.delete(assessmentCampaigns).where(eq(assessmentCampaigns.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[campaign DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
