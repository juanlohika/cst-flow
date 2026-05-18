import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  f2fVisitHistory, clientProfiles, users as usersTable,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET  /api/accounts/[id]/f2f-visits   → list history (newest first)
 * POST /api/accounts/[id]/f2f-visits   → log a new in-person visit
 *   body: { visitDate: 'YYYY-MM-DD', location?: string, notes?: string }
 *   Also updates clientProfiles.lastF2FVisit to whichever date is latest.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db
      .select({
        id: f2fVisitHistory.id,
        visitDate: f2fVisitHistory.visitDate,
        loggedByUserId: f2fVisitHistory.loggedByUserId,
        loggedByName: usersTable.name,
        location: f2fVisitHistory.location,
        notes: f2fVisitHistory.notes,
        createdAt: f2fVisitHistory.createdAt,
      })
      .from(f2fVisitHistory)
      .leftJoin(usersTable, eq(usersTable.id, f2fVisitHistory.loggedByUserId))
      .where(eq(f2fVisitHistory.clientProfileId, params.id))
      .orderBy(desc(f2fVisitHistory.visitDate));

    return NextResponse.json({ history: rows });
  } catch (error: any) {
    console.error("[f2f-visits GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const isAdmin = (session.user as any).role === "admin";
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const visitDate = String(body?.visitDate || "").trim();
    if (!visitDate || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
      return NextResponse.json({ error: "visitDate is required in YYYY-MM-DD format" }, { status: 400 });
    }

    const id = `f2f_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db.insert(f2fVisitHistory).values({
      id,
      clientProfileId: params.id,
      visitDate,
      loggedByUserId: session.user.id,
      location: typeof body?.location === "string" ? body.location.trim() || null : null,
      notes: typeof body?.notes === "string" ? body.notes.trim() || null : null,
      createdAt: now,
    });

    // Bump the cached lastF2FVisit only if this is newer
    const profile = await db
      .select({ lastF2FVisit: clientProfiles.lastF2FVisit })
      .from(clientProfiles)
      .where(eq(clientProfiles.id, params.id))
      .limit(1);
    const existing = profile[0]?.lastF2FVisit;
    if (!existing || visitDate > existing) {
      await db.update(clientProfiles)
        .set({ lastF2FVisit: visitDate, updatedAt: now })
        .where(eq(clientProfiles.id, params.id));
    }

    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    console.error("[f2f-visits POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
