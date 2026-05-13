import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountMemberships } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/accounts/[id]/members/[userId]
 * Body: { internalRole?, isPrimary?, role? }
 *
 * Update a specific membership's fields. When setting isPrimary=true, we also
 * clear isPrimary on every other member of the same account (only one primary
 * per account).
 */
export async function PATCH(req: Request, { params }: { params: { id: string; userId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const updateData: any = {};
    if ("internalRole" in body) updateData.internalRole = body.internalRole || null;
    if ("role" in body) updateData.role = body.role;
    if ("isPrimary" in body) updateData.isPrimary = !!body.isPrimary;

    // If we're setting this one as Primary, clear the flag on all others first
    if (updateData.isPrimary === true) {
      await db
        .update(accountMemberships)
        .set({ isPrimary: false })
        .where(and(
          eq(accountMemberships.clientProfileId, params.id),
          ne(accountMemberships.userId, params.userId)
        ));
    }

    await db
      .update(accountMemberships)
      .set(updateData)
      .where(and(
        eq(accountMemberships.userId, params.userId),
        eq(accountMemberships.clientProfileId, params.id)
      ));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[members PATCH userId]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
