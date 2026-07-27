/**
 * Pilot Tracker — per-account project routes.
 *
 *   GET   /api/accounts/[id]/pilot-tracker
 *     → returns the active pilot project for this account (or null).
 *
 *   POST  /api/accounts/[id]/pilot-tracker
 *     → activates the pilot for this account. Idempotent: if an active
 *       project already exists, returns it. Creates a per-project Drive
 *       folder for participant screenshots.
 *
 *   PATCH /api/accounts/[id]/pilot-tracker
 *     → updates settings (name, targetAppVersion, betaInviteUrl,
 *       playStoreAppUrl, blockedEmailDomains, staleThresholdDays,
 *       pilotStart, pilotEnd, status). Body is a partial JSON object.
 *
 * Auth: signed-in users with canAccessClient() on the target account.
 * Mirrors src/app/api/accounts/[id]/pin-validator/route.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles, pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { ensurePilotProjectFolder } from "@/lib/pilot/drive";

export const dynamic = "force-dynamic";

interface ActorContext {
  userId: string;
  isAdmin: boolean;
}

async function authorizeActor(): Promise<
  { actor: ActorContext } | { error: { status: number; message: string } }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: { status: 401, message: "Unauthorized" } };
  }
  await ensureAccessSchema();
  return {
    actor: {
      userId: session.user.id as string,
      isAdmin: (session.user as any).role === "admin",
    },
  };
}

async function loadActiveProject(clientProfileId: string) {
  const rows = await db
    .select()
    .from(pilotProjects)
    .where(
      and(
        eq(pilotProjects.clientProfileId, clientProfileId),
        eq(pilotProjects.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] || null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorizeActor();
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  if (!(await canAccessClient(a.actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const project = await loadActiveProject(id);
    return NextResponse.json({ project });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load pilot project" },
      { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorizeActor();
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  if (!(await canAccessClient(a.actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Idempotent: if an active project exists, return it.
    const existing = await loadActiveProject(id);
    if (existing) {
      return NextResponse.json({ project: existing, created: false });
    }

    // Read the account's company name to default the project name.
    const [profile] = await db
      .select({ companyName: clientProfiles.companyName })
      .from(clientProfiles)
      .where(eq(clientProfiles.id, id))
      .limit(1);
    if (!profile) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Random 32-hex QR token — unguessable, unique across the whole table.
    const qrToken = crypto.randomBytes(16).toString("hex");
    const projectName = `${profile.companyName} — Tarkie V5 Pilot`;
    const projectId = crypto.randomUUID();

    // Create the Drive subfolder for participant screenshots. Do this
    // BEFORE the DB insert so a Drive failure aborts activation cleanly
    // (no orphaned project rows pointing at nothing).
    let driveFolderId: string | null = null;
    try {
      const folder = await ensurePilotProjectFolder(projectName, projectId);
      driveFolderId = folder.folderId;
    } catch (e: any) {
      // Drive not configured or service account can't see the parent —
      // return a helpful error. The admin can retry after fixing config;
      // no partial state persisted.
      return NextResponse.json(
        {
          error: `Drive setup failed: ${e?.message || String(e)}. Fix and retry activation.`,
        },
        { status: 500 },
      );
    }

    // Insert the project row. `id` and `qrToken` are pre-computed above
    // so we don't have to SELECT after INSERT.
    await db.insert(pilotProjects).values({
      id: projectId,
      clientProfileId: id,
      name: projectName,
      qrToken,
      driveFolderId,
      staleThresholdDays: 3,
      status: "active",
      createdByUserId: a.actor.userId,
    });

    const project = await loadActiveProject(id);
    return NextResponse.json({ project, created: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to activate pilot tracker" },
      { status: 500 },
    );
  }
}

// Settings fields the admin can update on an active project. Explicitly
// enumerated (not `Object.assign`) so someone can't POST a payload with
// e.g. `qrToken` and rotate the token accidentally.
const UPDATABLE_FIELDS = [
  "name",
  "targetAppVersion",
  "betaInviteUrl",
  "playStoreAppUrl",
  "blockedEmailDomains",
  "staleThresholdDays",
  "internalBetaRequired",
  "status",
  "pilotStart",
  "pilotEnd",
  "referenceScreenshotDriveId",
  "referenceScreenshotUrl",
  // Display labels for the two client-owned tag columns (e.g. "Branch",
  // "Area"). Blank/null hides the column from the roster grid and the
  // Sheet entirely.
  "custom1Label",
  "custom2Label",
] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorizeActor();
  if ("error" in a) {
    return NextResponse.json({ error: a.error.message }, { status: a.error.status });
  }
  if (!(await canAccessClient(a.actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const existing = await loadActiveProject(id);
    if (!existing) {
      return NextResponse.json({ error: "No active pilot project for this account" }, { status: 404 });
    }
    const body = await req.json();
    const updates: Record<string, any> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ project: existing, updated: false });
    }
    updates.updatedAt = new Date().toISOString();
    await db.update(pilotProjects).set(updates).where(eq(pilotProjects.id, existing.id));
    const project = await loadActiveProject(id);

    // Renaming (or first setting) a custom-column label changes the roster
    // Sheet's column layout. Re-push and re-protect immediately rather
    // than waiting for someone to press Refresh: a newly added column
    // would otherwise be missing from the Sheet, and — worse — sit
    // outside the protection map that Lock relies on.
    //
    // Only fires when a label actually changed, so ordinary settings saves
    // don't touch Drive. Best-effort: a Sheets failure must not fail the
    // settings save the CST just made.
    const labelChanged =
      ("custom1Label" in updates &&
        (updates.custom1Label || "") !== (existing.custom1Label || "")) ||
      ("custom2Label" in updates &&
        (updates.custom2Label || "") !== (existing.custom2Label || ""));
    let sheetResynced = false;
    if (labelChanged && existing.rosterSheetId) {
      try {
        const { pushToSheet, applyProtection } = await import("@/lib/pilot/roster-sheet");
        await pushToSheet(existing.id);
        await applyProtection(existing.id, existing.rosterSheetState === "locked");
        sheetResynced = true;
      } catch (e: any) {
        console.warn(
          "[pilot-tracker] custom label changed but Sheet re-sync failed:",
          e?.message || e,
        );
      }
    }
    return NextResponse.json({ project, updated: true, sheetResynced });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to update pilot project" },
      { status: 500 },
    );
  }
}
