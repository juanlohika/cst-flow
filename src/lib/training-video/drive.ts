/**
 * Phase G.1 — Drive helpers for Training Video Generator.
 *
 * Reuses the service-account auth shared with BRD, Account Health, Proposal Maker.
 * Adds training-video-specific operations: ensure per-video subfolder, upload
 * source PPTX, upload per-scene mp3 audio.
 *
 * Folder structure:
 *   <trainingRoot>/<videoFolderName>/
 *     ├── raw/<sourceFile>
 *     └── audio/scene_<n>.mp3
 *
 * videoFolderName = "<YYYY-MM-DD> — <title>" (sanitized)
 */
import { Readable } from "stream";
import { loadGoogleConfig, getDriveClient } from "@/lib/drive-export-helpers";
import { JWT } from "google-auth-library";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MP3_MIME = "audio/mpeg";

export interface DriveCtx {
  drive: any;
  serviceAccountEmail: string;
  // Raw credentials so callsites that need an access token (e.g. for the
  // resumable-upload session init) can mint one without reaching into
  // private internals of the googleapis client.
  credentials: any;
}

export async function loadDriveCtx(): Promise<DriveCtx> {
  const cfg = await loadGoogleConfig();
  if (!cfg) {
    throw new Error("Google service account isn't configured. Set it in Admin → Auth → Google Integration first.");
  }
  const { drive, credentials } = await getDriveClient(cfg);
  return { drive, serviceAccountEmail: credentials.client_email || "(unknown)", credentials };
}

/** Same URL-id parser as the proposal module. Handles every Drive URL shape. */
export function parseDriveId(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  const patterns: RegExp[] = [
    /\/document\/d\/([a-zA-Z0-9_-]{20,})/,
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /\/folders\/([a-zA-Z0-9_-]{20,})/,
    /\/presentation\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m && m[1]) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

/** Verify the service account can see a folder. Throws with a clear message if not. */
export async function verifyFolderAccess(ctx: DriveCtx, folderId: string): Promise<void> {
  try {
    await ctx.drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
  } catch (e: any) {
    if (e?.code === 404 || e?.status === 404) {
      throw new Error(
        `Service account can't see folder ${folderId}. ` +
        `Share it with ${ctx.serviceAccountEmail} as Editor.`
      );
    }
    throw e;
  }
}

/**
 * Create (or find) the per-video subfolder. Name = "<YYYY-MM-DD> — <title>".
 * Idempotent — searches by name first.
 */
export async function ensureVideoFolder(ctx: DriveCtx, args: {
  trainingRootFolderId: string;
  title: string;
}): Promise<{ folderId: string; folderName: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const safeTitle = sanitizeName(args.title);
  const folderName = `${today} — ${safeTitle}`;

  // Search for existing folder by name + parent
  const q = [
    `mimeType='${FOLDER_MIME}'`,
    `'${args.trainingRootFolderId}' in parents`,
    `name='${escapeQuery(folderName)}'`,
    `trashed=false`,
  ].join(" and ");
  const list = await ctx.drive.files.list({
    q,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  const existing = list?.data?.files?.[0];
  if (existing?.id) return { folderId: existing.id, folderName };

  const created = await ctx.drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME,
      parents: [args.trainingRootFolderId],
    },
    fields: "id, name",
    supportsAllDrives: true,
  });
  if (!created?.data?.id) throw new Error("Drive didn't return an id for the new video folder.");
  return { folderId: created.data.id, folderName };
}

/** Upload the source PPTX into <videoFolder>/raw/ (auto-creates raw subfolder). */
export async function uploadSourcePptx(ctx: DriveCtx, args: {
  videoFolderId: string;
  fileName: string;
  buffer: Buffer;
}): Promise<{ fileId: string; fileName: string }> {
  const rawFolderId = await ensureSubfolder(ctx, args.videoFolderId, "raw");
  const created = await ctx.drive.files.create({
    requestBody: {
      name: args.fileName,
      mimeType: PPTX_MIME,
      parents: [rawFolderId],
    },
    media: {
      mimeType: PPTX_MIME,
      body: Readable.from(args.buffer),
    },
    fields: "id, name",
    supportsAllDrives: true,
  });
  const fileId = created?.data?.id;
  if (!fileId) throw new Error("Drive didn't return an id for the uploaded PPTX.");
  return { fileId, fileName: created.data.name || args.fileName };
}

/** Upload one scene's mp3 into <videoFolder>/audio/scene_<n>.mp3 */
export async function uploadSceneAudio(ctx: DriveCtx, args: {
  videoFolderId: string;
  sceneOrder: number;
  buffer: Buffer;
}): Promise<{ fileId: string; webViewLink: string }> {
  const audioFolderId = await ensureSubfolder(ctx, args.videoFolderId, "audio");
  const fileName = `scene_${String(args.sceneOrder).padStart(2, "0")}.mp3`;

  // Overwrite if it already exists (re-generating one scene)
  const existing = await findChildByName(ctx, audioFolderId, fileName);
  if (existing) {
    const updated = await ctx.drive.files.update({
      fileId: existing,
      media: { mimeType: MP3_MIME, body: Readable.from(args.buffer) },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    return {
      fileId: updated.data.id!,
      webViewLink: updated.data.webViewLink || `https://drive.google.com/file/d/${updated.data.id}/view`,
    };
  }

  const created = await ctx.drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: MP3_MIME,
      parents: [audioFolderId],
    },
    media: {
      mimeType: MP3_MIME,
      body: Readable.from(args.buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = created?.data?.id;
  if (!fileId) throw new Error("Drive didn't return an id for the audio file.");
  return {
    fileId,
    webViewLink: created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}

/**
 * Mint a resumable-upload URL for a Drive file. The browser then PUTs the
 * file bytes directly to that URL — bypassing Cloud Run's 32MB request cap.
 * The URL embeds an upload session id and stays valid for ~7 days.
 *
 * Drive's resumable protocol:
 *   1. We POST metadata (name, mimeType, parents) to /upload/drive/v3/files?uploadType=resumable
 *   2. Drive responds with a `Location` header — the URL to PUT bytes to
 *   3. Browser PUTs bytes (chunked or whole), Drive returns 200 with the file id
 */
export async function createResumableUploadUrl(ctx: DriveCtx, args: {
  parentFolderId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  // Browser origin that will PUT the bytes. Drive uses this to set up CORS
  // on the returned session URL. Without it, browser uploads fail with
  // "No 'Access-Control-Allow-Origin' header is present on the requested
  // resource." Pass the request's Origin header.
  uploaderOrigin: string;
}): Promise<{ uploadUrl: string }> {
  const jwt = new JWT({
    email: ctx.credentials.client_email,
    key: ctx.credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const tokenResp = await jwt.getAccessToken();
  const accessToken = tokenResp?.token;
  if (!accessToken) throw new Error("Could not obtain Drive access token for resumable upload.");

  const metadata = {
    name: args.fileName,
    mimeType: args.mimeType,
    parents: [args.parentFolderId],
  };

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": args.mimeType,
      "X-Upload-Content-Length": String(args.fileSize),
      // The Origin header tells Drive to return a CORS-enabled session URL.
      // Without it the upload URL rejects browser PUTs with a CORS error.
      "Origin": args.uploaderOrigin,
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive resumable init failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
  }
  const uploadUrl = res.headers.get("Location") || res.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Drive didn't return a Location header for the resumable upload session.");
  }
  return { uploadUrl };
}

/**
 * Ensure the raw/ subfolder exists under a video folder. Exposed publicly
 * (not just internal) because the upload-init flow needs to mint a resumable
 * URL targeting raw/ directly.
 */
export async function ensureRawSubfolder(ctx: DriveCtx, videoFolderId: string): Promise<string> {
  return ensureSubfolder(ctx, videoFolderId, "raw");
}

/** Download a Drive file as bytes (used for PPTX → Gemini). */
export async function downloadFile(ctx: DriveCtx, fileId: string): Promise<Buffer> {
  const resp = await ctx.drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(resp.data as ArrayBuffer);
}

// ─── Internal helpers ─────────────────────────────────────────────

async function ensureSubfolder(ctx: DriveCtx, parentId: string, name: string): Promise<string> {
  const existing = await findChildByName(ctx, parentId, name);
  if (existing) return existing;
  const created = await ctx.drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created?.data?.id) throw new Error(`Failed to create subfolder ${name}`);
  return created.data.id;
}

async function findChildByName(ctx: DriveCtx, parentId: string, name: string): Promise<string | null> {
  const q = [
    `'${parentId}' in parents`,
    `name='${escapeQuery(name)}'`,
    `trashed=false`,
  ].join(" and ");
  const list = await ctx.drive.files.list({
    q,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  return list?.data?.files?.[0]?.id || null;
}

function sanitizeName(s: string): string {
  return (s || "").replace(/[\/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
}

function escapeQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
