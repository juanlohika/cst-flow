/**
 * Pin Validator pins API — used by both the external validator UI and the
 * internal AccountHub monitoring view. The two auth strategies merge here:
 *
 *   - External: cookie session from /pin-validator/welcome (validator scope)
 *   - Internal: CST OS NextAuth session + account access check
 *
 * GET  → list of pins (every pin with lat+lng on the Sheet)
 * POST → save a decision. Body:
 *          { rowNumber, decision: "Approved" | "Flagged", note? }
 *        or for bulk:
 *          { decisions: [{ rowNumber, decision, note? }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pinValidatorProjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { getPinValidatorSession } from "@/lib/pin-validator/session";
import {
  listPins,
  saveDecision,
  saveDecisionsBulk,
  savePinAdjustment,
  type Decision,
} from "@/lib/pin-validator/pins";

export const dynamic = "force-dynamic";

interface AuthedContext {
  projectId: string;
  googleSheetId: string;
  validatorEmail: string; // who's logging this decision
  canWrite: boolean;      // internal monitors are read-only by default
}

async function authorize(
  projectId: string,
): Promise<AuthedContext | { error: { status: number; message: string } }> {
  // First try the external validator session (cookie).
  const ext = await getPinValidatorSession();
  if (ext && ext.projectId === projectId) {
    return {
      projectId,
      googleSheetId: ext.googleSheetId,
      validatorEmail: ext.contactEmail,
      canWrite: true,
    };
  }

  // Otherwise fall back to the internal CST OS session.
  const session = await auth();
  if (session?.user?.id) {
    const actor = {
      userId: session.user.id as string,
      isAdmin: (session.user as any).role === "admin",
    };
    const project = await db
      .select({
        clientProfileId: pinValidatorProjects.clientProfileId,
        googleSheetId: pinValidatorProjects.googleSheetId,
        status: pinValidatorProjects.status,
      })
      .from(pinValidatorProjects)
      .where(eq(pinValidatorProjects.id, projectId))
      .limit(1);
    if (project.length === 0 || project[0].status !== "active") {
      return { error: { status: 404, message: "Project not found" } };
    }
    await ensureAccessSchema();
    if (!(await canAccessClient(actor, project[0].clientProfileId))) {
      return { error: { status: 403, message: "Forbidden" } };
    }
    return {
      projectId,
      googleSheetId: project[0].googleSheetId,
      validatorEmail: session.user.email || `cst:${actor.userId}`,
      canWrite: false, // internal users are monitors, not validators
    };
  }

  return { error: { status: 401, message: "Unauthorized" } };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const r = await authorize(projectId);
  if ("error" in r) {
    return NextResponse.json({ error: r.error.message }, { status: r.error.status });
  }
  try {
    const pins = await listPins(r.googleSheetId);
    return NextResponse.json({ pins, canWrite: r.canWrite });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load pins" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await ctx.params;
  const r = await authorize(projectId);
  if ("error" in r) {
    return NextResponse.json({ error: r.error.message }, { status: r.error.status });
  }
  if (!r.canWrite) {
    return NextResponse.json(
      { error: "Read-only — only invited validators can save decisions." },
      { status: 403 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // Manual pin adjustment — validator dragged the marker to a corrected
    // location. Counts as an implicit Approved.
    if (body?.kind === "adjust") {
      const rowNumber = Number(body?.rowNumber);
      const newLat = Number(body?.newLat);
      const newLng = Number(body?.newLng);
      const originalLat = Number(body?.originalLat);
      const originalLng = Number(body?.originalLng);
      const note = body?.note ? String(body.note) : "";
      if (
        !Number.isFinite(rowNumber) ||
        !Number.isFinite(newLat) ||
        !Number.isFinite(newLng) ||
        !Number.isFinite(originalLat) ||
        !Number.isFinite(originalLng)
      ) {
        return NextResponse.json(
          { error: "rowNumber + newLat + newLng + originalLat + originalLng required (numbers)" },
          { status: 400 },
        );
      }
      // Basic sanity — coordinates inside valid Earth ranges.
      if (Math.abs(newLat) > 90 || Math.abs(newLng) > 180) {
        return NextResponse.json(
          { error: "newLat/newLng out of range" },
          { status: 400 },
        );
      }
      await savePinAdjustment(
        r.googleSheetId,
        rowNumber,
        newLat,
        newLng,
        originalLat,
        originalLng,
        note,
        r.validatorEmail,
      );
      return NextResponse.json({ ok: true });
    }

    if (Array.isArray(body?.decisions)) {
      const decisions: Array<{ rowNumber: number; decision: Decision; note: string }> = [];
      for (const d of body.decisions) {
        const row = Number(d?.rowNumber);
        const decision = d?.decision as Decision;
        const note = d?.note ? String(d.note) : "";
        if (!Number.isFinite(row) || !["Approved", "Flagged"].includes(decision)) continue;
        decisions.push({ rowNumber: row, decision, note });
      }
      await saveDecisionsBulk(r.googleSheetId, decisions, r.validatorEmail);
      return NextResponse.json({ ok: true, saved: decisions.length });
    }

    const rowNumber = Number(body?.rowNumber);
    const decision = body?.decision as Decision;
    const note = body?.note ? String(body.note) : "";
    if (!Number.isFinite(rowNumber) || !["Approved", "Flagged"].includes(decision)) {
      return NextResponse.json(
        { error: "rowNumber + decision (Approved|Flagged) required" },
        { status: 400 },
      );
    }
    await saveDecision(r.googleSheetId, rowNumber, decision, note, r.validatorEmail);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[pin-validator/pins:POST] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to save decision" },
      { status: 500 },
    );
  }
}
