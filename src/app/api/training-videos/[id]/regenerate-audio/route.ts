import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, uploadSceneAudio } from "@/lib/training-video/drive";
import { synthesizeScenes } from "@/lib/training-video/tts";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/training-videos/<id>/regenerate-audio
 * Body: { sceneOrder?: number, all?: boolean }
 *
 * Regenerate TTS for one specific scene (sceneOrder) or for all scenes
 * (e.g. after a voice change). Updates scenes JSON with new audio refs.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const sceneOrder = body?.sceneOrder ? Number(body.sceneOrder) : null;
    const all = !!body?.all;
    if (!sceneOrder && !all) return NextResponse.json({ error: "Provide sceneOrder or all=true" }, { status: 400 });

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!row.videoFolderId) return NextResponse.json({ error: "Video folder missing — re-create the video." }, { status: 400 });

    let content: TrainingVideoContent | null = null;
    try { content = row.scenes ? JSON.parse(row.scenes) : null; } catch {}
    if (!content) return NextResponse.json({ error: "No script to regenerate" }, { status: 400 });

    const ctx = await loadDriveCtx();
    const stylePrompt = row.stylePrompt || "Read in a lively, clear, and informative tone, like a friendly product trainer guiding a new user";

    const errors: string[] = [];
    let regeneratedCount = 0;

    // Build the list of scenes to regenerate (one specific scene OR all)
    const toRegen = content.scenes.filter(s => all || s.order === sceneOrder);

    const ttsResults = await synthesizeScenes({
      scenes: toRegen.map(s => ({ order: s.order, narrationScript: s.narrationScript })),
      voice: row.voice,
      model: row.ttsModel,
      stylePrompt,
      language: row.language,
      // Single-scene regen doesn't need pacing
      betweenScenesMs: toRegen.length > 1 ? 12_000 : 0,
      onProgress: async (done, total, current) => {
        await db.update(trainingVideos)
          .set({ ttsProgress: JSON.stringify({ done, total, current }), updatedAt: new Date().toISOString() })
          .where(eq(trainingVideos.id, params.id));
      },
    });

    for (const r of ttsResults) {
      const scene = content.scenes.find(s => s.order === r.order);
      if (!scene) continue;
      if (!r.ok || !r.audio) {
        errors.push(`Scene ${scene.order}: ${r.error}`);
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
      regeneratedCount++;
    }

    await db.update(trainingVideos)
      .set({ scenes: JSON.stringify(content), ttsProgress: null, updatedAt: new Date().toISOString() })
      .where(eq(trainingVideos.id, params.id));

    return NextResponse.json({
      regeneratedCount,
      errors,
      content,
    });
  } catch (error: any) {
    console.error("[training-videos/[id]/regenerate-audio POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
