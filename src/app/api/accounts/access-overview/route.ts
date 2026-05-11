import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  accountMemberships as membershipsTable,
} from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import {
  ensureAccessSchema,
  ensureClientCodeAndToken,
} from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/access-overview
 * Admin-only. Returns every account with its clientCode + accessToken + member count.
 * Auto-generates missing codes/tokens.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    await ensureAccessSchema();

    // Pull all accounts (admin sees all)
    const accounts = await db
      .select({
        id: clientProfilesTable.id,
        companyName: clientProfilesTable.companyName,
        industry: clientProfilesTable.industry,
        engagementStatus: clientProfilesTable.engagementStatus,
        clientCode: clientProfilesTable.clientCode,
        accessToken: clientProfilesTable.accessToken,
      })
      .from(clientProfilesTable)
      .orderBy(asc(clientProfilesTable.companyName));

    // Ensure each has a code + token (in-place fill if missing)
    const enriched = [];
    for (const a of accounts) {
      let clientCode = a.clientCode;
      let accessToken = a.accessToken;
      if (!clientCode || !accessToken) {
        const filled = await ensureClientCodeAndToken(a.id);
        clientCode = filled.clientCode;
        accessToken = filled.accessToken;
      }

      // Count members
      let memberCount = 0;
      try {
        const memRows = await db
          .select({ id: membershipsTable.id })
          .from(membershipsTable)
          .where(eq(membershipsTable.clientProfileId, a.id));
        memberCount = memRows.length;
      } catch {}

      enriched.push({
        id: a.id,
        companyName: a.companyName,
        industry: a.industry,
        engagementStatus: a.engagementStatus,
        clientCode,
        accessToken,
        memberCount,
      });
    }

    return NextResponse.json(enriched);
  } catch (error: any) {
    console.error("[access-overview] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
