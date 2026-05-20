import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountMemberships, users as usersTable } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { listTeamRoomKeys, createTeamRoomBindKey } from "@/lib/telegram/bind-keys";
import { getTelegramConfig } from "@/lib/telegram/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/telegram-bindings/team-rooms
 *
 * Returns:
 *   - eligibleRms: every CST OS user with at least one isPrimary membership
 *   - rooms: every existing team-room key (with active binding + RM details)
 *   - botUsername: for deep-link URLs
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    // RMs eligible to host a team room — anyone who's primary on at least one account.
    const primaryRows = await db
      .select({ userId: accountMemberships.userId })
      .from(accountMemberships)
      .where(eq(accountMemberships.isPrimary, true));
    const userIds = Array.from(new Set(primaryRows.map(r => r.userId)));
    let rms: Array<{ id: string; name: string | null; email: string | null; accountCount: number }> = [];
    if (userIds.length > 0) {
      const userRows = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.status, "active"));
      // Filter to the ones in the primary set + count.
      const counts = new Map<string, number>();
      for (const r of primaryRows) counts.set(r.userId, (counts.get(r.userId) || 0) + 1);
      rms = userRows
        .filter(u => counts.has(u.id))
        .map(u => ({ id: u.id, name: u.name, email: u.email, accountCount: counts.get(u.id) || 0 }))
        .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
    }

    const rooms = await listTeamRoomKeys();
    const cfg = await getTelegramConfig();
    return NextResponse.json({
      botUsername: cfg.botUsername || null,
      eligibleRms: rms,
      rooms,
    });
  } catch (error: any) {
    console.error("[telegram-bindings/team-rooms GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

/**
 * POST /api/admin/telegram-bindings/team-rooms
 * Body: { rmUserId, label? }
 *
 * Creates a team-room bind key for an RM. ARIMA in the resulting GC will be
 * scoped to the RM's primary-membership accounts at runtime (live scope).
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const rmUserId = (body?.rmUserId || "").trim();
    const label = body?.label ? String(body.label).trim() : undefined;
    if (!rmUserId) return NextResponse.json({ error: "rmUserId required" }, { status: 400 });

    const key = await createTeamRoomBindKey({
      rmUserId,
      label,
      createdBy: session.user.id,
    });
    return NextResponse.json({ key }, { status: 201 });
  } catch (error: any) {
    console.error("[telegram-bindings/team-rooms POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
