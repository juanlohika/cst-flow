import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaGuardrails } from "@/db/schema";
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
    const ALLOWED = ["label", "pattern", "description", "enabled", "priority"];
    const updateData: any = { updatedAt: new Date().toISOString() };
    for (const k of ALLOWED) {
      if (k in body && body[k] !== undefined) updateData[k] = body[k];
    }
    await db.update(arimaGuardrails).set(updateData).where(eq(arimaGuardrails.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[guardrails PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    // Don't allow deletion of built-ins — only disable
    const existing = await db.select({ isBuiltIn: arimaGuardrails.isBuiltIn })
      .from(arimaGuardrails)
      .where(eq(arimaGuardrails.id, params.id))
      .limit(1);
    if (existing[0]?.isBuiltIn) {
      return NextResponse.json({ error: "Built-in guardrails can be disabled but not deleted." }, { status: 400 });
    }

    await db.delete(arimaGuardrails).where(eq(arimaGuardrails.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[guardrails DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
