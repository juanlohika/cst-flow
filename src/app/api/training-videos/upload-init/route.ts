import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos, trainingVideoSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, ensureVideoFolder, ensureRawSubfolder, createResumableUploadUrl } from "@/lib/training-video/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/training-videos/upload-init
 * body: { title, fileName, fileSize, userPrompt? }
 *
 * Returns a Drive resumable-upload URL the browser PUTs the MP4 directly
 * to — bypassing Cloud Run's 32MB request cap. Creates the TrainingVideo
 * row in "uploading" state; the upload-finalize endpoint flips it to
 * "generating" and kicks off the rest of the pipeline.
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
    const userPrompt = body?.userPrompt ? String(body.userPrompt).trim() : undefined;

    if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });
    if (!fileSize || fileSize <= 0) return NextResponse.json({ error: "fileSize required" }, { status: 400 });
    if (fileSize > 2 * 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 2GB)" }, { status: 400 });
    }
    const lowerName = fileName.toLowerCase();
    if (!lowerName.endsWith(".mp4") && !lowerName.endsWith(".mov")) {
      return NextResponse.json({ error: "Only MP4 / MOV screen recordings supported" }, { status: 400 });
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

    // Origin must match where the browser PUTs from — req.headers.origin gives
    // us the deployed URL (or http://localhost:3000 in dev). Drive only
    // CORS-enables the upload URL for the exact origin we declare here.
    const origin = req.headers.get("origin") || req.headers.get("Origin") || "";
    if (!origin) {
      return NextResponse.json({ error: "Origin header missing — cannot mint CORS-safe upload URL" }, { status: 400 });
    }

    const { uploadUrl } = await createResumableUploadUrl(ctx, {
      parentFolderId: rawFolderId,
      fileName: safeName,
      mimeType: "video/mp4",
      fileSize,
      uploaderOrigin: origin,
    });

    const videoId = `tv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(trainingVideos).values({
      id: videoId,
      title,
      sourceType: "screen_recording",
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
      uploadUrl,
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
