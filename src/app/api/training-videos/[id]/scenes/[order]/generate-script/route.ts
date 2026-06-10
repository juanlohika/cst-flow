import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { buildSingleSceneScript } from "@/lib/training-video/build-script";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/training-videos/[id]/scenes/[order]/generate-script
 *
 * Generate (or regenerate) the narrationScript for one scene without
 * touching the others. Reads extractedContent so we don't re-download
 * the source. Returns the updated scene; caller is responsible for
 * generating audio (`/generate-scene-audio?order=N`) after.
 */
export async function POST(_req: Request, { params }: { params: { id: string; order: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const order = Number(params.order);
    if (!Number.isFinite(order)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!row.scenes) return NextResponse.json({ error: "No scenes yet — run /generate-script first" }, { status: 400 });
    if (!row.extractedContent) return NextResponse.json({ error: "No extracted source — run /extract-source first" }, { status: 400 });

    let content: TrainingVideoContent;
    try { content = JSON.parse(row.scenes); } catch { return NextResponse.json({ error: "Corrupt scenes JSON" }, { status: 500 }); }
    const scene = content.scenes.find(s => s.order === order);
    if (!scene) return NextResponse.json({ error: `Scene ${order} not found` }, { status: 404 });

    const extracted = JSON.parse(row.extractedContent);
    const result = await buildSingleSceneScript({
      sourceKind: extracted.kind,
      pptxBuffer: extracted.kind === "pptx" ? Buffer.from(extracted.base64, "base64") : undefined,
      frames: extracted.kind === "video_frames" ? extracted.frames : undefined,
      scene: {
        order: scene.order,
        title: scene.title,
        sourceSlideNumber: scene.sourceSlideNumber,
        sourceStartSec: scene.sourceStartSec,
        sourceEndSec: scene.sourceEndSec,
        caption: scene.caption,
        aiNote: scene.aiNote,
      },
      totalScenes: content.scenes.length,
      language: row.language,
      userPrompt: row.userPrompt || undefined,
    });

    if (!result.ok || !result.narrationScript) {
      return NextResponse.json({ error: result.error || "Script generation failed", rawAi: result.rawAi }, { status: 500 });
    }

    // Update the scene in place. Mark it edited=false so it stays in sync
    // with the AI version (user can still hit Edit script after if they
    // want manual control), and clear stale aiNote since we just refreshed.
    scene.narrationScript = result.narrationScript;
    scene.caption = result.narrationScript; // mirror narration to caption (same as initial gen)
    scene.aiNote = undefined;
    scene.edited = false;
    // Invalidate any existing audio — it's now stale relative to the new script.
    // We leave the file in Drive so the user doesn't immediately lose access,
    // but null the references so the UI shows "No audio" / "Generate audio".
    scene.audioDriveFileId = null;
    scene.audioDriveUrl = null;
    scene.audioDurationSec = null;
    scene.durationSec = undefined;

    await db.update(trainingVideos)
      .set({
        scenes: JSON.stringify(content),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trainingVideos.id, params.id));

    return NextResponse.json({ videoId: params.id, order, scene });
  } catch (error: any) {
    console.error("[scenes/[order]/generate-script POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
