import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos, trainingVideoSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, ensureVideoFolder, uploadSourcePptx, uploadSceneAudio } from "@/lib/training-video/drive";
import { buildScriptFromPptx } from "@/lib/training-video/build-script";
import { synthesizeScenes } from "@/lib/training-video/tts";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;  // up to 5min — TTS-per-scene can be slow

/**
 * POST /api/training-videos/create
 * multipart/form-data:
 *   file: PPTX file
 *   title: video title (string)
 *   userPrompt: optional steering prompt
 *   voice / ttsModel / language / aspectRatio: optional overrides
 *
 * Flow:
 *   1. Upload PPTX to Drive: <trainingRoot>/<date — title>/raw/
 *   2. Run Gemini to read PPTX and produce scene-by-scene script
 *   3. For each scene: call Gemini TTS, upload audio to <videoFolder>/audio/
 *   4. Persist the TrainingVideo row with scenes + audio refs
 *   5. Return the video id
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    const userId = session.user.id;

    // 1. Parse multipart upload
    const form = await req.formData();
    const file = form.get("file");
    const title = String(form.get("title") || "").trim() || "Untitled Training Video";
    const userPrompt = String(form.get("userPrompt") || "").trim() || undefined;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PPTX file required" }, { status: 400 });
    }
    if (file.size > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 100MB)" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      return NextResponse.json({ error: "Only .pptx files supported in v1" }, { status: 400 });
    }

    // 2. Load settings
    const settingsRows = await db.select().from(trainingVideoSettings).where(eq(trainingVideoSettings.id, "default")).limit(1);
    const settings = settingsRows[0];
    if (!settings) {
      return NextResponse.json({ error: "Training Videos not configured. Ask an admin to set the Drive root folder in /training-videos/settings." }, { status: 400 });
    }

    const voice = String(form.get("voice") || "").trim() || settings.defaultVoice;
    const ttsModel = String(form.get("ttsModel") || "").trim() || settings.defaultTtsModel;
    const language = String(form.get("language") || "").trim() || settings.defaultLanguage;
    const aspectRatio = String(form.get("aspectRatio") || "").trim() || settings.defaultAspectRatio;

    // 3. Upload PPTX to Drive
    const ctx = await loadDriveCtx();
    const folder = await ensureVideoFolder(ctx, {
      trainingRootFolderId: settings.trainingRootFolderId,
      title,
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    const sourceUpload = await uploadSourcePptx(ctx, {
      videoFolderId: folder.folderId,
      fileName: file.name,
      buffer,
    });

    // 4. Create the row in `generating` state so the UI can poll
    const videoId = `tv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(trainingVideos).values({
      id: videoId,
      title,
      sourceType: "pptx",
      sourceDriveFileId: sourceUpload.fileId,
      sourceDriveFileName: sourceUpload.fileName,
      videoFolderId: folder.folderId,
      voice,
      ttsModel,
      language,
      aspectRatio,
      userPrompt,
      messages: JSON.stringify([
        { role: "user", content: `Uploaded ${file.name}${userPrompt ? ` — prompt: ${userPrompt}` : ""}`, attachmentNames: [file.name] },
      ]),
      status: "generating",
      generatedBy: userId,
    });

    // 5. Generate the script via Gemini
    const scriptResult = await buildScriptFromPptx({
      pptxBuffer: buffer,
      title,
      userPrompt,
      language,
    });

    if (!scriptResult.ok || !scriptResult.content) {
      await db.update(trainingVideos)
        .set({
          status: "error",
          errorMessage: scriptResult.error || "Script generation failed",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(trainingVideos.id, videoId));
      return NextResponse.json({ error: scriptResult.error, videoId, rawAi: (scriptResult as any).rawAi }, { status: 500 });
    }

    // 6. Per-scene TTS — paced + 429-retried by synthesizeScenes()
    const content: TrainingVideoContent = scriptResult.content;
    const ttsResults = await synthesizeScenes({
      scenes: content.scenes.map(s => ({ order: s.order, narrationScript: s.narrationScript })),
      voice,
      model: ttsModel,
      stylePrompt: "Read in a lively, clear, and informative tone, like a friendly product trainer guiding a new user",
      language,
      onProgress: async (done, total, current) => {
        await db.update(trainingVideos)
          .set({ ttsProgress: JSON.stringify({ done, total, current }), updatedAt: new Date().toISOString() })
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
        videoFolderId: folder.folderId,
        sceneOrder: scene.order,
        buffer: r.audio,
      });
      scene.audioDriveFileId = upload.fileId;
      scene.audioDriveUrl = upload.webViewLink;
      scene.audioDurationSec = r.durationSec || null;
      scene.durationSec = (r.durationSec || 0) + 0.6;
    }

    // 7. Persist with the chat reply included
    const reply = scriptResult.reply || "Generated narration scripts for all slides. Review the scenes on the right and edit any that need polish.";
    const messages = [
      { role: "user", content: `Uploaded ${file.name}${userPrompt ? ` — prompt: ${userPrompt}` : ""}`, attachmentNames: [file.name] },
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
      videoFolderUrl: `https://drive.google.com/drive/folders/${folder.folderId}`,
    });
  } catch (error: any) {
    console.error("[training-videos/create POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
