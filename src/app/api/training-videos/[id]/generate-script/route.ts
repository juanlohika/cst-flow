import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { buildScriptFromPptx, buildScriptFromVideoFrames } from "@/lib/training-video/build-script";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Gemini Vision over 60 frames takes 30-45s. PPTX-based gen is similar.
// Both fit comfortably in a single request.
export const maxDuration = 120;

/**
 * POST /api/training-videos/[id]/generate-script
 *
 * Stage 3 of the pipeline. Reads extractedContent from the row, runs
 * Gemini to produce the scenes JSON, persists it. Flips status to
 * "script-generated" on success.
 *
 * Idempotent — re-running this overwrites the scenes (useful for users
 * who want to regenerate the script without re-uploading or
 * re-extracting). Caller is responsible for first deleting the row's
 * scene audio if they want a clean slate.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!row.extractedContent) {
      return NextResponse.json({ error: "Source not extracted yet — call /extract-source first" }, { status: 400 });
    }

    try {
      const extracted = JSON.parse(row.extractedContent);
      let result;
      if (extracted.kind === "pptx") {
        const buf = Buffer.from(extracted.base64, "base64");
        result = await buildScriptFromPptx({
          pptxBuffer: buf,
          title: row.title,
          userPrompt: row.userPrompt || undefined,
          language: row.language,
        });
      } else if (extracted.kind === "video_frames") {
        result = await buildScriptFromVideoFrames({
          frames: extracted.frames,
          durationSec: extracted.durationSec,
          title: row.title,
          userPrompt: row.userPrompt || undefined,
          language: row.language,
        });
      } else {
        throw new Error(`Unknown extracted content kind: ${extracted.kind}`);
      }

      if (!result.ok || !result.content) {
        throw new Error(result.error || "Script generation returned no content");
      }

      const reply = result.reply || `Generated narration for ${result.content.scenes.length} scenes. Review and edit any that need polish.`;
      const messages = [
        ...(JSON.parse(row.messages || "[]") as Array<any>).filter((m: any) => m.role !== "assistant"),
        { role: "assistant", content: reply },
      ];

      await db.update(trainingVideos)
        .set({
          scenes: JSON.stringify(result.content),
          messages: JSON.stringify(messages),
          status: "script-generated",
          errorMessage: null,
          errorStage: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, params.id));

      return NextResponse.json({
        videoId: params.id,
        status: "script-generated",
        content: result.content,
        reply,
      });
    } catch (stageErr: any) {
      await db.update(trainingVideos)
        .set({
          status: "error",
          errorStage: "script",
          errorMessage: stageErr?.message || String(stageErr),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, params.id));
      return NextResponse.json({ error: stageErr?.message || "Script generation failed", stage: "script" }, { status: 500 });
    }
  } catch (error: any) {
    console.error("[training-videos/[id]/generate-script POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
