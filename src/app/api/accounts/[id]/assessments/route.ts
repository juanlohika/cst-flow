import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountAssessments, users as usersTable, assessmentCampaignTargets, assessmentCampaigns } from "@/db/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { rollupAssessment } from "@/lib/accounts/assessment-rollup";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/assessments
 * Returns the assessment history for this account, most-recent first.
 * Non-admins must have account membership.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db
      .select({
        id: accountAssessments.id,
        clientProfileId: accountAssessments.clientProfileId,
        submittedByUserId: accountAssessments.submittedByUserId,
        submittedByName: usersTable.name,
        campaignId: accountAssessments.campaignId,
        status: accountAssessments.status,
        satisfaction: accountAssessments.satisfaction,
        ebaDecisionMaker: accountAssessments.ebaDecisionMaker,
        ebaDecisionMakerNote: accountAssessments.ebaDecisionMakerNote,
        ebaAdmin: accountAssessments.ebaAdmin,
        ebaAdminNote: accountAssessments.ebaAdminNote,
        contactChangeRecent: accountAssessments.contactChangeRecent,
        contactChangeNote: accountAssessments.contactChangeNote,
        isTarkieSsot: accountAssessments.isTarkieSsot,
        thirdPartySsot: accountAssessments.thirdPartySsot,
        v5Readiness: accountAssessments.v5Readiness,
        requestedModules: accountAssessments.requestedModules,
        responsesJson: accountAssessments.responsesJson,
        aiSummary: accountAssessments.aiSummary,
        aiRisks: accountAssessments.aiRisks,
        aiOpportunities: accountAssessments.aiOpportunities,
        notableRequests: accountAssessments.notableRequests,
        aiRollupStatus: accountAssessments.aiRollupStatus,
        aiRollupError: accountAssessments.aiRollupError,
        aiRollupAt: accountAssessments.aiRollupAt,
        submittedAt: accountAssessments.submittedAt,
        updatedAt: accountAssessments.updatedAt,
      })
      .from(accountAssessments)
      .leftJoin(usersTable, eq(usersTable.id, accountAssessments.submittedByUserId))
      .where(eq(accountAssessments.clientProfileId, params.id))
      .orderBy(desc(accountAssessments.submittedAt));

    // Best-effort parse arrays for the client
    const enriched = rows.map(r => ({
      ...r,
      aiRisks: r.aiRisks ? safeParseJson(r.aiRisks, []) : [],
      aiOpportunities: r.aiOpportunities ? safeParseJson(r.aiOpportunities, []) : [],
      notableRequests: r.notableRequests ? safeParseJson(r.notableRequests, []) : [],
      requestedModules: r.requestedModules ? safeParseJson(r.requestedModules, []) : [],
    }));

    return NextResponse.json({ assessments: enriched });
  } catch (error: any) {
    console.error("[assessments GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/accounts/[id]/assessments
 * Submit a new Health Assessment. Fires the AI rollup in the background.
 *
 * Body shape:
 *   {
 *     satisfaction?: 1..5,
 *     ebaDecisionMaker?: 1..5, ebaDecisionMakerNote?: string,
 *     ebaAdmin?: 1..5, ebaAdminNote?: string,
 *     contactChangeRecent?: boolean, contactChangeNote?: string,
 *     isTarkieSsot?: boolean, thirdPartySsot?: string,
 *     v5Readiness?: 1..5,
 *     requestedModules?: string[],
 *     responses?: { [questionId]: string }  // long-text answers
 *   }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const id = `assess_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    // Auto-bind to a published campaign target if one exists for
    // (this RM, this account, not yet submitted). Picks the most recent.
    let resolvedCampaignId: string | null = body?.campaignId || null;
    let targetIdToMark: string | null = null;
    if (!resolvedCampaignId) {
      try {
        const candidateTargets = await db
          .select({
            id: assessmentCampaignTargets.id,
            campaignId: assessmentCampaignTargets.campaignId,
            status: assessmentCampaigns.status,
          })
          .from(assessmentCampaignTargets)
          .leftJoin(assessmentCampaigns, eq(assessmentCampaigns.id, assessmentCampaignTargets.campaignId))
          .where(and(
            eq(assessmentCampaignTargets.rmUserId, session.user.id),
            eq(assessmentCampaignTargets.clientProfileId, params.id),
            isNull(assessmentCampaignTargets.submittedAt),
          ))
          .orderBy(desc(assessmentCampaignTargets.createdAt))
          .limit(1);
        const target = candidateTargets.find(t => t.status === "published");
        if (target) {
          resolvedCampaignId = target.campaignId;
          targetIdToMark = target.id;
        }
      } catch (e) {
        // Non-fatal — assessment still gets stored without campaign linkage.
        console.warn("[assessments POST] auto-bind lookup failed:", e);
      }
    }

    await db.insert(accountAssessments).values({
      id,
      clientProfileId: params.id,
      submittedByUserId: session.user.id,
      campaignId: resolvedCampaignId,
      status: "submitted",
      satisfaction: clampScore(body?.satisfaction),
      ebaDecisionMaker: clampScore(body?.ebaDecisionMaker),
      ebaDecisionMakerNote: stringOrNull(body?.ebaDecisionMakerNote),
      ebaAdmin: clampScore(body?.ebaAdmin),
      ebaAdminNote: stringOrNull(body?.ebaAdminNote),
      contactChangeRecent: !!body?.contactChangeRecent,
      contactChangeNote: stringOrNull(body?.contactChangeNote),
      isTarkieSsot: typeof body?.isTarkieSsot === "boolean" ? body.isTarkieSsot : null,
      thirdPartySsot: stringOrNull(body?.thirdPartySsot),
      v5Readiness: clampScore(body?.v5Readiness),
      requestedModules: Array.isArray(body?.requestedModules) ? JSON.stringify(body.requestedModules) : null,
      responsesJson: body?.responses ? JSON.stringify(body.responses) : null,
      aiRollupStatus: "pending",
      submittedAt: now,
      updatedAt: now,
    });

    // Mark the campaign target as submitted (if we found one)
    if (targetIdToMark) {
      try {
        await db.update(assessmentCampaignTargets)
          .set({ submittedAt: now, submittedAssessmentId: id })
          .where(eq(assessmentCampaignTargets.id, targetIdToMark));
      } catch (e) {
        console.warn("[assessments POST] failed to mark campaign target submitted:", e);
      }
    }

    // Fire-and-forget AI rollup. Don't await — the API returns quickly and
    // the UI polls for status.
    (async () => {
      try {
        await rollupAssessment({ assessmentId: id });
      } catch (e: any) {
        console.warn("[assessments POST] rollup failed:", e?.message);
      }
    })();

    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    console.error("[assessments POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function clampScore(v: any): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isFinite(v)) return null;
  return Math.max(1, Math.min(5, Math.round(v)));
}
function stringOrNull(v: any): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}
function safeParseJson(raw: string, fallback: any): any {
  try { return JSON.parse(raw); } catch { return fallback; }
}
