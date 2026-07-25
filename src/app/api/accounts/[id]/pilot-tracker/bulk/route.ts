/**
 * Pilot Tracker — bulk operations (admin).
 *
 * POST /api/accounts/[id]/pilot-tracker/bulk
 *   body: { action: "markRegistered", participantIds: string[] }
 *   → flips betaRegistered=true on each participant. State machine
 *     auto-transitions stages and clears CLICKED_NOT_REGISTERED /
 *     AWAITING_REGISTRATION flags on the affected rows.
 *
 *   body: { action: "advanceStage", stage: 1..7, participantIds: string[] }
 *   → the bulk equivalent of the drawer's "CST override" tray. Applies the
 *     same boolean flips the single-participant buttons apply, for the
 *     common case where CST has confirmed a whole batch over Viber/a group
 *     call and doesn't want to open 20 drawers.
 *
 * Both mutating actions are CUMULATIVE, not "set stage = N". Advancing a
 * batch to Stage 4 also satisfies Stages 1–3, because the state machine
 * derives currentStage by descending from the highest qualifying stage —
 * setting only appUpdatedDeclared on someone with no captured email would
 * leave them stuck at Stage 0 with a contradictory boolean. Participants
 * already PAST the requested stage are left untouched (never demoted):
 * updateParticipant() only writes fields whose value actually differs, and
 * every field we set here is monotonic (false → true).
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

/**
 * Cumulative boolean set required to sit AT a given stage. Mirrors the
 * per-participant buttons in PilotRosterGrid's CstStageOverride tray —
 * keep the two in sync.
 *
 * `workEmailConfirmed` is deliberately absent: it's only meaningful when
 * the participant actually has a workEmail on file, so it's applied
 * per-row below rather than from this table.
 */
function updatesForStage(stage: number): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  // Stage 1 — email captured. We can only confirm an email that exists;
  // rows with no playstoreEmail are filtered out by the caller.
  if (stage >= 1) u.emailConfirmedIsPlaystore = true;
  // Stage 2 — on the Play tester list.
  if (stage >= 2) u.betaRegistered = true;
  // Stage 3 — accepted the invite. Clearing invitationLinkFailed matters:
  // otherwise INVITE_NOT_RECEIVED keeps flagging a participant CST just
  // confirmed is through.
  if (stage >= 3) {
    u.invitationAcceptedDeclared = true;
    u.invitationLinkFailed = false;
  }
  // Stage 4 — app updated from the store.
  if (stage >= 4) u.appUpdatedDeclared = true;
  // Stage 5 — contact details confirmed.
  if (stage >= 5) u.mobileConfirmed = true;
  // Stage 6 — on the target build. versionConfirmedByUser=true makes
  // updateParticipant() flip versionVerified to "verified" and stamp
  // reportedVersion from the project's targetAppVersion.
  if (stage >= 6) u.versionConfirmedByUser = true;
  // Stage 7 — no outstanding portal-driven corrections owed downstream.
  if (stage >= 7) {
    u.contactCorrectionResolved = true;
    u.emailCorrectionResolved = true;
  }
  return u;
}

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

    if (action === "delete") {
      // Belongs-to check before deleting anything — reject entire batch on
      // any foreign ID, same policy as markRegistered.
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
      // PilotChangeLog rows cascade via FK (ON DELETE CASCADE on
      // participantId). Version screenshots in Drive are intentionally
      // left in place — if CST needs to fully purge them, they can do so
      // from the Drive folder directly. That trade-off keeps this
      // operation instant and reversible in the "oops I deleted the
      // wrong row" case (Drive still has the artifact).
      const result = await db
        .delete(pilotParticipants)
        .where(
          and(
            eq(pilotParticipants.projectId, project.id),
            inArray(pilotParticipants.id, ids),
          ),
        );
      const deleted =
        (result as any)?.rowsAffected ??
        (result as any)?.changes ??
        ids.length;
      return NextResponse.json({ ok: true, deleted });
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

    if (action === "advanceStage") {
      const stage = Number(body.stage);
      if (!Number.isInteger(stage) || stage < 1 || stage > 7) {
        return NextResponse.json(
          { error: "stage must be an integer 1–7" },
          { status: 400 },
        );
      }
      // Load the full rows (not just IDs) — we need playstoreEmail and
      // workEmail per participant to decide which fields are applicable,
      // and currentStage to report how many were already there.
      const rows = await db
        .select({
          id: pilotParticipants.id,
          employeeId: pilotParticipants.employeeId,
          fullName: pilotParticipants.fullName,
          playstoreEmail: pilotParticipants.playstoreEmail,
          workEmail: pilotParticipants.workEmail,
          currentStage: pilotParticipants.currentStage,
        })
        .from(pilotParticipants)
        .where(
          and(
            eq(pilotParticipants.projectId, project.id),
            inArray(pilotParticipants.id, ids),
          ),
        );
      if (rows.length !== ids.length) {
        return NextResponse.json(
          { error: "Some participants don't belong to this account's pilot" },
          { status: 400 },
        );
      }

      const base = updatesForStage(stage);
      let advanced = 0;
      let unchanged = 0;
      // Participants we couldn't take to Stage 1+ because there's no
      // Play Store email on record to "confirm". Reported back so the UI
      // can tell CST exactly who needs an email entered first, rather
      // than silently doing nothing for those rows.
      const skippedNoEmail: Array<{ employeeId: string; fullName: string }> = [];

      for (const row of rows) {
        // Stage 1 asserts "the email on file is their Play Store email."
        // With no email on file that's not assertable — and flipping the
        // boolean alone would leave the row at Stage 0 anyway, since
        // computeStage() requires BOTH playstoreEmail and the confirm.
        if (stage >= 1 && !row.playstoreEmail) {
          skippedNoEmail.push({
            employeeId: row.employeeId,
            fullName: row.fullName,
          });
          continue;
        }
        const updates: Record<string, unknown> = { ...base };
        // Only assert work-email confirmation for participants who have
        // one; for mobile-only field users the field is meaningless and
        // setting it would misrepresent what CST actually confirmed.
        if (stage >= 5 && row.workEmail) updates.workEmailConfirmed = true;
        // Attribute the Play-list registration to the acting admin, same
        // as the markRegistered path does.
        if (stage >= 2) updates.betaRegisteredByUserId = actor.userId;

        const res = await updateParticipant(row.id, updates, {
          actor: "cst",
          actorUserId: actor.userId,
          note: `Bulk CST override → stage ${stage}`,
          // One digest line per row would spam the internal Telegram
          // channels; the batch is a single deliberate CST action.
          suppressInternalBroadcast: true,
        });
        if (res.updated) advanced++;
        else unchanged++;
      }

      return NextResponse.json({
        ok: true,
        stage,
        advanced,
        unchanged,
        skippedNoEmail,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Bulk op failed" },
      { status: 500 },
    );
  }
}
