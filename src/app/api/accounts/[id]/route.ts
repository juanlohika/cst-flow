import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]
 * Single-account detail (used by /accounts/[id] page and the campaign email
 * links). Access-checked: non-admins must have AccountMembership.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db.select()
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const profile = rows[0];
    return NextResponse.json({
      ...profile,
      modulesAvailed: (() => { try { return JSON.parse(profile.modulesAvailed || "[]"); } catch { return []; } })(),
    });
  } catch (error: any) {
    console.error("[accounts/[id] GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
