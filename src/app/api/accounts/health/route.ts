import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountAssessments } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { ensureAccessSchema, listAccessibleClientIds } from "@/lib/access/accounts";
import { computeHealth } from "@/lib/accounts/health-score";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/health
 * Returns a map of accountId → latest health snapshot, scoped to the actor's
 * accessible accounts. Admins get every account; non-admins only their own.
 *
 * Response shape:
 *   {
 *     accounts: {
 *       [accountId: string]: {
 *         color: 'green' | 'yellow' | 'red' | 'grey',
 *         score: number,
 *         reasons: string[],
 *         isCritical: boolean,
 *         lastAssessedAt: string | null,
 *       }
 *     }
 *   }
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowedIds = await listAccessibleClientIds({ userId: session.user.id, isAdmin });

    // Non-admin with no memberships → empty map (no leak)
    if (allowedIds !== null && allowedIds.length === 0) {
      return NextResponse.json({ accounts: {} });
    }

    // Fetch all assessments for allowed accounts, ordered by submittedAt desc
    // so the first occurrence per account is the latest.
    let q = db
      .select({
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
      .orderBy(desc(accountAssessments.submittedAt));

    const rows = allowedIds === null
      ? await q
      : await q.where(inArray(accountAssessments.clientProfileId, allowedIds));

    const latestPerAccount = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      if (!latestPerAccount.has(r.clientProfileId)) {
        latestPerAccount.set(r.clientProfileId, r);
      }
    }

    const accounts: Record<string, any> = {};
    latestPerAccount.forEach((latest, accountId) => {
      const health = computeHealth({
        satisfaction: latest.satisfaction,
        ebaDecisionMaker: latest.ebaDecisionMaker,
        ebaAdmin: latest.ebaAdmin,
        v5Readiness: latest.v5Readiness,
        isTarkieSsot: latest.isTarkieSsot,
        thirdPartySsot: latest.thirdPartySsot,
        contactChangeRecent: latest.contactChangeRecent,
      });
      accounts[accountId] = {
        color: health.color,
        score: health.score,
        reasons: health.reasons,
        isCritical: health.isCritical,
        lastAssessedAt: latest.submittedAt,
      };
    });

    return NextResponse.json({ accounts });
  } catch (error: any) {
    console.error("[accounts/health]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
