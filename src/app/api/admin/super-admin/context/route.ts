import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { superAdminContext } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 };
  if ((session.user as any).role !== "admin") return { error: "Admin only", status: 403 };
  return null;
}

/**
 * GET    /api/admin/super-admin/context — read the current active context (if any)
 * POST   /api/admin/super-admin/context — start a new context (generates a bind token)
 *                                          body: { durationHours, notes? }
 * DELETE /api/admin/super-admin/context — revoke the active context
 */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const rows = await db
      .select()
      .from(superAdminContext)
      .orderBy(desc(superAdminContext.createdAt))
      .limit(10);

    // Active = status='active' AND not expired
    const active = rows.find(r => r.status === "active" && new Date(r.expiresAt).getTime() > Date.now()) || null;

    return NextResponse.json({ active, history: rows });
  } catch (error: any) {
    console.error("[super-admin/context GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const body = await req.json();
    const durationHours = Math.max(1, Math.min(2160, Number(body?.durationHours) || 24)); // 1h to 90 days
    const notes = typeof body?.notes === "string" ? body.notes.trim() : null;

    // Revoke any existing active context first — only one at a time
    await db
      .update(superAdminContext)
      .set({ status: "revoked", revokedBy: session!.user!.id, revokedAt: new Date().toISOString() })
      .where(eq(superAdminContext.status, "active"));

    const id = `sactx_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const bindToken = `SA-${randomToken(8)}-${randomToken(8)}`;
    const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();

    await db.insert(superAdminContext).values({
      id,
      telegramChatId: bindToken,  // placeholder until /sabind is run in the GC; we don't know the chatId yet
      status: "active",
      expiresAt,
      createdBy: session!.user!.id!,
      bindToken,
      notes,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, id, bindToken, expiresAt });
  } catch (error: any) {
    console.error("[super-admin/context POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const now = new Date().toISOString();
    await db
      .update(superAdminContext)
      .set({ status: "revoked", revokedBy: session!.user!.id, revokedAt: now })
      .where(eq(superAdminContext.status, "active"));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[super-admin/context DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function randomToken(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
