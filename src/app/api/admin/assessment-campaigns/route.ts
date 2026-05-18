import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { assessmentCampaigns, assessmentCampaignTargets } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 };
  if ((session.user as any).role !== "admin") return { error: "Admin only", status: 403 };
  return null;
}

/**
 * GET  /api/admin/assessment-campaigns         → list (newest first)
 * POST /api/admin/assessment-campaigns         → create (draft)
 *
 * Body (POST): { title, description?, targetScope?, closesAt? }
 */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const rows = await db
      .select()
      .from(assessmentCampaigns)
      .orderBy(desc(assessmentCampaigns.createdAt));

    // Pull aggregate target counts per campaign for the list view
    const enriched = await Promise.all(rows.map(async (c) => {
      const targets = await db
        .select({
          id: assessmentCampaignTargets.id,
          rmUserId: assessmentCampaignTargets.rmUserId,
          submittedAt: assessmentCampaignTargets.submittedAt,
          emailSentAt: assessmentCampaignTargets.emailSentAt,
          emailError: assessmentCampaignTargets.emailError,
        })
        .from(assessmentCampaignTargets)
        .where(eq(assessmentCampaignTargets.campaignId, c.id));
      const rmSet = new Set(targets.map(t => t.rmUserId));
      return {
        ...c,
        rmCount: rmSet.size,
        accountCount: targets.length,
        submittedCount: targets.filter(t => t.submittedAt).length,
        emailsSent: targets.filter(t => t.emailSentAt).length,
        emailsFailed: targets.filter(t => t.emailError).length,
      };
    }));

    return NextResponse.json({ campaigns: enriched });
  } catch (error: any) {
    console.error("[assessment-campaigns GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const body = await req.json();
    if (!body?.title || typeof body.title !== "string") {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const id = `camp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(assessmentCampaigns).values({
      id,
      title: body.title.slice(0, 200),
      description: body?.description || null,
      ownerUserId: session!.user!.id!,
      status: "draft",
      targetScope: body?.targetScope ? JSON.stringify(body.targetScope) : null,
      closesAt: body?.closesAt || null,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    console.error("[assessment-campaigns POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
