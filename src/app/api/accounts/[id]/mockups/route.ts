import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable, savedWorks as savedWorksTable, users as usersTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/mockups
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

    const mockups = await db.select({
      id: savedWorksTable.id,
      title: savedWorksTable.title,
      status: savedWorksTable.status,
      data: savedWorksTable.data,
      createdAt: savedWorksTable.createdAt,
      updatedAt: savedWorksTable.updatedAt,
      createdByName: usersTable.name,
    })
    .from(savedWorksTable)
    .leftJoin(usersTable, eq(usersTable.id, savedWorksTable.userId))
    .where(and(
      eq(savedWorksTable.appType, "mockup"),
      eq(savedWorksTable.clientProfileId, accountId),
      eq(savedWorksTable.userId, userId)
    ))
    .orderBy(desc(savedWorksTable.updatedAt));

    return NextResponse.json(mockups);
  } catch (error: any) {
    console.error("Account mockups error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch mockups" }, { status: 500 });
  }
}

/**
 * PATCH /api/accounts/[id]/mockups
 * MIGRATED TO DRIZZLE
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { mockupId, status } = await req.json();
    const validStatuses = ["open", "for_approval", "approved", "rejected"];
    if (!mockupId || !validStatuses.includes(status)) {
      return NextResponse.json({ error: "mockupId and valid status required" }, { status: 400 });
    }

    await db.update(savedWorksTable)
      .set({
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(and(
        eq(savedWorksTable.id, mockupId),
        eq(savedWorksTable.userId, userId),
        eq(savedWorksTable.appType, "mockup")
      ));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("PATCH /api/accounts/[id]/mockups error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
