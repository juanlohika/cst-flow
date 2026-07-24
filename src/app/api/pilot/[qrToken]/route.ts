/**
 * Pilot Tracker — public portal metadata.
 *
 * GET /api/pilot/[qrToken]
 *   → { project: {name, targetAppVersion, betaInviteUrl, playStoreAppUrl,
 *                 referenceScreenshotUrl, status} }
 *   Returns only the fields the portal actually needs — no roster, no
 *   internal IDs. Fails with 404 if the token doesn't map to an active
 *   project (paused / closed / typo).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ qrToken: string }> }) {
  await ensureAccessSchema();
  const { qrToken } = await ctx.params;
  if (!qrToken || qrToken.length < 8) {
    return NextResponse.json({ error: "Invalid QR token" }, { status: 400 });
  }
  const [project] = await db
    .select({
      id: pilotProjects.id,
      name: pilotProjects.name,
      targetAppVersion: pilotProjects.targetAppVersion,
      betaInviteUrl: pilotProjects.betaInviteUrl,
      playStoreAppUrl: pilotProjects.playStoreAppUrl,
      referenceScreenshotUrl: pilotProjects.referenceScreenshotUrl,
      status: pilotProjects.status,
      blockedEmailDomains: pilotProjects.blockedEmailDomains,
      internalBetaRequired: pilotProjects.internalBetaRequired,
    })
    .from(pilotProjects)
    .where(eq(pilotProjects.qrToken, qrToken))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (project.status !== "active") {
    return NextResponse.json(
      { error: `Pilot is ${project.status}. Contact your CST rep.` },
      { status: 410 },
    );
  }
  // Never leak project.id to the client — the portal works entirely off
  // qrToken + participant.id (both server-validated on every call).
  const { id: _drop, ...safe } = project;
  return NextResponse.json({ project: safe });
}
