import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, uploadSceneAudio } from "@/lib/training-video/drive";
import { synthesizeSpeech } from "@/lib/training-video/tts";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One TTS call + Drive upload is typically 3-10s. We allow up to 90s in
// case Gemini's 429 retry kicks in (20s + 40s + 60s backoff = ~120s worst
// case — but most retries hit on the first or second).
export const maxDuration = 150;

/**
 * POST /api/training-videos/[id]/generate-scene-audio?order=N
 *
 * Stage 4 — generates audio for ONE scene. Browser calls this per scene
 * in series (with a small client-side delay between calls so we don't
 * burn the per-minute Gemini quota).
 *
 * Idempotent: re-running for the same scene overwrites the previous audio
 * (this is how the Retry button works on the scene card).
 *
 * Flips the row's status to "generating-audio" while running, and to
 * "ready" once every scene has audio. On failure, status="error" +
 * errorStage="tts-N".
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const url = new URL(req.url);
    const orderParam = url.searchParams.get("order");
    const order = orderParam ? Number(orderParam) : NaN;
    if (!order || !Number.isFinite(order)) {
      return NextResponse.json({ error: "?order=N required" }, { status: 400 });
    }

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!row.scenes) return NextResponse.json({ error: "No scenes yet — call /generate-script first" }, { status: 400 });
    if (!row.videoFolderId) return NextResponse.json({ error: "Video folder missing" }, { status: 400 });

    let content: TrainingVideoContent;
    try { content = JSON.parse(row.scenes); } catch { return NextResponse.json({ error: "Corrupt scenes JSON" }, { status: 500 }); }

    const scene = content.scenes.find(s => s.order === order);
    if (!scene) return NextResponse.json({ error: `Scene ${order} not found` }, { status: 404 });
    if (!scene.narrationScript?.trim()) {
      return NextResponse.json({ error: `Scene ${order} has empty narration` }, { status: 400 });
    }

    // Flip row status to generating-audio while we work
    await db.update(trainingVideos)
      .set({
        status: "generating-audio",
        ttsProgress: JSON.stringify({ phase: "tts", currentOrder: order }),
        errorMessage: null,
        errorStage: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trainingVideos.id, params.id));

    try {
      const tts = await synthesizeSpeech({
        text: scene.narrationScript,
        voice: row.voice,
        model: row.ttsModel,
        stylePrompt: row.stylePrompt || "Read in a lively, clear, and informative tone, like a friendly product trainer guiding a new user",
        language: row.language,
      });
      if (!tts.ok || !tts.audio) {
        throw new Error(tts.error || "TTS returned no audio");
      }

      const ctx = await loadDriveCtx();
      const upload = await uploadSceneAudio(ctx, {
        videoFolderId: row.videoFolderId,
        sceneOrder: scene.order,
        buffer: tts.audio,
      });

      // Update the scene in-place
      scene.audioDriveFileId = upload.fileId;
      scene.audioDriveUrl = upload.webViewLink;
      scene.audioDurationSec = tts.durationSec || null;
      scene.durationSec = (tts.durationSec || 0) + 0.6;
      scene.aiNote = undefined; // clear any stale "TTS failed" note

      // Are we done? (all scenes with non-empty narration now have audio)
      const allDone = content.scenes.every(s =>
        !s.narrationScript?.trim() || !!s.audioDriveFileId
      );

      await db.update(trainingVideos)
        .set({
          scenes: JSON.stringify(content),
          status: allDone ? "ready" : "generating-audio",
          ttsProgress: allDone ? null : JSON.stringify({ phase: "tts", lastDone: order }),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, params.id));

      return NextResponse.json({
        videoId: params.id,
        order,
        status: allDone ? "ready" : "generating-audio",
        audioDriveFileId: upload.fileId,
        audioDriveUrl: upload.webViewLink,
        audioDurationSec: tts.durationSec,
        allDone,
      });
    } catch (sceneErr: any) {
      await db.update(trainingVideos)
        .set({
          status: "error",
          errorStage: `tts-${order}`,
          errorMessage: sceneErr?.message || String(sceneErr),
          ttsProgress: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, params.id));
      return NextResponse.json({ error: sceneErr?.message || "TTS failed", stage: `tts-${order}`, order }, { status: 500 });
    }
  } catch (error: any) {
    console.error("[training-videos/[id]/generate-scene-audio POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
