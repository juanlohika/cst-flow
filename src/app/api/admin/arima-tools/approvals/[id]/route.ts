import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaToolInvocations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { getRegisteredTool, type ToolContext } from "@/lib/arima/tools/registry";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/arima-tools/approvals/[id]
 * Body: { action: 'approve' | 'deny' }
 *
 * Approving runs the tool handler with the original input + context, then
 * marks the invocation 'executed'. Denying just marks it 'denied'.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const action = body?.action;
    if (!["approve", "deny"].includes(action)) {
      return NextResponse.json({ error: "action must be 'approve' or 'deny'" }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(arimaToolInvocations)
      .where(eq(arimaToolInvocations.id, params.id))
      .limit(1);

    const inv = rows[0];
    if (!inv) return NextResponse.json({ error: "Invocation not found" }, { status: 404 });
    if (inv.status !== "pending") {
      return NextResponse.json({ error: `Already ${inv.status}` }, { status: 400 });
    }

    if (action === "deny") {
      await db
        .update(arimaToolInvocations)
        .set({
          status: "denied",
          approvedByUserId: session.user.id,
          approvedAt: new Date().toISOString(),
        })
        .where(eq(arimaToolInvocations.id, params.id));
      return NextResponse.json({ ok: true, status: "denied" });
    }

    // Approve → execute the tool now
    // Load registry first
    await import("@/lib/arima/tools");
    const def = getRegisteredTool(inv.toolName);
    if (!def) {
      await db.update(arimaToolInvocations)
        .set({ status: "failed", errorMessage: "Tool not registered in code", approvedByUserId: session.user.id, approvedAt: new Date().toISOString() })
        .where(eq(arimaToolInvocations.id, params.id));
      return NextResponse.json({ error: "Tool no longer registered" }, { status: 400 });
    }

    const ctx: ToolContext = {
      conversationId: inv.conversationId || "",
      userId: inv.userId || "",
      clientProfileId: inv.clientProfileId || null,
      channel: "approved",
    };
    const input = inv.input ? JSON.parse(inv.input) : {};

    const startTime = Date.now();
    try {
      const result = await def.handler(input, ctx);
      const duration = Date.now() - startTime;
      await db.update(arimaToolInvocations)
        .set({
          status: result.ok ? "executed" : "failed",
          output: result.data ? JSON.stringify(result.data) : null,
          errorMessage: result.error || null,
          durationMs: duration,
          approvedByUserId: session.user.id,
          approvedAt: new Date().toISOString(),
          executedAt: new Date().toISOString(),
        })
        .where(eq(arimaToolInvocations.id, params.id));
      return NextResponse.json({ ok: true, status: result.ok ? "executed" : "failed", result });
    } catch (e: any) {
      await db.update(arimaToolInvocations)
        .set({
          status: "failed",
          errorMessage: e?.message || "Approval execution error",
          durationMs: Date.now() - startTime,
          approvedByUserId: session.user.id,
          approvedAt: new Date().toISOString(),
        })
        .where(eq(arimaToolInvocations.id, params.id));
      return NextResponse.json({ error: e?.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error("[admin/arima-tools/approvals POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
