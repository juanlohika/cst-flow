/**
 * Pilot Tracker — participant portal read/update.
 *
 * GET /api/pilot/[qrToken]/participant/[id]
 *   → the participant's full record for the portal (their own fields only)
 *
 * PATCH /api/pilot/[qrToken]/participant/[id]
 *   body: { updates: {...} }
 *   → runs updateParticipant() as actor:"participant". Whitelisted fields:
 *     playstoreEmail, emailConfirmedIsPlaystore, invitationAcceptedDeclared,
 *     invitationLinkFailed, appUpdatedDeclared, mobileNumberCorrected,
 *     mobileConfirmed, reportedVersion.
 *   Everything else is admin-side only.
 *
 * Both routes verify that the participant belongs to the project addressed
 * by the qrToken. A stranger who knows a participant ID can't read/update
 * without also knowing the QR token.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pilotParticipants, pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { updateParticipant, type ParticipantUpdate } from "@/lib/pilot/participant-mutations";

export const dynamic = "force-dynamic";

// Fields a participant is allowed to write via the portal. Explicitly
// enumerated — anything not on this list is silently dropped rather than
// causing a 400, so the portal can post a fuller object without worrying.
const PORTAL_WRITABLE_FIELDS = new Set<keyof ParticipantUpdate>([
  "playstoreEmail",
  "emailConfirmedIsPlaystore",
  "invitationAcceptedDeclared",
  "invitationLinkFailed",
  "appUpdatedDeclared",
  "mobileNumberCorrected",
  "mobileConfirmed",
  "reportedVersion",
  // One-tap Screen F confirmation. updateParticipant() auto-verifies when
  // this flips to true and stamps reportedVersion from project.targetAppVersion.
  "versionConfirmedByUser",
  // Work-email confirmation (only rendered when workEmail is on file).
  // Participant can NOT edit workEmail from the portal — that's admin-side.
  "workEmailConfirmed",
]);

async function resolveParticipant(qrToken: string, participantId: string) {
  const [project] = await db
    .select({ id: pilotProjects.id, status: pilotProjects.status })
    .from(pilotProjects)
    .where(eq(pilotProjects.qrToken, qrToken))
    .limit(1);
  if (!project || project.status !== "active") return null;
  const [participant] = await db
    .select()
    .from(pilotParticipants)
    .where(
      and(
        eq(pilotParticipants.id, participantId),
        eq(pilotParticipants.projectId, project.id),
      ),
    )
    .limit(1);
  return participant || null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ qrToken: string; id: string }> }) {
  await ensureAccessSchema();
  const { qrToken, id } = await ctx.params;
  const p = await resolveParticipant(qrToken, id);
  if (!p) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Return only the fields the portal shows — no internal audit metadata.
  return NextResponse.json({
    participant: {
      id: p.id,
      employeeId: p.employeeId,
      fullName: p.fullName,
      mobileNumber: p.mobileNumber,
      mobileNumberCorrected: p.mobileNumberCorrected,
      mobileConfirmed: Boolean(p.mobileConfirmed),
      playstoreEmail: p.playstoreEmail,
      emailConfirmedIsPlaystore: Boolean(p.emailConfirmedIsPlaystore),
      workEmail: p.workEmail,
      workEmailConfirmed: Boolean(p.workEmailConfirmed),
      betaRegistered: Boolean(p.betaRegistered),
      invitationAcceptedDeclared: Boolean(p.invitationAcceptedDeclared),
      invitationLinkFailed: Boolean(p.invitationLinkFailed),
      appUpdatedDeclared: Boolean(p.appUpdatedDeclared),
      reportedVersion: p.reportedVersion,
      versionScreenshotUrl: p.versionScreenshotUrl,
      versionConfirmedByUser: Boolean(p.versionConfirmedByUser),
      versionVerified: p.versionVerified,
      currentStage: p.currentStage,
      issueFlag: p.issueFlag,
    },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ qrToken: string; id: string }> }) {
  await ensureAccessSchema();
  const { qrToken, id } = await ctx.params;
  const p = await resolveParticipant(qrToken, id);
  if (!p) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const body = await req.json();
    const raw = (body.updates || {}) as Record<string, any>;
    const filtered: ParticipantUpdate = {};
    for (const [key, val] of Object.entries(raw)) {
      if (PORTAL_WRITABLE_FIELDS.has(key as keyof ParticipantUpdate)) {
        (filtered as any)[key] = val;
      }
    }
    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { error: "No writable fields in payload" },
        { status: 400 },
      );
    }
    const result = await updateParticipant(p.id, filtered, {
      actor: "participant",
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Update failed" },
      { status: 500 },
    );
  }
}
