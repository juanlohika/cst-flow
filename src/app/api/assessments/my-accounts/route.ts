import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  clientProfiles,
  accountMemberships,
  accountAssessments,
  assessmentCampaigns,
  assessmentCampaignTargets,
} from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { computeHealth, type HealthColor } from "@/lib/accounts/health-score";

export const dynamic = "force-dynamic";

const STALE_DAYS = 90;

/**
 * GET /api/assessments/my-accounts
 *
 * Returns a structured view of every account the current user is Primary RM
 * on, grouped for the redesigned /assessments queue page.
 *
 *   {
 *     campaignPending: [...]     // campaign-bound, not yet submitted
 *     neverAssessed:   [...]     // I'm Primary RM, no assessment ever
 *     stale:           [...]     // last assessment > 90 days old
 *     recent:          [...]     // assessed in last 90 days
 *   }
 *
 * Admins still only see accounts where THEY are Primary RM here — this view
 * is "what's on my plate" not "what's on the company's plate".
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const userId = session.user.id;

    // 1. Find every account where I'm Primary RM
    const myMemberships = await db
      .select({ clientProfileId: accountMemberships.clientProfileId })
      .from(accountMemberships)
      .where(and(
        eq(accountMemberships.userId, userId),
        eq(accountMemberships.isPrimary, true),
      ));
    const accountIds = myMemberships.map(m => m.clientProfileId);

    if (accountIds.length === 0) {
      return NextResponse.json({
        campaignPending: [],
        neverAssessed: [],
        stale: [],
        recent: [],
      });
    }

    // 2. Load those accounts
    const accounts = await db
      .select({
        id: clientProfiles.id,
        companyName: clientProfiles.companyName,
        industry: clientProfiles.industry,
        engagementStatus: clientProfiles.engagementStatus,
      })
      .from(clientProfiles)
      .where(inArray(clientProfiles.id, accountIds));

    // 3. Latest assessment per account
    const assessments = await db
      .select({
        id: accountAssessments.id,
        clientProfileId: accountAssessments.clientProfileId,
        submittedAt: accountAssessments.submittedAt,
        satisfaction: accountAssessments.satisfaction,
        ebaDecisionMaker: accountAssessments.ebaDecisionMaker,
        ebaAdmin: accountAssessments.ebaAdmin,
        v5Readiness: accountAssessments.v5Readiness,
        isTarkieSsot: accountAssessments.isTarkieSsot,
        thirdPartySsot: accountAssessments.thirdPartySsot,
        contactChangeRecent: accountAssessments.contactChangeRecent,
      })
      .from(accountAssessments)
      .where(inArray(accountAssessments.clientProfileId, accountIds))
      .orderBy(desc(accountAssessments.submittedAt));

    const latestByAccount = new Map<string, typeof assessments[number]>();
    for (const a of assessments) {
      if (!latestByAccount.has(a.clientProfileId)) {
        latestByAccount.set(a.clientProfileId, a);
      }
    }

    // 4. Campaign targets where I haven't submitted yet
    const campaignTargets = await db
      .select({
        id: assessmentCampaignTargets.id,
        clientProfileId: assessmentCampaignTargets.clientProfileId,
        campaignId: assessmentCampaignTargets.campaignId,
        campaignTitle: assessmentCampaigns.title,
        closesAt: assessmentCampaigns.closesAt,
        submittedAt: assessmentCampaignTargets.submittedAt,
        campaignStatus: assessmentCampaigns.status,
      })
      .from(assessmentCampaignTargets)
      .leftJoin(assessmentCampaigns, eq(assessmentCampaigns.id, assessmentCampaignTargets.campaignId))
      .where(eq(assessmentCampaignTargets.rmUserId, userId));

    const pendingCampaignByAccount = new Map<string, typeof campaignTargets[number]>();
    for (const t of campaignTargets) {
      if (!t.submittedAt && t.campaignStatus === "published") {
        // Most recent pending campaign wins
        const existing = pendingCampaignByAccount.get(t.clientProfileId);
        if (!existing || (t.closesAt && existing.closesAt && t.closesAt < existing.closesAt)) {
          pendingCampaignByAccount.set(t.clientProfileId, t);
        }
      }
    }

    // 5. Build the queue
    const now = Date.now();
    const stalenessThresholdMs = STALE_DAYS * 24 * 60 * 60 * 1000;

    const campaignPending: any[] = [];
    const neverAssessed: any[] = [];
    const stale: any[] = [];
    const recent: any[] = [];

    for (const account of accounts) {
      const latest = latestByAccount.get(account.id) || null;
      const health = computeHealth(latest ? {
        satisfaction: latest.satisfaction,
        ebaDecisionMaker: latest.ebaDecisionMaker,
        ebaAdmin: latest.ebaAdmin,
        v5Readiness: latest.v5Readiness,
        isTarkieSsot: latest.isTarkieSsot,
        thirdPartySsot: latest.thirdPartySsot,
        contactChangeRecent: latest.contactChangeRecent,
      } : null);
      const lastAssessedAt = latest?.submittedAt || null;
      const daysSince = lastAssessedAt
        ? Math.floor((now - new Date(lastAssessedAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;
      const isStale = lastAssessedAt && daysSince !== null && daysSince > STALE_DAYS;

      const campaignPendingForThis = pendingCampaignByAccount.get(account.id);

      const card = {
        accountId: account.id,
        companyName: account.companyName,
        industry: account.industry,
        engagementStatus: account.engagementStatus,
        health,
        lastAssessedAt,
        daysSince,
        campaign: campaignPendingForThis ? {
          id: campaignPendingForThis.campaignId,
          title: campaignPendingForThis.campaignTitle,
          closesAt: campaignPendingForThis.closesAt,
        } : null,
      };

      if (campaignPendingForThis) {
        campaignPending.push(card);
      } else if (!latest) {
        neverAssessed.push(card);
      } else if (isStale) {
        stale.push(card);
      } else {
        recent.push(card);
      }
    }

    // Sort: campaignPending by deadline asc; neverAssessed by name; stale by oldest;
    // recent by most-recently-assessed first
    campaignPending.sort((a, b) => {
      const aDate = a.campaign?.closesAt ? new Date(a.campaign.closesAt).getTime() : Infinity;
      const bDate = b.campaign?.closesAt ? new Date(b.campaign.closesAt).getTime() : Infinity;
      return aDate - bDate;
    });
    neverAssessed.sort((a, b) => a.companyName.localeCompare(b.companyName));
    stale.sort((a, b) => (b.daysSince || 0) - (a.daysSince || 0));
    recent.sort((a, b) => {
      const aTime = a.lastAssessedAt ? new Date(a.lastAssessedAt).getTime() : 0;
      const bTime = b.lastAssessedAt ? new Date(b.lastAssessedAt).getTime() : 0;
      return bTime - aTime;
    });

    return NextResponse.json({ campaignPending, neverAssessed, stale, recent });
  } catch (error: any) {
    console.error("[my-accounts]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
