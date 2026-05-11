import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { auth } from "@/auth";
import { asc, inArray } from "drizzle-orm";
import { listAccessibleClientIds } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts
 * Lightweight account list, filtered by AccountMembership for non-admins.
 * Admins see every account; non-admins see only accounts they have membership for.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isAdmin = (session.user as any)?.role === "admin";

    const allowedIds = await listAccessibleClientIds({ userId, isAdmin });

    // Non-admin with no memberships → return empty list (no leak)
    if (allowedIds !== null && allowedIds.length === 0) {
      return NextResponse.json([]);
    }

    const base = db.select({
      id: clientProfilesTable.id,
      companyName: clientProfilesTable.companyName,
      industry: clientProfilesTable.industry,
      engagementStatus: clientProfilesTable.engagementStatus,
      clientCode: clientProfilesTable.clientCode,
    })
    .from(clientProfilesTable)
    .orderBy(asc(clientProfilesTable.companyName));

    const accounts = allowedIds === null
      ? await base
      : await base.where(inArray(clientProfilesTable.id, allowedIds));

    return NextResponse.json(accounts);
  } catch (error: any) {
    console.error("Fetch accounts list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
