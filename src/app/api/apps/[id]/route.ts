import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { name, description, icon, href, isActive, sortOrder, provider } = await req.json();
    const now = new Date().toISOString();
    const sets: string[] = [];
    const vals: any[] = [];
    if (name !== undefined)        { sets.push(`name = ?`);        vals.push(name); }
    if (description !== undefined) { sets.push(`description = ?`); vals.push(description); }
    if (icon !== undefined)        { sets.push(`icon = ?`);        vals.push(icon); }
    if (href !== undefined)        { sets.push(`href = ?`);        vals.push(href); }
    if (isActive !== undefined)    { sets.push(`isActive = ?`);    vals.push(isActive ? 1 : 0); }
    if (sortOrder !== undefined)   { sets.push(`sortOrder = ?`);   vals.push(sortOrder); }
    if (provider !== undefined)    { sets.push(`provider = ?`);    vals.push(provider ?? null); }
    sets.push(`updatedAt = ?`); vals.push(now);
    vals.push(params.id);
    await prisma.$executeRawUnsafe(
      `UPDATE App SET ${sets.join(", ")} WHERE id = ?`, ...vals
    );
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT isBuiltIn FROM App WHERE id = ?`, params.id
    );
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (rows[0].isBuiltIn) return NextResponse.json({ error: "Built-in apps cannot be deleted" }, { status: 400 });
    await prisma.$executeRawUnsafe(`DELETE FROM App WHERE id = ?`, params.id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
