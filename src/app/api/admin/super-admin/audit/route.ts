import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { superAdminAccessLog, users as usersTable } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/** GET /api/admin/super-admin/audit — recent SA access log entries (admin only). */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(500, Number(searchParams.get("limit")) || 100));

    const rows = await db
      .select({
        id: superAdminAccessLog.id,
        telegramChatId: superAdminAccessLog.telegramChatId,
        telegramUserId: superAdminAccessLog.telegramUserId,
        cstUserId: superAdminAccessLog.cstUserId,
        userName: usersTable.name,
        userEmail: usersTable.email,
        toolName: superAdminAccessLog.toolName,
        question: superAdminAccessLog.question,
        status: superAdminAccessLog.status,
        reason: superAdminAccessLog.reason,
        responseSummary: superAdminAccessLog.responseSummary,
        responseBytes: superAdminAccessLog.responseBytes,
        createdAt: superAdminAccessLog.createdAt,
      })
      .from(superAdminAccessLog)
      .leftJoin(usersTable, eq(usersTable.id, superAdminAccessLog.cstUserId))
      .orderBy(desc(superAdminAccessLog.createdAt))
      .limit(limit);

    return NextResponse.json({ entries: rows });
  } catch (error: any) {
    console.error("[super-admin/audit GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
