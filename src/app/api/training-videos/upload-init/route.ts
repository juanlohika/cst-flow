import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos, trainingVideoSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, ensureVideoFolder, ensureRawSubfolder, mintBrowserUploadToken } from "@/lib/training-video/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MP4_MIME = "video/mp4";

/**
 * POST /api/training-videos/upload-init
 * body: { title, fileName, fileSize, sourceType: "pptx" | "screen_recording", userPrompt? }
 *
 * Returns a short-lived Drive access token the browser uses to upload the
 * file directly to Drive (bypassing Cloud Run's 32MB request cap). Creates
 * the TrainingVideo row in "uploading" state.
 *
 * After the browser finishes the Drive upload, it calls
 * /upload-finalize-source to record the driveFileId and flip status to
 * "source-uploaded". The pipeline then runs as separate stages:
 *   extract-source → generate-script → generate-scene-audio (per scene).
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    const userId = session.user.id;

    const body = await req.json().catch(() => ({}));
    const title = String(body?.title || "").trim() || "Untitled Training Video";
    const fileName = String(body?.fileName || "").trim();
    const fileSize = Number(body?.fileSize || 0);
    const sourceType = String(body?.sourceType || "").trim();
    const userPrompt = body?.userPrompt ? String(body.userPrompt).trim() : undefined;

    if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });
    if (!fileSize || fileSize <= 0) return NextResponse.json({ error: "fileSize required" }, { status: 400 });
    if (fileSize > 2 * 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 2GB)" }, { status: 400 });
    }

    const lowerName = fileName.toLowerCase();
    let mimeType: string;
    if (sourceType === "pptx") {
      if (!lowerName.endsWith(".pptx")) return NextResponse.json({ error: "PPTX mode expects a .pptx file" }, { status: 400 });
      mimeType = PPTX_MIME;
    } else if (sourceType === "screen_recording") {
      if (!lowerName.endsWith(".mp4") && !lowerName.endsWith(".mov")) {
        return NextResponse.json({ error: "Screen recording mode expects .mp4 or .mov" }, { status: 400 });
      }
      mimeType = MP4_MIME;
    } else {
      return NextResponse.json({ error: "sourceType must be 'pptx' or 'screen_recording'" }, { status: 400 });
    }

    const settingsRows = await db.select().from(trainingVideoSettings).where(eq(trainingVideoSettings.id, "default")).limit(1);
    const settings = settingsRows[0];
    if (!settings) {
      return NextResponse.json({ error: "Training Videos not configured. Ask an admin to set the Drive root folder in /training-videos/settings." }, { status: 400 });
    }
    const voice = String(body?.voice || "").trim() || settings.defaultVoice;
    const ttsModel = String(body?.ttsModel || "").trim() || settings.defaultTtsModel;
    const language = String(body?.language || "").trim() || settings.defaultLanguage;
    const aspectRatio = String(body?.aspectRatio || "").trim() || settings.defaultAspectRatio;

    const ctx = await loadDriveCtx();
    const folder = await ensureVideoFolder(ctx, {
      trainingRootFolderId: settings.trainingRootFolderId,
      title,
    });
    const rawFolderId = await ensureRawSubfolder(ctx, folder.folderId);
    const safeName = fileName.replace(/[^\w.\- ]+/g, "_");

    // The browser will call Drive's multipart upload endpoint directly using
    // this short-lived access token. The endpoint supports CORS when called
    // with an Authorization header — Drive's own JS SDK uses this same path.
    const { accessToken, expiresAt } = await mintBrowserUploadToken(ctx);

    const videoId = `tv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(trainingVideos).values({
      id: videoId,
      title,
      sourceType,
      sourceDriveFileName: safeName,
      videoFolderId: folder.folderId,
      voice,
      ttsModel,
      language,
      aspectRatio,
      userPrompt,
      messages: JSON.stringify([
        { role: "user", content: `Uploading ${fileName}${userPrompt ? ` — prompt: ${userPrompt}` : ""}`, attachmentNames: [fileName] },
      ]),
      status: "uploading",
      generatedBy: userId,
    });

    return NextResponse.json({
      videoId,
      accessToken,
      expiresAt,
      parentFolderId: rawFolderId,
      mimeType,
      // Echo back what we picked so the UI can show it
      title,
      fileName: safeName,
      videoFolderId: folder.folderId,
    });
  } catch (error: any) {
    console.error("[training-videos/upload-init POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
