import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaScheduleRules } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** GET — list all rules */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();
    const rows = await db.select().from(arimaScheduleRules).orderBy(desc(arimaScheduleRules.priority));
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[rules GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** POST — create a rule */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const body = await req.json();
    const name = (body?.name || "").trim();
    const cadence = body?.cadence || "monthly";
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    if (!["weekly", "biweekly", "monthly", "quarterly", "custom"].includes(cadence)) {
      return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
    }

    const id = `rule_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(arimaScheduleRules).values({
      id,
      name,
      cadence,
      customIntervalDays: body.customIntervalDays || null,
      matchEngagementStatus: body.matchEngagementStatus || null,
      priority: body.priority ?? 0,
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error: any) {
    console.error("[rules POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
