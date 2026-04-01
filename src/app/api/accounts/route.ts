import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts
 * Lightweight account list for dropdowns and selectors
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter');

    const accounts = await db.select({
      id: clientProfilesTable.id,
      companyName: clientProfilesTable.companyName,
      industry: clientProfilesTable.industry,
      engagementStatus: clientProfilesTable.engagementStatus
    })
    .from(clientProfilesTable)
    .where(filter === 'mine' ? eq(clientProfilesTable.userId, userId) : undefined)
    .orderBy(asc(clientProfilesTable.companyName));

    return NextResponse.json(accounts);
  } catch (error: any) {
    console.error("Fetch accounts list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
