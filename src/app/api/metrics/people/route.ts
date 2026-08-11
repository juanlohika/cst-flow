import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountMemberships, users as usersTable } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics/people
 * People who can meaningfully have a scorecard — i.e. those holding PRIMARY
 * membership on at least one account. Admin-only, since it lists the team.
 * Deliberately not "all users": someone with no accounts has nothing to score.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await db
      .select({
        id: accountMemberships.userId,
        name: usersTable.name,
        email: usersTable.email,
        accounts: sql<number>`COUNT(*)`,
      })
      .from(accountMemberships)
      .leftJoin(usersTable, eq(usersTable.id, accountMemberships.userId))
      .where(eq(accountMemberships.isPrimary, true))
      .groupBy(accountMemberships.userId)
      .orderBy(sql`COUNT(*) DESC`);

    return NextResponse.json({
      people: rows.map(r => ({
        id: r.id,
        name: r.name || r.email || r.id,
        accounts: Number(r.accounts),
      })),
    });
  } catch (error: any) {
    console.error("[metrics people GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
