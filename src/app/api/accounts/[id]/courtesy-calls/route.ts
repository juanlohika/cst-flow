import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  courtesyCallHistory, clientProfiles, users as usersTable,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET  /api/accounts/[id]/courtesy-calls   → list history (newest first)
 * POST /api/accounts/[id]/courtesy-calls   → log a new call
 *   body: { callDate: 'YYYY-MM-DD', notes?: string }
 *   Also updates clientProfiles.lastCourtesyCall to whichever date is latest.
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
        id: courtesyCallHistory.id,
        callDate: courtesyCallHistory.callDate,
        loggedByUserId: courtesyCallHistory.loggedByUserId,
        loggedByName: usersTable.name,
        notes: courtesyCallHistory.notes,
        createdAt: courtesyCallHistory.createdAt,
      })
      .from(courtesyCallHistory)
      .leftJoin(usersTable, eq(usersTable.id, courtesyCallHistory.loggedByUserId))
      .where(eq(courtesyCallHistory.clientProfileId, params.id))
      .orderBy(desc(courtesyCallHistory.callDate));

    return NextResponse.json({ history: rows });
  } catch (error: any) {
    console.error("[courtesy-calls GET]", error);
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
    const callDate = String(body?.callDate || "").trim();
    if (!callDate || !/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
      return NextResponse.json({ error: "callDate is required in YYYY-MM-DD format" }, { status: 400 });
    }

    const id = `cc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db.insert(courtesyCallHistory).values({
      id,
      clientProfileId: params.id,
      callDate,
      loggedByUserId: session.user.id,
      notes: typeof body?.notes === "string" ? body.notes.trim() || null : null,
      createdAt: now,
    });

    // Update clientProfiles.lastCourtesyCall ONLY if this is newer than what's there
    const profile = await db
      .select({ lastCourtesyCall: clientProfiles.lastCourtesyCall })
      .from(clientProfiles)
      .where(eq(clientProfiles.id, params.id))
      .limit(1);
    const existing = profile[0]?.lastCourtesyCall;
    if (!existing || callDate > existing) {
      await db.update(clientProfiles)
        .set({ lastCourtesyCall: callDate, updatedAt: now })
        .where(eq(clientProfiles.id, params.id));
    }

    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    console.error("[courtesy-calls POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
