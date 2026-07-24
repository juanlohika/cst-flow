/**
 * Pilot Tracker — bulk operations (admin).
 *
 * POST /api/accounts/[id]/pilot-tracker/bulk
 *   body: { action: "markRegistered", participantIds: string[] }
 *   → flips betaRegistered=true on each participant. State machine
 *     auto-transitions stages and clears CLICKED_NOT_REGISTERED /
 *     AWAITING_REGISTRATION flags on the affected rows.
 *
 * Every row goes through updateParticipant() so audit logs are written
 * and derivation stays consistent.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pilotParticipants, pilotProjects } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { updateParticipant } from "@/lib/pilot/participant-mutations";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [project] = await db
    .select({ id: pilotProjects.id })
    .from(pilotProjects)
    .where(and(eq(pilotProjects.clientProfileId, id), eq(pilotProjects.status, "active")))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "No active pilot project" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const action = body.action;
    const ids = Array.isArray(body.participantIds) ? body.participantIds.map(String) : [];
    if (!action || ids.length === 0) {
      return NextResponse.json({ error: "Required: action, participantIds[]" }, { status: 400 });
    }

    if (action === "markRegistered") {
      // Verify all IDs belong to this project — reject entire batch on mismatch.
      const belonging = await db
        .select({ id: pilotParticipants.id })
        .from(pilotParticipants)
        .where(
          and(
            eq(pilotParticipants.projectId, project.id),
            inArray(pilotParticipants.id, ids),
          ),
        );
      if (belonging.length !== ids.length) {
        return NextResponse.json(
          { error: "Some participants don't belong to this account's pilot" },
          { status: 400 },
        );
      }
      let advanced = 0;
      for (const pid of ids) {
        const res = await updateParticipant(
          pid,
          {
            betaRegistered: true,
            betaRegisteredByUserId: actor.userId,
          },
          {
            actor: "dev",
            actorUserId: actor.userId,
            note: "Bulk 'mark registered' by admin",
          },
        );
        if (res.updated) advanced++;
      }
      return NextResponse.json({ ok: true, advanced });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Bulk op failed" },
      { status: 500 },
    );
  }
}
