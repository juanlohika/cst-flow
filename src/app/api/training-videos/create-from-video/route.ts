import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos, trainingVideoSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, ensureVideoFolder, uploadSceneAudio } from "@/lib/training-video/drive";
import { buildScriptFromVideoFrames } from "@/lib/training-video/build-script";
import { synthesizeScenes } from "@/lib/training-video/tts";
import { callExtractFrames } from "@/lib/training-video/worker-client";
import type { TrainingVideoContent } from "@/lib/training-video/types";
import { Readable } from "stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

const MP4_MIME = "video/mp4";

/**
 * POST /api/training-videos/create-from-video
 * multipart/form-data:
 *   file: MP4 screen recording
 *   title, userPrompt, voice — same as create (for PPTX)
 *
 * Pipeline:
 *   1. Upload MP4 to Drive: <trainingRoot>/<date — title>/raw/
 *   2. Call worker /extract-frames → get keyframes + duration
 *   3. Run Gemini Vision to segment scenes + write narration
 *   4. Per-scene TTS, upload audio
 *   5. Persist row; user can now hit "Render MP4" to assemble
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    const userId = session.user.id;

    const form = await req.formData();
    const file = form.get("file");
    const title = String(form.get("title") || "").trim() || "Untitled Training Video";
    const userPrompt = String(form.get("userPrompt") || "").trim() || undefined;
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "MP4 file required" }, { status: 400 });
    }
    if (file.size > 500 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 500MB)" }, { status: 400 });
    }
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".mp4") && !lowerName.endsWith(".mov") && file.type !== MP4_MIME) {
      return NextResponse.json({ error: "Only MP4 / MOV screen recordings supported" }, { status: 400 });
    }

    const settingsRows = await db.select().from(trainingVideoSettings).where(eq(trainingVideoSettings.id, "default")).limit(1);
    const settings = settingsRows[0];
    if (!settings) {
      return NextResponse.json({ error: "Training Videos not configured. Ask an admin to set the Drive root folder in /training-videos/settings." }, { status: 400 });
    }
    const voice = String(form.get("voice") || "").trim() || settings.defaultVoice;
    const ttsModel = String(form.get("ttsModel") || "").trim() || settings.defaultTtsModel;
    const language = String(form.get("language") || "").trim() || settings.defaultLanguage;
    const aspectRatio = String(form.get("aspectRatio") || "").trim() || settings.defaultAspectRatio;

    const ctx = await loadDriveCtx();
    const folder = await ensureVideoFolder(ctx, {
      trainingRootFolderId: settings.trainingRootFolderId,
      title,
    });

    // Upload the MP4 to Drive's raw/ subfolder
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileNameSafe = file.name.replace(/[^\w.\- ]+/g, "_");
    const rawFolderId = await ensureSubfolderViaDrive(ctx, folder.folderId, "raw");
    const uploaded = await ctx.drive.files.create({
      requestBody: { name: fileNameSafe, mimeType: MP4_MIME, parents: [rawFolderId] },
      media: { mimeType: MP4_MIME, body: Readable.from(buffer) },
      fields: "id, name",
      supportsAllDrives: true,
    });
    if (!uploaded?.data?.id) {
      return NextResponse.json({ error: "Drive didn't return an id for the uploaded MP4" }, { status: 500 });
    }
    const sourceDriveFileId = uploaded.data.id;
    const sourceDriveFileName = uploaded.data.name || fileNameSafe;

    // Create the row in generating state
    const videoId = `tv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(trainingVideos).values({
      id: videoId,
      title,
      sourceType: "screen_recording",
      sourceDriveFileId,
      sourceDriveFileName,
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

    // 1. Extract keyframes via the worker
    const framesResult = await callExtractFrames({
      sourceVideoDriveFileId: sourceDriveFileId,
      intervalSec: 2,
    });
    if (!framesResult.ok || !framesResult.frames || !framesResult.durationSec) {
      await db.update(trainingVideos)
        .set({ status: "error", errorMessage: framesResult.error || "Frame extraction failed", updatedAt: new Date().toISOString() })
        .where(eq(trainingVideos.id, videoId));
      return NextResponse.json({ error: framesResult.error, videoId }, { status: 500 });
    }

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
        .set({ status: "error", errorMessage: scriptResult.error || "Script generation failed", updatedAt: new Date().toISOString() })
        .where(eq(trainingVideos.id, videoId));
      return NextResponse.json({ error: scriptResult.error, videoId, rawAi: (scriptResult as any).rawAi }, { status: 500 });
    }

    // 3. Per-scene TTS — paced + 429-retried by synthesizeScenes()
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

    const reply = scriptResult.reply || `Segmented the recording into ${content.scenes.length} scenes and generated voiceover. Review and edit any scenes that need polish, then click Render MP4.`;
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
    console.error("[training-videos/create-from-video POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

// Drive doesn't export ensureSubfolder as a public helper from training-video/drive.ts,
// so we inline a minimal variant here. (Refactoring drive.ts to expose it would be cleaner;
// keeping it local for now to keep this commit focused.)
async function ensureSubfolderViaDrive(ctx: any, parentId: string, name: string): Promise<string> {
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const q = [
    `'${parentId}' in parents`,
    `name='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
    `trashed=false`,
  ].join(" and ");
  const list = await ctx.drive.files.list({
    q, fields: "files(id, name)",
    supportsAllDrives: true, includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  const existing = list?.data?.files?.[0];
  if (existing?.id) return existing.id;
  const created = await ctx.drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created?.data?.id) throw new Error(`Failed to create subfolder ${name}`);
  return created.data.id;
}
