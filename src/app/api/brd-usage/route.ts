import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { brdGenerationLogs } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/** Signed in is enough — the log is deliberately visible to the whole team. */
function requireSignedIn(session: any): { error?: { status: number; message: string } } {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } };
  return {};
}

/**
 * GET /api/admin/brd-usage?limit=100
 *
 * Who has been generating BRDs, and when. Metadata only — the BRD body is
 * never stored, so there is nothing here to read over anyone's shoulder.
 *
 * Visible to the whole team: the point is to show the tool is being used, not
 * to monitor anyone. Titles and counts only, no document content.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const gate = requireSignedIn(session);
    if (gate.error) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }
    await ensureAccessSchema();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10) || 100, 500);

    const rows = await db
      .select()
      .from(brdGenerationLogs)
      .orderBy(desc(brdGenerationLogs.createdAt))
      .limit(limit);

    // Headline counts, computed in SQL so they cover the whole table rather
    // than only the page being shown.
    const [totals] = await db
      .select({
        total:   sql<number>`count(*)`,
        drafts:  sql<number>`sum(case when isFirstDraft = 1 then 1 else 0 end)`,
        failed:  sql<number>`sum(case when errorMessage is not null then 1 else 0 end)`,
        people:  sql<number>`count(distinct userId)`,
        last7:   sql<number>`sum(case when createdAt >= datetime('now','-7 days') then 1 else 0 end)`,
      })
      .from(brdGenerationLogs);

    // Per-person leaderboard — the question "is my team using it" is really
    // "which of them is using it".
    const byUser = await db
      .select({
        userId:   brdGenerationLogs.userId,
        userName: brdGenerationLogs.userName,
        runs:     sql<number>`count(*)`,
        drafts:   sql<number>`sum(case when isFirstDraft = 1 then 1 else 0 end)`,
        lastUsed: sql<string>`max(createdAt)`,
      })
      .from(brdGenerationLogs)
      .groupBy(brdGenerationLogs.userId, brdGenerationLogs.userName)
      .orderBy(desc(sql`count(*)`))
      .limit(50);

    return NextResponse.json({ rows, totals, byUser });
  } catch (error: any) {
    console.error("BRD usage log read failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
