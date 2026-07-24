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
import { pilotProjects, pilotParticipants, pilotChangeLog } from "@/db/schema";
import { and, asc, desc, eq, gt, inArray, like, lt, or, sql } from "drizzle-orm";
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
      // Synthetic "blocked-per-stage" filters derived from the change log
      // or activity timestamps rather than the participant.issueFlag
      // column. Handled here as an early-return path so the main list
      // query can restrict to the resolved participant IDs.
      if (flag === "EMAIL_CORRECTED_BY_USER") {
        const rows = await db
          .select({ pid: pilotChangeLog.participantId })
          .from(pilotChangeLog)
          .leftJoin(pilotParticipants, eq(pilotParticipants.id, pilotChangeLog.participantId))
          .where(
            and(
              eq(pilotParticipants.projectId, a.projectId),
              eq(pilotChangeLog.actor, "participant"),
              eq(pilotChangeLog.field, "playstoreEmail"),
            ),
          );
        const idset = Array.from(new Set(rows.map((r) => r.pid)));
        if (idset.length === 0) {
          filters.push(eq(pilotParticipants.id, "__never_match__"));
        } else {
          filters.push(inArray(pilotParticipants.id, idset));
        }
      } else if (flag === "CONTACT_CORRECTED_BY_USER") {
        const rows = await db
          .select({ pid: pilotChangeLog.participantId })
          .from(pilotChangeLog)
          .leftJoin(pilotParticipants, eq(pilotParticipants.id, pilotChangeLog.participantId))
          .where(
            and(
              eq(pilotParticipants.projectId, a.projectId),
              eq(pilotChangeLog.actor, "participant"),
              or(
                eq(pilotChangeLog.field, "mobileNumberCorrected"),
                eq(pilotChangeLog.field, "workEmail"),
              )!,
            ),
          );
        const idset = Array.from(new Set(rows.map((r) => r.pid)));
        if (idset.length === 0) {
          filters.push(eq(pilotParticipants.id, "__never_match__"));
        } else {
          filters.push(inArray(pilotParticipants.id, idset));
        }
      } else if (flag === "STUCK_STAGE3") {
        const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        filters.push(eq(pilotParticipants.currentStage, 3));
        filters.push(lt(pilotParticipants.lastActivityAt, cutoff));
      } else if (flag === "WORK_EMAIL_PENDING") {
        filters.push(eq(pilotParticipants.mobileConfirmed, true));
        filters.push(eq(pilotParticipants.workEmailConfirmed, false));
        filters.push(sql`${pilotParticipants.workEmail} IS NOT NULL AND ${pilotParticipants.workEmail} != ''`);
      } else if (flag === "NOT_YET_ACCEPTED") {
        // Participants who explicitly tapped "Not yet" on Screen C.
        // Resolved from the change log — see the Promise.all query
        // above for the definition of the signal.
        const rows = await db
          .select({ pid: pilotChangeLog.participantId })
          .from(pilotChangeLog)
          .leftJoin(pilotParticipants, eq(pilotParticipants.id, pilotChangeLog.participantId))
          .where(
            and(
              eq(pilotParticipants.projectId, a.projectId),
              eq(pilotChangeLog.actor, "participant"),
              eq(pilotChangeLog.field, "invitationAcceptedDeclared"),
              eq(pilotChangeLog.newValue, "false"),
            ),
          );
        const idset = Array.from(new Set(rows.map((r) => r.pid).filter((x): x is string => !!x)));
        if (idset.length === 0) {
          filters.push(eq(pilotParticipants.id, "__never_match__"));
        } else {
          filters.push(inArray(pilotParticipants.id, idset));
        }
      } else if (flag === "STAGE2_BLOCKED") {
        // Union of the three Step-2 blocker signals: CLICKED_NOT_REGISTERED,
        // INVITE_NOT_RECEIVED, and explicit "Not yet". This is what the
        // Step-2 red pill on the funnel taps to.
        const notYetPidRows = await db
          .select({ pid: pilotChangeLog.participantId })
          .from(pilotChangeLog)
          .leftJoin(pilotParticipants, eq(pilotParticipants.id, pilotChangeLog.participantId))
          .where(
            and(
              eq(pilotParticipants.projectId, a.projectId),
              eq(pilotChangeLog.actor, "participant"),
              eq(pilotChangeLog.field, "invitationAcceptedDeclared"),
              eq(pilotChangeLog.newValue, "false"),
            ),
          );
        const notYetPids = Array.from(new Set(notYetPidRows.map((r) => r.pid).filter((x): x is string => !!x)));
        filters.push(
          or(
            eq(pilotParticipants.issueFlag, "CLICKED_NOT_REGISTERED"),
            eq(pilotParticipants.issueFlag, "INVITE_NOT_RECEIVED"),
            notYetPids.length > 0 ? inArray(pilotParticipants.id, notYetPids) : sql`0 = 1`,
          )!,
        );
      } else {
        filters.push(eq(pilotParticipants.issueFlag, flag));
      }
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
          like(pilotParticipants.workEmail, like_),
        )!,
      );
    }

    // All read queries run in parallel — this endpoint is polled every
    // few seconds by the roster grid, so we want it to come back fast.
    // Turso round-trip is ~50-150ms per query; serial 6 = ~500ms-1s,
    // parallel = ~150-200ms. Every query is independent (project-scoped),
    // so there's no ordering constraint.
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const [rows, funnelRows, s1Rows, s4Rows, s3Rows, s5Rows, notYetRows] = await Promise.all([
      db
        .select()
        .from(pilotParticipants)
        .where(and(...filters))
        .orderBy(asc(pilotParticipants.fullName))
        .limit(limit),

      // Stage-funnel + flag-tally for the dashboard header. Cheap query at
      // pilot scale (a few hundred rows) so we always return it.
      db
        .select({
          currentStage: pilotParticipants.currentStage,
          issueFlag: pilotParticipants.issueFlag,
          count: sql<number>`count(*)`.as("count"),
        })
        .from(pilotParticipants)
        .where(eq(pilotParticipants.projectId, a.projectId))
        .groupBy(pilotParticipants.currentStage, pilotParticipants.issueFlag),

      // Distinct participants with a portal-driven playstoreEmail
      // correction. Project scoped via a join so we can drop the
      // separate idsInProject round-trip.
      db
        .select({
          c: sql<number>`count(distinct ${pilotChangeLog.participantId})`.as("c"),
        })
        .from(pilotChangeLog)
        .leftJoin(pilotParticipants, eq(pilotParticipants.id, pilotChangeLog.participantId))
        .where(
          and(
            eq(pilotParticipants.projectId, a.projectId),
            eq(pilotChangeLog.actor, "participant"),
            eq(pilotChangeLog.field, "playstoreEmail"),
          ),
        ),

      // Distinct participants with a mobileNumberCorrected OR workEmail
      // change by the participant.
      db
        .select({
          c: sql<number>`count(distinct ${pilotChangeLog.participantId})`.as("c"),
        })
        .from(pilotChangeLog)
        .leftJoin(pilotParticipants, eq(pilotParticipants.id, pilotChangeLog.participantId))
        .where(
          and(
            eq(pilotParticipants.projectId, a.projectId),
            eq(pilotChangeLog.actor, "participant"),
            or(
              eq(pilotChangeLog.field, "mobileNumberCorrected"),
              eq(pilotChangeLog.field, "workEmail"),
            )!,
          ),
        ),

      // Stuck at stage 3 for 3+ days.
      db
        .select({ c: sql<number>`count(*)`.as("c") })
        .from(pilotParticipants)
        .where(
          and(
            eq(pilotParticipants.projectId, a.projectId),
            eq(pilotParticipants.currentStage, 3),
            lt(pilotParticipants.lastActivityAt, cutoff),
          ),
        ),

      // Work-email confirmation pending. Meaningful only when workEmail
      // is set — mobile-only users can't be in this bucket.
      db
        .select({ c: sql<number>`count(*)`.as("c") })
        .from(pilotParticipants)
        .where(
          and(
            eq(pilotParticipants.projectId, a.projectId),
            eq(pilotParticipants.mobileConfirmed, true),
            eq(pilotParticipants.workEmailConfirmed, false),
            sql`${pilotParticipants.workEmail} IS NOT NULL AND ${pilotParticipants.workEmail} != ''`,
          ),
        ),

      // Participants who explicitly tapped "Not yet" on Screen C. The
      // default participant state is also invitationAcceptedDeclared=false,
      // so the ONLY signal that distinguishes "user tapped Not yet" from
      // "user hasn't answered" is a change-log row written by the
      // participant with newValue='false' on invitationAcceptedDeclared.
      // We return participant IDs (not just a count) so the client can
      // render a "Not yet accepted" chip in the Flag column alongside
      // the real issueFlag chip.
      db
        .select({ pid: pilotChangeLog.participantId })
        .from(pilotChangeLog)
        .leftJoin(pilotParticipants, eq(pilotParticipants.id, pilotChangeLog.participantId))
        .where(
          and(
            eq(pilotParticipants.projectId, a.projectId),
            eq(pilotChangeLog.actor, "participant"),
            eq(pilotChangeLog.field, "invitationAcceptedDeclared"),
            eq(pilotChangeLog.newValue, "false"),
          ),
        ),
    ]);

    const stageCounts = new Array(7).fill(0);
    const flagCounts: Record<string, number> = {};
    let total = 0;
    for (const r of funnelRows) {
      stageCounts[r.currentStage] += Number(r.count);
      flagCounts[r.issueFlag] = (flagCounts[r.issueFlag] || 0) + Number(r.count);
      total += Number(r.count);
    }

    // De-duplicate the "Not yet" participant list (a participant who
    // tapped "Not yet" more than once will have multiple change-log rows).
    const notYetIds = Array.from(new Set(notYetRows.map((r) => r.pid).filter((x): x is string => !!x)));

    // ─── Blocked-per-stage counts ─────────────────────────────────────
    // Small computed layer that surfaces "someone needs to act" signals
    // per stage. See stage-to-signal mapping in the roster grid.
    // Step 2 sums three signals: CLICKED_NOT_REGISTERED, INVITE_NOT_RECEIVED,
    // and participants who explicitly tapped "Not yet". These aren't
    // strictly mutually exclusive (someone could hit "Not yet" and later
    // report "Link didn't work") but at pilot scale the overlap is
    // negligible — we accept the mild over-count in exchange for a
    // simpler query.
    const blockedByStage = {
      s1: Number(s1Rows[0]?.c || 0),
      s2:
        (flagCounts["CLICKED_NOT_REGISTERED"] || 0) +
        (flagCounts["INVITE_NOT_RECEIVED"] || 0) +
        notYetIds.length,
      s3: Number(s3Rows[0]?.c || 0),
      s4: Number(s4Rows[0]?.c || 0),
      s5: Number(s5Rows[0]?.c || 0),
      s6: flagCounts["VERSION_MISMATCH"] || 0,
    };

    return NextResponse.json({
      participants: rows,
      total,
      stageCounts,
      flagCounts,
      blockedByStage,
      // Participant IDs the client should decorate with an extra
      // "Not yet accepted" chip in the Flag column. Also drives the
      // NOT_YET_ACCEPTED synthetic filter for tap-through.
      notYetIds,
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

/**
 * DELETE /api/accounts/[id]/pilot-tracker/participants?participantId=xxx
 *   → hard-deletes one participant. PilotChangeLog rows cascade via FK.
 *     Version screenshots in Drive are intentionally left in place — if
 *     they need purging, do that from the Drive folder. Keeps this
 *     op instant and lets us recover if the wrong row was deleted.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(id);
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  try {
    const url = new URL(req.url);
    const participantId = url.searchParams.get("participantId");
    if (!participantId) {
      return NextResponse.json({ error: "Required: participantId" }, { status: 400 });
    }
    const [participant] = await db
      .select({ id: pilotParticipants.id, projectId: pilotParticipants.projectId })
      .from(pilotParticipants)
      .where(eq(pilotParticipants.id, String(participantId)))
      .limit(1);
    if (!participant || participant.projectId !== a.projectId) {
      return NextResponse.json({ error: "Participant not found for this account" }, { status: 404 });
    }
    await db
      .delete(pilotParticipants)
      .where(eq(pilotParticipants.id, String(participantId)));
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to delete participant" },
      { status: 500 },
    );
  }
}
