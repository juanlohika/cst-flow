import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, downloadFile } from "@/lib/training-video/drive";
import { callExtractFrames } from "@/lib/training-video/worker-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Frame extraction for a 5-minute screen recording takes ~30-60s. PPTX
// download from Drive is a few seconds.
export const maxDuration = 300;

/**
 * POST /api/training-videos/[id]/extract-source
 *
 * Stage 2 of the pipeline.
 * - For PPTX rows: downloads the .pptx from Drive into memory, stores its
 *   base64 bytes on extractedContent (so /generate-script can attach it
 *   as inlineData without re-downloading).
 * - For screen_recording rows: calls the worker's /extract-frames endpoint
 *   to get keyframe JPEGs + durationSec, stores them on extractedContent.
 *
 * Flips status to "content-extracted" on success, "error" on failure
 * (errorStage="extract").
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!row.sourceDriveFileId) {
      return NextResponse.json({ error: "Source not uploaded yet — call /upload-finalize-source first" }, { status: 400 });
    }

    try {
      let payload: any;
      if (row.sourceType === "pptx") {
        const ctx = await loadDriveCtx();
        const buf = await downloadFile(ctx, row.sourceDriveFileId);
        payload = {
          kind: "pptx",
          base64: buf.toString("base64"),
          bytes: buf.length,
        };
      } else if (row.sourceType === "screen_recording") {
        const framesResult = await callExtractFrames({
          sourceVideoDriveFileId: row.sourceDriveFileId,
          intervalSec: 2,
        });
        if (!framesResult.ok || !framesResult.frames || !framesResult.durationSec) {
          throw new Error(framesResult.error || "Frame extraction returned no data");
        }
        payload = {
          kind: "video_frames",
          frames: framesResult.frames,
          durationSec: framesResult.durationSec,
        };
      } else {
        throw new Error(`Unsupported sourceType: ${row.sourceType}`);
      }

      await db.update(trainingVideos)
        .set({
          extractedContent: JSON.stringify(payload),
          status: "content-extracted",
          errorMessage: null,
          errorStage: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, params.id));

      return NextResponse.json({
        videoId: params.id,
        status: "content-extracted",
        kind: payload.kind,
        ...(payload.kind === "video_frames" ? { durationSec: payload.durationSec, frameCount: payload.frames.length } : { bytes: payload.bytes }),
      });
    } catch (stageErr: any) {
      await db.update(trainingVideos)
        .set({
          status: "error",
          errorStage: "extract",
          errorMessage: stageErr?.message || String(stageErr),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, params.id));
      return NextResponse.json({ error: stageErr?.message || "Extract failed", stage: "extract" }, { status: 500 });
    }
  } catch (error: any) {
    console.error("[training-videos/[id]/extract-source POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
