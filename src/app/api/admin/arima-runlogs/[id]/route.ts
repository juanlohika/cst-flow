import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaRunLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** Full single-row payload including the system prompt + raw model output. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const rows = await db.select().from(arimaRunLogs).where(eq(arimaRunLogs.id, params.id)).limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const r = rows[0];
    return NextResponse.json({
      ...r,
      functionCalls: r.functionCalls ? safeJsonParse(r.functionCalls) : [],
      toolResults: r.toolResults ? safeJsonParse(r.toolResults) : [],
    });
  } catch (error: any) {
    console.error("[admin/arima-runlogs/id GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
