import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaToolInvocations, clientProfiles as clientProfilesTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/arima-tools/invocations — recent invocations log (most recent 100).
 * Optional ?toolName=... or ?status=pending filters.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const { searchParams } = new URL(req.url);
    const toolName = searchParams.get("toolName");
    const status = searchParams.get("status");

    const conditions: any[] = [];
    if (toolName) conditions.push(eq(arimaToolInvocations.toolName, toolName));
    if (status) conditions.push(eq(arimaToolInvocations.status, status));

    const baseQuery = db
      .select({
        id: arimaToolInvocations.id,
        toolName: arimaToolInvocations.toolName,
        conversationId: arimaToolInvocations.conversationId,
        userId: arimaToolInvocations.userId,
        clientProfileId: arimaToolInvocations.clientProfileId,
        input: arimaToolInvocations.input,
        output: arimaToolInvocations.output,
        status: arimaToolInvocations.status,
        approvalNeeded: arimaToolInvocations.approvalNeeded,
        errorMessage: arimaToolInvocations.errorMessage,
        durationMs: arimaToolInvocations.durationMs,
        createdAt: arimaToolInvocations.createdAt,
        executedAt: arimaToolInvocations.executedAt,
        clientName: clientProfilesTable.companyName,
        clientCode: clientProfilesTable.clientCode,
      })
      .from(arimaToolInvocations)
      .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaToolInvocations.clientProfileId))
      .orderBy(desc(arimaToolInvocations.createdAt))
      .limit(100);

    const rows = conditions.length > 0
      ? await baseQuery.where(conditions.length === 1 ? conditions[0] : (await import("drizzle-orm")).and(...conditions))
      : await baseQuery;

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[admin/arima-tools/invocations] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
