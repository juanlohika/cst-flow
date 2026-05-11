import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaGuardrails } from "@/db/schema";
import { desc, asc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** GET — list every guardrail */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();
    const rows = await db.select().from(arimaGuardrails).orderBy(asc(arimaGuardrails.type), desc(arimaGuardrails.priority));
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[guardrails GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** POST — create a custom guardrail */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const body = await req.json();
    const VALID_TYPES = ["forbidden_topic", "forbidden_phrase", "escalation_trigger", "off_hours_message", "rate_limit", "required_disclosure"];
    if (!body?.type || !VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: "Invalid or missing type" }, { status: 400 });
    }
    if (!body?.label?.trim()) return NextResponse.json({ error: "Label required" }, { status: 400 });
    if (!body?.pattern?.trim()) return NextResponse.json({ error: "Pattern required" }, { status: 400 });

    const id = `grd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(arimaGuardrails).values({
      id,
      type: body.type,
      label: body.label.trim(),
      pattern: body.pattern.trim(),
      description: body.description || null,
      enabled: body.enabled ?? true,
      isBuiltIn: false,
      priority: body.priority ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error: any) {
    console.error("[guardrails POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
