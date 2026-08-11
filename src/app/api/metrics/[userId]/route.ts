import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { courtesyCallMetric } from "@/lib/metrics/courtesy-calls";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics/[userId]?month=YYYY-MM
 *
 * One CST employee's scorecard for a month. Only the Courtesy Calls component is
 * computed from CST OS data today; the other areas of the manual sheet (Next
 * Steps, Projects, DAR, Usage) have no source here yet and are returned as
 * declared-but-unsourced so the page can show the real weighting without
 * inventing numbers.
 *
 * Visibility: an employee may read their OWN scorecard; admins may read anyone's.
 */
export async function GET(req: Request, { params }: { params: { userId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin && session.user.id !== params.userId) {
      return NextResponse.json({ error: "You can only view your own metrics." }, { status: 403 });
    }

    const url = new URL(req.url);
    const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }

    const who = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, params.userId)).limit(1);
    if (!who[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const cc = await courtesyCallMetric({ rmUserId: params.userId, month });

    // The areas still living in the spreadsheet. Declared with their real weights
    // so the page shows an honest denominator, and flagged as unsourced rather
    // than rendered as zero — a zero would read as "failed", not "not measured".
    const unsourced = [
      { area: "Relationship Management", metric: "KYC Completion", weight: 0.05 },
      { area: "Relationship Management", metric: "Next Steps / Meetings", weight: 0.15 },
      { area: "Project Management & BA", metric: "Project Work", weight: 0.50 },
      { area: "Client Support & Usage", metric: "DAR Completion", weight: 0.10 },
      { area: "Client Support & Usage", metric: "Usage Support", weight: 0.10 },
    ];
    const sourcedWeight = cc.weight;
    const declaredWeight = sourcedWeight + unsourced.reduce((s, u) => s + u.weight, 0);

    return NextResponse.json({
      user: who[0],
      month,
      courtesyCalls: cc,
      unsourced,
      totals: {
        sourcedWeight,
        declaredWeight,
        // Score across what we can actually measure, so the number is honest
        // about its own coverage rather than pretending to be an overall score.
        scoreOfSourced: sourcedWeight > 0 ? cc.weightedScore / sourcedWeight : 0,
        weightedScore: cc.weightedScore,
      },
    });
  } catch (error: any) {
    console.error("[metrics GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
