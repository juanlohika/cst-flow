import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaRequests, clientProfiles as clientProfilesTable, projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/eliana/brds/[id]/promote
 *
 * Promotes an Eliana-captured BRD (arimaRequest with category='brd') into a
 * real Project row, then marks the BRD as 'converted' so it doesn't show up
 * as "still open" in the Eliana inbox.
 *
 * Auth: any signed-in CST OS user (not admin-restricted — your BAs need to
 * be able to do this without admin privileges).
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db
      .select({
        id: arimaRequests.id,
        title: arimaRequests.title,
        description: arimaRequests.description,
        clientProfileId: arimaRequests.clientProfileId,
        userId: arimaRequests.userId,
        category: arimaRequests.category,
        status: arimaRequests.status,
        createdAt: arimaRequests.createdAt,
      })
      .from(arimaRequests)
      .where(eq(arimaRequests.id, params.id))
      .limit(1);

    const brd = rows[0];
    if (!brd) return NextResponse.json({ error: "BRD not found" }, { status: 404 });
    if (brd.category !== "brd") {
      return NextResponse.json({ error: "Only category='brd' requests can be promoted to projects." }, { status: 400 });
    }

    // Resolve the client's company name for the project row
    let companyName = "Unknown";
    if (brd.clientProfileId) {
      const cp = await db
        .select({ companyName: clientProfilesTable.companyName })
        .from(clientProfilesTable)
        .where(eq(clientProfilesTable.id, brd.clientProfileId))
        .limit(1);
      if (cp[0]?.companyName) companyName = cp[0].companyName;
    }

    const projectId = `proj_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(projects).values({
      id: projectId,
      userId: session.user.id,
      name: brd.title.slice(0, 200),
      companyName,
      clientProfileId: brd.clientProfileId || null,
      startDate: now.split("T")[0],
      status: "active",
      defaultPaddingDays: 3,
      archived: false,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    });

    // Mark the BRD as converted so it stops appearing as "new"
    await db.update(arimaRequests)
      .set({ status: "converted", updatedAt: now })
      .where(eq(arimaRequests.id, brd.id));

    return NextResponse.json({ ok: true, projectId });
  } catch (error: any) {
    console.error("[eliana/brds/promote]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
