/**
 * Pilot Tracker — roster Google Sheet control plane.
 *
 * GET  → current sheet state (id, url, collecting|locked, last synced).
 *
 * POST { action }
 *   provision — create the Sheet in the project's Drive folder (idempotent)
 *   refresh   — push current roster into the Sheet
 *   preview   — dry-run diff of what adopting the Sheet would change
 *   lock      — adopt the Sheet, protect admin columns, emit ONE digest
 *   reopen    — unprotect admin columns for another collection round
 *
 * The lock/reopen pair is the collection window. See roster-sheet.ts for
 * why adoption is batched rather than streamed.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles, pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import {
  applyProtection,
  provisionRosterSheet,
  pushToSheet,
} from "@/lib/pilot/roster-sheet";
import { applyAdopt, previewAdopt } from "@/lib/pilot/roster-adopt";

export const dynamic = "force-dynamic";

async function resolve(id: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, id))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(and(eq(pilotProjects.clientProfileId, id), eq(pilotProjects.status, "active")))
    .limit(1);
  if (!project) {
    return { error: NextResponse.json({ error: "No active pilot project" }, { status: 404 }) };
  }
  return { actor, project };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolve(id);
  if ("error" in r) return r.error;
  const p = r.project;
  return NextResponse.json({
    sheetId: p.rosterSheetId,
    sheetUrl: p.rosterSheetUrl,
    state: p.rosterSheetState || "collecting",
    lockedAt: p.rosterSheetLockedAt,
    syncedAt: p.rosterSheetSyncedAt,
    custom1Label: p.custom1Label,
    custom2Label: p.custom2Label,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolve(id);
  if ("error" in r) return r.error;
  const { actor, project } = r;

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const action = body.action;

  try {
    if (action === "provision") {
      const res = await provisionRosterSheet(project.id);
      return NextResponse.json({ ok: true, ...res });
    }

    if (action === "refresh") {
      const res = await pushToSheet(project.id);
      return NextResponse.json({ ok: true, rows: res.rows });
    }

    if (action === "preview") {
      const preview = await previewAdopt(project.id);
      return NextResponse.json({ ok: true, ...preview });
    }

    if (action === "lock") {
      // allowCreate comes from a SEPARATE confirmation in the preview
      // modal, so new participants can never appear as a side effect of
      // approving a batch of updates.
      const allowCreate = body.allowCreate === true;
      const result = await applyAdopt({
        projectId: project.id,
        actorUserId: actor.userId,
        allowCreate,
      });

      const now = new Date().toISOString();
      await db
        .update(pilotProjects)
        .set({
          rosterSheetState: "locked",
          rosterSheetLockedAt: now,
          rosterSheetLockedBy: actor.userId,
        })
        .where(eq(pilotProjects.id, project.id));

      // Protect the admin columns, then push so the sheet reflects the
      // new stages and shows the LOCKED banner. Sheet-side failures are
      // logged but never fail the request — the adopt is already
      // committed, and reporting failure would invite a destructive retry.
      try {
        await applyProtection(project.id, true);
        await pushToSheet(project.id);
      } catch (e: any) {
        console.warn("[roster-sheet] lock: sheet update failed:", e?.message || e);
      }

      // ONE digest for the whole batch.
      if (result.pendingRegistration.length > 0) {
        const [client] = await db
          .select({ companyName: clientProfiles.companyName })
          .from(clientProfiles)
          .where(eq(clientProfiles.id, id))
          .limit(1);
        // Reuses the digest built for the XLSX import path — same problem,
        // same shape. It collapses to a single-participant message when the
        // batch has exactly one entry.
        const { broadcastPilotRegistrationDigest } = await import("@/lib/pilot/notifications");
        broadcastPilotRegistrationDigest({
          entries: result.pendingRegistration,
          clientCompanyName: client?.companyName || null,
          source: "roster-import",
        }).catch((e) => console.warn("[roster-sheet] digest failed:", e));
      }

      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "reopen") {
      await db
        .update(pilotProjects)
        .set({ rosterSheetState: "collecting" })
        .where(eq(pilotProjects.id, project.id));
      await applyProtection(project.id, false);
      // Refresh so admins start from current data, not the state as of
      // the last lock.
      try {
        await pushToSheet(project.id);
      } catch (e: any) {
        console.warn("[roster-sheet] reopen: push failed:", e?.message || e);
      }
      return NextResponse.json({ ok: true, state: "collecting" });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Roster sheet operation failed" },
      { status: 500 },
    );
  }
}
