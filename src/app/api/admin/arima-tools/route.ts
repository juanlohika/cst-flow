import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaTools, arimaToolInvocations } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/**
 * GET /api/admin/arima-tools — list every registered tool with its enabled/autonomy
 * state and a count of recent invocations.
 */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }
    await ensureAccessSchema();

    // Trigger registry load so any newly-added built-in tool shows up
    await import("@/lib/arima/tools");

    const rows = await db.select().from(arimaTools).orderBy(asc(arimaTools.category), asc(arimaTools.name));

    return NextResponse.json(rows.map(r => ({
      ...r,
      inputSchema: (() => { try { return JSON.parse(r.inputSchema); } catch { return {}; } })(),
    })));
  } catch (error: any) {
    console.error("[admin/arima-tools GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
