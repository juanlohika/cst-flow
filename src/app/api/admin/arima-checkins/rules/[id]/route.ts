import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaScheduleRules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const body = await req.json();
    const allowed = ["name", "cadence", "customIntervalDays", "matchEngagementStatus", "priority", "enabled"];
    const updateData: any = { updatedAt: new Date().toISOString() };
    for (const k of allowed) {
      if (k in body && body[k] !== undefined) updateData[k] = body[k];
    }
    await db.update(arimaScheduleRules).set(updateData).where(eq(arimaScheduleRules.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[rules PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();
    await db.delete(arimaScheduleRules).where(eq(arimaScheduleRules.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[rules DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
