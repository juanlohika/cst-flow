import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaRequests, clientProfiles as clientProfilesTable, users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/eliana/brds/[id] — full BRD detail including brdDocument markdown
 * and Google Doc link if exported.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db
      .select({
        id: arimaRequests.id,
        conversationId: arimaRequests.conversationId,
        title: arimaRequests.title,
        description: arimaRequests.description,
        category: arimaRequests.category,
        priority: arimaRequests.priority,
        status: arimaRequests.status,
        clientProfileId: arimaRequests.clientProfileId,
        clientName: clientProfilesTable.companyName,
        userId: arimaRequests.userId,
        userName: usersTable.name,
        createdAt: arimaRequests.createdAt,
        updatedAt: arimaRequests.updatedAt,
        brdDocument: arimaRequests.brdDocument,
        brdGeneratedAt: arimaRequests.brdGeneratedAt,
        brdGoogleDocId: arimaRequests.brdGoogleDocId,
        brdGoogleDocUrl: arimaRequests.brdGoogleDocUrl,
        brdGoogleDocSyncedAt: arimaRequests.brdGoogleDocSyncedAt,
        brdStatus: arimaRequests.brdStatus,
        brdError: arimaRequests.brdError,
      })
      .from(arimaRequests)
      .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaRequests.clientProfileId))
      .leftJoin(usersTable, eq(usersTable.id, arimaRequests.userId))
      .where(eq(arimaRequests.id, params.id))
      .limit(1);

    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (error: any) {
    console.error("[eliana/brds/id GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
