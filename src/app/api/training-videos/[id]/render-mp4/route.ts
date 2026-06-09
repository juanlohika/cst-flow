import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { callRenderWorker } from "@/lib/training-video/worker-client";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;  // up to 10min for the render call

/**
 * POST /api/training-videos/<id>/render-mp4
 *
 * Validates the video has all its audio + a Drive folder, then calls the
 * Cloud Run render worker synchronously. On success, persists the final
 * MP4's Drive id + URL on the TrainingVideo row.
 *
 * Cloud Run renders sync (max 10 min per request) and we wait for the
 * response — keeps the implementation simple. Future optimization: switch
 * to async + polling if we ever do videos > 5 minutes.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let content: TrainingVideoContent | null = null;
    try { content = row.scenes ? JSON.parse(row.scenes) : null; } catch {}
    if (!content || content.scenes.length === 0) {
      return NextResponse.json({ error: "No scenes to render" }, { status: 400 });
    }
    if (!row.videoFolderId) {
      return NextResponse.json({ error: "Video folder missing — re-create the video." }, { status: 400 });
    }

    // Validate every scene has audio + duration before sending to worker
    const missingAudio = content.scenes.filter(s => !s.audioDriveFileId || !s.audioDurationSec);
    if (missingAudio.length > 0) {
      return NextResponse.json({
        error: `Cannot render — ${missingAudio.length} scene(s) missing audio: ${missingAudio.map(s => `#${s.order}`).join(", ")}. Regenerate audio first.`,
      }, { status: 400 });
    }

    // Mark as rendering
    const now = new Date().toISOString();
    await db.update(trainingVideos)
      .set({
        renderStatus: "rendering",
        renderStartedAt: now,
        renderError: null,
        status: "rendering",
        updatedAt: now,
      })
      .where(eq(trainingVideos.id, params.id));

    const result = await callRenderWorker({
      videoId: row.id,
      title: row.title,
      outputFolderId: row.videoFolderId,
      aspectRatio: (row.aspectRatio === "16:9" ? "16:9" : "9:16"),
      scenes: content.scenes.map(s => ({
        order: s.order,
        title: s.title,
        narrationScript: s.narrationScript,
        caption: s.caption,
        audioDriveFileId: s.audioDriveFileId!,
        audioDurationSec: s.audioDurationSec!,
      })),
      sourcePptxDriveFileId: row.sourceType === "pptx" && row.sourceDriveFileId ? row.sourceDriveFileId : undefined,
      sourceVideoDriveFileId: row.sourceType === "screen_recording" && row.sourceDriveFileId ? row.sourceDriveFileId : undefined,
    });

    if (!result.ok) {
      const failedAt = new Date().toISOString();
      await db.update(trainingVideos)
        .set({
          renderStatus: "error",
          renderError: result.error || "Render failed",
          status: "ready",         // back to ready so user can try again
          updatedAt: failedAt,
        })
        .where(eq(trainingVideos.id, params.id));
      return NextResponse.json({ error: result.error || "Render failed" }, { status: 500 });
    }

    const renderedAt = new Date().toISOString();
    await db.update(trainingVideos)
      .set({
        renderStatus: "done",
        renderError: null,
        status: "rendered",
        finalMp4DriveFileId: result.mp4DriveFileId,
        finalMp4DriveUrl: result.mp4DriveUrl,
        finalMp4RenderedAt: renderedAt,
        updatedAt: renderedAt,
      })
      .where(eq(trainingVideos.id, params.id));

    return NextResponse.json({
      mp4DriveFileId: result.mp4DriveFileId,
      mp4DriveUrl: result.mp4DriveUrl,
      durationSec: result.durationSec,
    });
  } catch (error: any) {
    console.error("[training-videos/[id]/render-mp4 POST]", error);
    try {
      await db.update(trainingVideos)
        .set({
          renderStatus: "error",
          renderError: error?.message || String(error),
          status: "ready",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, params.id));
    } catch {}
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}
