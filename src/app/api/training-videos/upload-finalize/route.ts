import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, uploadSceneAudio } from "@/lib/training-video/drive";
import { buildScriptFromVideoFrames } from "@/lib/training-video/build-script";
import { synthesizeScenes } from "@/lib/training-video/tts";
import { callExtractFrames } from "@/lib/training-video/worker-client";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Long max: extract-frames + Vision + TTS for a 5min screen recording can
// take ~3-5min total. We run synchronously and stream progress to the DB.
export const maxDuration = 600;

/**
 * POST /api/training-videos/upload-finalize
 * body: { videoId, driveFileId }
 *
 * Called after the browser finishes PUT-ing the MP4 to the resumable
 * Drive URL minted by /upload-init. Runs the rest of the pipeline:
 *   extract-frames → Gemini Vision (script + scenes) → per-scene TTS.
 *
 * Returns immediately while polling for status is done via the
 * /api/training-videos/[id]/progress endpoint.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const videoId = String(body?.videoId || "").trim();
    const driveFileId = String(body?.driveFileId || "").trim();
    if (!videoId || !driveFileId) {
      return NextResponse.json({ error: "videoId and driveFileId required" }, { status: 400 });
    }

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, videoId)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Video row not found" }, { status: 404 });
    if (row.sourceType !== "screen_recording") {
      return NextResponse.json({ error: "Not a screen recording video" }, { status: 400 });
    }
    if (!row.videoFolderId) {
      return NextResponse.json({ error: "Video folder missing — re-upload." }, { status: 400 });
    }

    // Persist the Drive file id + flip status from uploading → generating
    await db.update(trainingVideos)
      .set({
        sourceDriveFileId: driveFileId,
        status: "generating",
        ttsProgress: JSON.stringify({ phase: "extracting-frames" }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trainingVideos.id, videoId));

    const ctx = await loadDriveCtx();
    const title = row.title;
    const userPrompt = row.userPrompt || undefined;
    const language = row.language;
    const voice = row.voice;
    const ttsModel = row.ttsModel;

    // 1. Extract keyframes via the worker
    const framesResult = await callExtractFrames({
      sourceVideoDriveFileId: driveFileId,
      intervalSec: 2,
    });
    if (!framesResult.ok || !framesResult.frames || !framesResult.durationSec) {
      await db.update(trainingVideos)
        .set({
          status: "error",
          errorMessage: framesResult.error || "Frame extraction failed",
          ttsProgress: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, videoId));
      return NextResponse.json({ error: framesResult.error, videoId }, { status: 500 });
    }

    await db.update(trainingVideos)
      .set({
        ttsProgress: JSON.stringify({ phase: "generating-script" }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trainingVideos.id, videoId));

    // 2. Generate scripts from frames
    const scriptResult = await buildScriptFromVideoFrames({
      frames: framesResult.frames,
      durationSec: framesResult.durationSec,
      title,
      userPrompt,
      language,
    });
    if (!scriptResult.ok || !scriptResult.content) {
      await db.update(trainingVideos)
        .set({
          status: "error",
          errorMessage: scriptResult.error || "Script generation failed",
          ttsProgress: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, videoId));
      return NextResponse.json({ error: scriptResult.error, videoId, rawAi: (scriptResult as any).rawAi }, { status: 500 });
    }

    // 3. Per-scene TTS (paced + 429-retried)
    const content: TrainingVideoContent = scriptResult.content;
    const ttsResults = await synthesizeScenes({
      scenes: content.scenes.map(s => ({ order: s.order, narrationScript: s.narrationScript })),
      voice,
      model: ttsModel,
      stylePrompt: "Read in a lively, clear, and informative tone, like a friendly product trainer guiding a new user",
      language,
      onProgress: async (done, total, current) => {
        await db.update(trainingVideos)
          .set({ ttsProgress: JSON.stringify({ phase: "tts", done, total, current }), updatedAt: new Date().toISOString() })
          .where(eq(trainingVideos.id, videoId));
      },
    });
    for (const r of ttsResults) {
      const scene = content.scenes.find(s => s.order === r.order);
      if (!scene) continue;
      if (!r.ok || !r.audio) {
        scene.aiNote = `TTS failed: ${r.error}`;
        continue;
      }
      const upload = await uploadSceneAudio(ctx, {
        videoFolderId: row.videoFolderId,
        sceneOrder: scene.order,
        buffer: r.audio,
      });
      scene.audioDriveFileId = upload.fileId;
      scene.audioDriveUrl = upload.webViewLink;
      scene.audioDurationSec = r.durationSec || null;
      scene.durationSec = (r.durationSec || 0) + 0.6;
    }

    const reply = scriptResult.reply || `Segmented the recording into ${content.scenes.length} scenes and generated voiceover. Review and edit any scenes that need polish, then click Render MP4.`;
    const messages = [
      { role: "user", content: `Uploaded ${row.sourceDriveFileName}${userPrompt ? ` — prompt: ${userPrompt}` : ""}`, attachmentNames: [row.sourceDriveFileName || "screen-recording.mp4"] },
      { role: "assistant", content: reply },
    ];

    await db.update(trainingVideos)
      .set({
        scenes: JSON.stringify(content),
        messages: JSON.stringify(messages),
        status: "ready",
        ttsProgress: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trainingVideos.id, videoId));

    return NextResponse.json({
      videoId,
      content,
      reply,
      videoFolderUrl: `https://drive.google.com/drive/folders/${row.videoFolderId}`,
    });
  } catch (error: any) {
    console.error("[training-videos/upload-finalize POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
