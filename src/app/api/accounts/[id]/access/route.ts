import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureClientCodeAndToken } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/access  → admin-only
 * Returns the clientCode (display) and accessToken (secret) for this account.
 * Auto-generates them if missing.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // Verify it exists
    const rows = await db
      .select({ id: clientProfilesTable.id, companyName: clientProfilesTable.companyName })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const { clientCode, accessToken } = await ensureClientCodeAndToken(params.id);
    return NextResponse.json({
      id: params.id,
      companyName: rows[0].companyName,
      clientCode,
      accessToken,
    });
  } catch (error: any) {
    console.error("[access GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
