import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { assessmentCampaigns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { computeCampaignQueue, findAccountsMissingPrimaryRm } from "@/lib/accounts/campaign";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/assessment-campaigns/[id]/preview
 *
 * Returns the (RM, account) queue that would be created if this draft were
 * published right now — plus the list of in-scope accounts that DON'T have
 * a Primary RM tagged (admin needs to backfill those first).
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const rows = await db.select().from(assessmentCampaigns).where(eq(assessmentCampaigns.id, params.id)).limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const campaign = rows[0];

    const scope = campaign.targetScope ? safeParseJson(campaign.targetScope, {}) : {};
    const queue = await computeCampaignQueue(scope);
    const missingRm = await findAccountsMissingPrimaryRm(scope);

    // Group queue by RM for the UI
    const byRm = new Map<string, { rmName: string | null; rmEmail: string | null; accounts: Array<{ id: string; name: string }> }>();
    for (const q of queue) {
      if (!byRm.has(q.rmUserId)) {
        byRm.set(q.rmUserId, { rmName: q.rmName, rmEmail: q.rmEmail, accounts: [] });
      }
      byRm.get(q.rmUserId)!.accounts.push({ id: q.accountId, name: q.companyName });
    }
    const rmGroups: any[] = [];
    byRm.forEach((v, rmUserId) => {
      rmGroups.push({ rmUserId, ...v });
    });

    return NextResponse.json({
      rmGroups,
      totalRms: byRm.size,
      totalAccounts: queue.length,
      accountsMissingPrimaryRm: missingRm,
    });
  } catch (error: any) {
    console.error("[campaign preview]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function safeParseJson(raw: string, fb: any): any {
  try { return JSON.parse(raw); } catch { return fb; }
}
