import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  assessmentCampaigns,
  assessmentCampaignTargets,
  clientProfiles,
} from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/assessments/queue
 *
 * Returns the current user's pending Health Assessment items across all
 * published campaigns. Each item links to an account; submitting an
 * assessment for that account inside the campaign window auto-binds and
 * removes it from the queue.
 *
 * Response:
 *   {
 *     pending: [{ campaignId, campaignTitle, closesAt, accountId, companyName, industry }],
 *     submitted: [{ campaignId, campaignTitle, accountId, companyName, submittedAt }]
 *   }
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const userId = session.user.id;

    const targets = await db
      .select({
        id: assessmentCampaignTargets.id,
        campaignId: assessmentCampaignTargets.campaignId,
        campaignTitle: assessmentCampaigns.title,
        campaignStatus: assessmentCampaigns.status,
        closesAt: assessmentCampaigns.closesAt,
        accountId: assessmentCampaignTargets.clientProfileId,
        companyName: clientProfiles.companyName,
        industry: clientProfiles.industry,
        submittedAt: assessmentCampaignTargets.submittedAt,
        emailError: assessmentCampaignTargets.emailError,
      })
      .from(assessmentCampaignTargets)
      .leftJoin(assessmentCampaigns, eq(assessmentCampaigns.id, assessmentCampaignTargets.campaignId))
      .leftJoin(clientProfiles, eq(clientProfiles.id, assessmentCampaignTargets.clientProfileId))
      .where(eq(assessmentCampaignTargets.rmUserId, userId))
      .orderBy(desc(assessmentCampaignTargets.createdAt));

    // Only surface targets whose campaign is still published (not archived/closed-and-archived)
    const activeOrClosed = targets.filter(t => t.campaignStatus === "published" || t.campaignStatus === "closed");

    const pending = activeOrClosed.filter(t => !t.submittedAt && t.campaignStatus === "published");
    const submitted = activeOrClosed.filter(t => !!t.submittedAt);

    return NextResponse.json({ pending, submitted });
  } catch (error: any) {
    console.error("[assessments/queue]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
