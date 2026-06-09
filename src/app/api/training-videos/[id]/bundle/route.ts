import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, downloadFile } from "@/lib/training-video/drive";
import { buildSrt, buildVtt } from "@/lib/training-video/tts";
import type { TrainingVideoContent } from "@/lib/training-video/types";
import JSZip from "jszip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/training-videos/<id>/bundle
 *
 * Streams a .zip containing:
 *   - All scene audio files (wav) numbered in order
 *   - script.txt with the full narration (scene-by-scene)
 *   - captions.srt + captions.vtt
 *   - source.pptx (the original upload)
 *   - README.txt with assembly instructions
 *
 * Designed for the team to drop into CapCut / Descript / iMovie for final
 * MP4 assembly until Phase G.2 ships a server-side renderer.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let content: TrainingVideoContent | null = null;
    try { content = row.scenes ? JSON.parse(row.scenes) : null; } catch {}
    if (!content) return NextResponse.json({ error: "No content to bundle" }, { status: 400 });

    const ctx = await loadDriveCtx();
    const zip = new JSZip();

    // README
    zip.file("README.txt", buildReadme(row.title, content));

    // Per-scene scripts
    const scriptText = content.scenes
      .map(s => `[Scene ${s.order}] ${s.title}\n${s.narrationScript}\n`)
      .join("\n");
    zip.file("script.txt", scriptText);

    // Captions
    zip.file("captions.srt", buildSrt(content.scenes));
    zip.file("captions.vtt", buildVtt(content.scenes));

    // Per-scene audio
    const audioFolder = zip.folder("audio");
    if (audioFolder) {
      for (const scene of content.scenes) {
        if (!scene.audioDriveFileId) continue;
        try {
          const audio = await downloadFile(ctx, scene.audioDriveFileId);
          const name = `scene_${String(scene.order).padStart(2, "0")}.wav`;
          audioFolder.file(name, audio);
        } catch (e: any) {
          console.warn(`[bundle] failed to fetch scene ${scene.order} audio:`, e?.message);
        }
      }
    }

    // Source PPTX
    if (row.sourceDriveFileId) {
      try {
        const pptx = await downloadFile(ctx, row.sourceDriveFileId);
        zip.file(row.sourceDriveFileName || "source.pptx", pptx);
      } catch (e: any) {
        console.warn(`[bundle] failed to fetch source PPTX:`, e?.message);
      }
    }

    const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const fileName = `${row.title.replace(/[\/\\]+/g, " ")} — training bundle.zip`;
    return new Response(new Uint8Array(blob), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error("[training-videos/[id]/bundle GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

function buildReadme(title: string, content: TrainingVideoContent): string {
  return `# ${title}

This bundle contains everything needed to assemble a training video manually.

## Contents

- README.txt — this file
- script.txt — narration scene-by-scene (for review)
- captions.srt — SubRip subtitle file (drop into CapCut / DaVinci / iMovie)
- captions.vtt — WebVTT subtitle file (HTML5 video / browser playback)
- audio/scene_NN.wav — one audio file per scene, in order
- ${content.scenes.length > 0 ? "source.pptx" : ""} — original PowerPoint deck used as the source

## Suggested Assembly Workflow

Recommended tools (all free):
- CapCut Desktop (Mac/Windows) — easiest, mobile-vertical-friendly
- DaVinci Resolve — more advanced
- iMovie — basic edits

1. Export each PPTX slide as a PNG (File → Export → PNG) in PowerPoint, OR
   take screenshots in slide-show mode.
2. Drop each slide PNG and its matching scene audio into the timeline in order.
3. Set each scene's duration to match its audio length (audio files are sized
   exactly to the narration — no extra trimming needed).
4. Add the captions.srt as a subtitle track.
5. Export at 1080×1920 (vertical) or 1920×1080 (horizontal).

## Scene Summary

${content.scenes.map(s => `  Scene ${s.order} — ${s.title} (${Math.round((s.audioDurationSec || 0) * 10) / 10}s)`).join("\n")}

Total estimated duration: ${Math.round(content.scenes.reduce((sum, s) => sum + (s.audioDurationSec || 0), 0))}s
`;
}
