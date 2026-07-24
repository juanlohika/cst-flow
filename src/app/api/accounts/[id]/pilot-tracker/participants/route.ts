/**
 * Pilot Tracker — participant CRUD (admin side).
 *
 *   GET   /api/accounts/[id]/pilot-tracker/participants
 *         ?stage=0..6&flag=CLICKED_NOT_REGISTERED|...&search=xxx&limit=100
 *     → list participants for the account's active pilot, with filters.
 *
 *   POST  /api/accounts/[id]/pilot-tracker/participants
 *     → create a single participant manually (usually you use XLSX import).
 *
 *   PATCH /api/accounts/[id]/pilot-tracker/participants
 *     body: { participantId, updates: {...} }
 *     → update ONE participant. Delegates to updateParticipant() which
 *       re-derives stage + flag and writes audit rows.
 *
 * All routes: signed-in users with canAccessClient() on the account.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pilotProjects, pilotParticipants } from "@/db/schema";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { updateParticipant, type ParticipantUpdate } from "@/lib/pilot/participant-mutations";

export const dynamic = "force-dynamic";

async function authorize(id: string): Promise<
  | { actor: { userId: string; isAdmin: boolean }; projectId: string }
  | { error: { status: number; message: string } }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: { status: 401, message: "Unauthorized" } };
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, id))) {
    return { error: { status: 403, message: "Forbidden" } };
  }
  const [project] = await db
    .select({ id: pilotProjects.id })
    .from(pilotProjects)
    .where(and(eq(pilotProjects.clientProfileId, id), eq(pilotProjects.status, "active")))
    .limit(1);
  if (!project) {
    return { error: { status: 404, message: "No active pilot project" } };
  }
  return { actor, projectId: project.id };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }

  try {
    const url = new URL(req.url);
    const stage = url.searchParams.get("stage");
    const flag = url.searchParams.get("flag");
    const search = url.searchParams.get("search")?.trim();
    const limit = Math.min(Number(url.searchParams.get("limit") || 500), 2000);

    const filters: any[] = [eq(pilotParticipants.projectId, a.projectId)];
    if (stage !== null && stage !== "") {
      const n = Number(stage);
      if (Number.isInteger(n) && n >= 0 && n <= 6) {
        filters.push(eq(pilotParticipants.currentStage, n));
      }
    }
    if (flag) {
      filters.push(eq(pilotParticipants.issueFlag, flag));
    }
    if (search) {
      const like_ = `%${search}%`;
      filters.push(
        or(
          like(pilotParticipants.employeeId, like_),
          like(pilotParticipants.fullName, like_),
          like(pilotParticipants.mobileNumber, like_),
          like(pilotParticipants.mobileNumberCorrected, like_),
          like(pilotParticipants.playstoreEmail, like_),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(pilotParticipants)
      .where(and(...filters))
      .orderBy(asc(pilotParticipants.fullName))
      .limit(limit);

    // Stage-funnel + flag-tally for the dashboard header. Cheap query at
    // pilot scale (a few hundred rows) so we always return it.
    const funnelRows = await db
      .select({
        currentStage: pilotParticipants.currentStage,
        issueFlag: pilotParticipants.issueFlag,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(pilotParticipants)
      .where(eq(pilotParticipants.projectId, a.projectId))
      .groupBy(pilotParticipants.currentStage, pilotParticipants.issueFlag);

    const stageCounts = new Array(7).fill(0);
    const flagCounts: Record<string, number> = {};
    let total = 0;
    for (const r of funnelRows) {
      stageCounts[r.currentStage] += Number(r.count);
      flagCounts[r.issueFlag] = (flagCounts[r.issueFlag] || 0) + Number(r.count);
      total += Number(r.count);
    }

    return NextResponse.json({
      participants: rows,
      total,
      stageCounts,
      flagCounts,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load participants" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  try {
    const body = await req.json();
    if (!body.employeeId || !body.fullName || !body.mobileNumber) {
      return NextResponse.json(
        { error: "Required: employeeId, fullName, mobileNumber" },
        { status: 400 },
      );
    }
    // Uniqueness enforced by (projectId, employeeId) index. Attempt insert;
    // on conflict, return a friendly error.
    try {
      await db.insert(pilotParticipants).values({
        projectId: a.projectId,
        employeeId: String(body.employeeId),
        fullName: String(body.fullName),
        mobileNumber: String(body.mobileNumber),
        lastActivityBy: "cst",
      });
    } catch (dbe: any) {
      if (String(dbe?.message || "").includes("UNIQUE")) {
        return NextResponse.json(
          { error: `A participant with employeeId "${body.employeeId}" already exists` },
          { status: 409 },
        );
      }
      throw dbe;
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to create participant" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  try {
    const body = await req.json();
    if (!body.participantId || !body.updates) {
      return NextResponse.json(
        { error: "Required: participantId, updates" },
        { status: 400 },
      );
    }
    // Verify the participant belongs to the requested account's project —
    // otherwise a malicious/misdirected PATCH could edit another account's
    // roster if the caller happens to know an ID.
    const [participant] = await db
      .select({ id: pilotParticipants.id, projectId: pilotParticipants.projectId })
      .from(pilotParticipants)
      .where(eq(pilotParticipants.id, String(body.participantId)))
      .limit(1);
    if (!participant || participant.projectId !== a.projectId) {
      return NextResponse.json({ error: "Participant not found for this account" }, { status: 404 });
    }
    const result = await updateParticipant(participant.id, body.updates as ParticipantUpdate, {
      actor: "cst",
      actorUserId: a.actor.userId,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to update participant" },
      { status: 500 },
    );
  }
}
