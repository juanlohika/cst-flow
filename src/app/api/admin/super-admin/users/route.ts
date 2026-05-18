import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { superAdminUsers, users as usersTable, telegramAccountLinks } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 };
  if ((session.user as any).role !== "admin") return { error: "Admin only", status: 403 };
  return null;
}

/**
 * GET    /api/admin/super-admin/users — list allowlisted users (enriched with name/email)
 * POST   /api/admin/super-admin/users — add a user by email or userId; body: { email?|cstUserId?, allowDmAccess?, notes? }
 * PATCH  /api/admin/super-admin/users — update flags; body: { cstUserId, allowDmAccess? }
 * DELETE /api/admin/super-admin/users — remove a user; query: ?cstUserId=...
 */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const rows = await db
      .select({
        id: superAdminUsers.id,
        cstUserId: superAdminUsers.cstUserId,
        telegramUserId: superAdminUsers.telegramUserId,
        allowDmAccess: superAdminUsers.allowDmAccess,
        addedAt: superAdminUsers.addedAt,
        notes: superAdminUsers.notes,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(superAdminUsers)
      .leftJoin(usersTable, eq(usersTable.id, superAdminUsers.cstUserId))
      .orderBy(desc(superAdminUsers.addedAt));

    return NextResponse.json({ users: rows });
  } catch (error: any) {
    console.error("[super-admin/users GET]", error);
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
    let cstUserId: string | null = body?.cstUserId ? String(body.cstUserId) : null;

    if (!cstUserId && body?.email) {
      const email = String(body.email).trim().toLowerCase();
      const rows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
      cstUserId = rows[0]?.id || null;
      if (!cstUserId) {
        return NextResponse.json({ error: `No CST OS user with email "${email}"` }, { status: 404 });
      }
    }
    if (!cstUserId) {
      return NextResponse.json({ error: "Provide either cstUserId or email" }, { status: 400 });
    }

    // Look up linked Telegram id (cached for fast SA gate)
    const linkRows = await db
      .select({ telegramUserId: telegramAccountLinks.telegramUserId })
      .from(telegramAccountLinks)
      .where(and(eq(telegramAccountLinks.cstUserId, cstUserId), eq(telegramAccountLinks.status, "active")))
      .limit(1);
    const telegramUserId = linkRows[0]?.telegramUserId || null;

    const existing = await db
      .select({ id: superAdminUsers.id })
      .from(superAdminUsers)
      .where(eq(superAdminUsers.cstUserId, cstUserId))
      .limit(1);

    if (existing[0]) {
      // Already added — return idempotently
      return NextResponse.json({ ok: true, id: existing[0].id, alreadyAdded: true });
    }

    const id = `sau_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(superAdminUsers).values({
      id,
      cstUserId,
      telegramUserId,
      allowDmAccess: !!body?.allowDmAccess,
      addedBy: session!.user!.id!,
      addedAt: new Date().toISOString(),
      notes: typeof body?.notes === "string" ? body.notes.trim() || null : null,
    });

    return NextResponse.json({ ok: true, id, cstUserId, telegramUserId, telegramLinked: !!telegramUserId });
  } catch (error: any) {
    console.error("[super-admin/users POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const body = await req.json();
    const cstUserId = String(body?.cstUserId || "").trim();
    if (!cstUserId) return NextResponse.json({ error: "cstUserId required" }, { status: 400 });

    const updates: any = {};
    if (typeof body?.allowDmAccess === "boolean") updates.allowDmAccess = body.allowDmAccess;
    if (typeof body?.notes === "string" || body?.notes === null) updates.notes = body.notes || null;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await db.update(superAdminUsers).set(updates).where(eq(superAdminUsers.cstUserId, cstUserId));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[super-admin/users PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if (gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    await ensureAccessSchema();

    const { searchParams } = new URL(req.url);
    const cstUserId = searchParams.get("cstUserId");
    if (!cstUserId) return NextResponse.json({ error: "cstUserId query param required" }, { status: 400 });

    await db.delete(superAdminUsers).where(eq(superAdminUsers.cstUserId, cstUserId));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[super-admin/users DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
