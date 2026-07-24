/**
 * Pilot Tracker — participant screenshot upload (public portal).
 *
 * POST /api/pilot/[qrToken]/participant/[id]/screenshot
 *   multipart/form-data with `file` (image)
 *
 * Uploads the participant's version-proof screenshot to the pilot
 * project's Drive folder. Overwrites any previous upload from the same
 * participant (the DB reference gets replaced; the old Drive file is
 * deleted best-effort).
 *
 * On upload success, also fires the Gemini vision verification pass — if
 * the AI can read the version and it matches targetAppVersion, the
 * record is marked verified automatically. If uncertain or mismatched,
 * it lands in the manual review queue.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pilotParticipants, pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { uploadScreenshotToDrive, deleteDriveFile } from "@/lib/pilot/drive";
import { updateParticipant } from "@/lib/pilot/participant-mutations";
import { verifyVersionScreenshot } from "@/lib/pilot/version-verifier";

export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ qrToken: string; id: string }> }) {
  await ensureAccessSchema();
  const { qrToken, id } = await ctx.params;

  // Resolve project + participant (same-project guard).
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(and(eq(pilotProjects.qrToken, qrToken), eq(pilotProjects.status, "active")))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Pilot not available" }, { status: 404 });
  }
  const [participant] = await db
    .select()
    .from(pilotParticipants)
    .where(
      and(
        eq(pilotParticipants.id, id),
        eq(pilotParticipants.projectId, project.id),
      ),
    )
    .limit(1);
  if (!participant) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }
  if (!project.driveFolderId) {
    return NextResponse.json({ error: "Project has no Drive folder configured" }, { status: 500 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `File type ${file.type} not allowed. Use PNG, JPEG, or WebP.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Max ${MAX_BYTES} bytes.` },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type.split("/")[1] || "png";
    const filename = `${participant.employeeId}-${Date.now()}.${ext}`;
    const uploaded = await uploadScreenshotToDrive({
      folderId: project.driveFolderId,
      buffer,
      filename,
      mimeType: file.type,
    });

    // Best-effort cleanup of prior upload
    if (participant.versionScreenshotDriveId) {
      deleteDriveFile(participant.versionScreenshotDriveId).catch(() => {});
    }

    // Save the file reference. This flips currentStage → 5 automatically
    // via updateParticipant + computeStage. Mobile-confirmed guard is in
    // the state machine.
    await updateParticipant(
      participant.id,
      {
        versionScreenshotDriveId: uploaded.fileId,
        versionScreenshotUrl: uploaded.webViewLink,
        // Reset verification state so a re-upload doesn't inherit stale
        // verdict from the previous file.
        versionVerified: "pending",
        versionVerifiedByAi: false,
        versionAiExtractedText: null,
        versionVerifiedByUserId: null,
        versionVerifiedAt: null,
      },
      { actor: "participant" },
    );

    // Fire-and-forget Gemini verification. We don't await the result
    // because the participant should get an instant "uploaded" response.
    // The verifier writes back to the DB when it settles. If Gemini is
    // down or uncertain, the record stays in the manual queue.
    verifyVersionScreenshot({
      participantId: participant.id,
      screenshotBuffer: buffer,
      screenshotMimeType: file.type,
      targetVersion: project.targetAppVersion,
    }).catch((e) => {
      console.warn("[pilot/screenshot] verifier failed:", e);
    });

    return NextResponse.json({
      fileId: uploaded.fileId,
      url: uploaded.webViewLink,
      verificationStatus: "pending",
      message:
        "Screenshot uploaded. We're checking it — the status here will update automatically.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Upload failed" },
      { status: 500 },
    );
  }
}
