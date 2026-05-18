import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountModules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/account-modules/[id] — admin only. Update label / description /
 * sortOrder / isActive. Don't allow changing the slug to avoid breaking
 * stored modulesAvailed values on accounts.
 *
 * DELETE — soft delete (sets isActive = false).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const updates: any = { updatedAt: new Date().toISOString() };
    if (typeof body?.label === "string") updates.label = body.label.trim();
    if (typeof body?.description === "string" || body?.description === null) updates.description = body.description || null;
    if (typeof body?.sortOrder === "number") updates.sortOrder = body.sortOrder;
    if (typeof body?.isActive === "boolean") updates.isActive = body.isActive;

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await db.update(accountModules).set(updates).where(eq(accountModules.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[account-modules PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    await db.update(accountModules)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(accountModules.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[account-modules DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
