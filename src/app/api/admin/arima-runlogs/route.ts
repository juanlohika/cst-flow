import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaRunLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/**
 * GET /api/admin/arima-runlogs?limit=50
 * Lists the most recent runArima invocations with raw model I/O for debugging.
 *
 * Admin-only — the system prompt and raw outputs may contain sensitive client
 * context.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200);
    const conversationId = searchParams.get("conversationId");

    const baseQuery = db
      .select({
        id: arimaRunLogs.id,
        conversationId: arimaRunLogs.conversationId,
        agentMode: arimaRunLogs.agentMode,
        senderName: arimaRunLogs.senderName,
        senderChannel: arimaRunLogs.senderChannel,
        clientProfileId: arimaRunLogs.clientProfileId,
        userMessage: arimaRunLogs.userMessage,
        modelCalled: arimaRunLogs.modelCalled,
        skipReason: arimaRunLogs.skipReason,
        finalReply: arimaRunLogs.finalReply,
        functionCalls: arimaRunLogs.functionCalls,
        brdEmitted: arimaRunLogs.brdEmitted,
        requestEmitted: arimaRunLogs.requestEmitted,
        capturedRequestId: arimaRunLogs.capturedRequestId,
        provider: arimaRunLogs.provider,
        durationMs: arimaRunLogs.durationMs,
        toolIterations: arimaRunLogs.toolIterations,
        createdAt: arimaRunLogs.createdAt,
      })
      .from(arimaRunLogs);

    const rows = conversationId
      ? await baseQuery.where(eq(arimaRunLogs.conversationId, conversationId)).orderBy(desc(arimaRunLogs.createdAt)).limit(limit)
      : await baseQuery.orderBy(desc(arimaRunLogs.createdAt)).limit(limit);

    return NextResponse.json(rows.map(r => ({
      ...r,
      functionCalls: r.functionCalls ? safeJsonParse(r.functionCalls) : [],
    })));
  } catch (error: any) {
    console.error("[admin/arima-runlogs GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
