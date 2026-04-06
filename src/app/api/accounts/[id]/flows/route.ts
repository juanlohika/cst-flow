import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable, savedWorks as savedWorksTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/flows
 * MIGRATED TO DRIZZLE
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = params.id;

    // Verify account belongs to this user
    const accountRows = await db.select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, accountId))
      .limit(1);
      
    if (accountRows.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const flows = await db.select()
      .from(savedWorksTable)
      .where(and(
        eq(savedWorksTable.appType, "architect"),
        eq(savedWorksTable.clientProfileId, accountId),
        eq(savedWorksTable.userId, userId)
      ))
      .orderBy(desc(savedWorksTable.updatedAt));

    // Group by flowCategory
    const asIs = flows.filter((f: any) => f.flowCategory === "as-is");
    const toBe = flows.filter((f: any) => f.flowCategory === "to-be");
    const uncategorized = flows.filter((f: any) => !f.flowCategory);

    return NextResponse.json({ asIs, toBe, uncategorized });
  } catch (error: any) {
    console.error("Account flows error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch flows" }, { status: 500 });
  }
}
