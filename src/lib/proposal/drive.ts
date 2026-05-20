/**
 * Phase F.1 — Drive helpers for Proposal Maker.
 *
 * Reuses the existing service-account auth (shared with BRD export + Sheet
 * sync). Adds proposal-specific operations: fetch the template by file id,
 * extract a Drive file id from any URL form, ensure per-account folders.
 */
import { Readable } from "stream";
import { loadGoogleConfig, getDriveClient } from "@/lib/drive-export-helpers";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveCtx {
  drive: any;
  serviceAccountEmail: string;
}

export async function loadDriveCtx(): Promise<DriveCtx> {
  const cfg = await loadGoogleConfig();
  if (!cfg) {
    throw new Error("Google service account isn't configured yet. Set it in Admin → Auth → Google Integration first.");
  }
  const { drive, credentials } = await getDriveClient(cfg);
  return { drive, serviceAccountEmail: credentials.client_email || "(unknown)" };
}

/**
 * Extract a Drive file or folder id from any of the URL shapes Google uses.
 * Returns null if no id found.
 */
export function parseDriveId(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  // Patterns:
  //   https://docs.google.com/document/d/<ID>/edit
  //   https://drive.google.com/file/d/<ID>/view
  //   https://drive.google.com/drive/folders/<ID>
  //   https://drive.google.com/open?id=<ID>
  //   just the bare id
  const patterns: RegExp[] = [
    /\/document\/d\/([a-zA-Z0-9_-]{20,})/,
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /\/folders\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m && m[1]) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

/**
 * Fetch a Drive file's metadata + the .docx bytes. Throws with a clear
 * message if the service account can't see the file.
 */
export async function fetchTemplateDocx(ctx: DriveCtx, fileId: string): Promise<{
  buffer: Buffer;
  name: string;
  mimeType: string;
  parents: string[];
}> {
  // 1. Metadata first — gives us a clear failure if access is missing.
  let meta: any;
  try {
    meta = await ctx.drive.files.get({
      fileId,
      fields: "id, name, mimeType, parents",
      supportsAllDrives: true,
    });
  } catch (e: any) {
    if (e?.code === 404 || e?.status === 404) {
      throw new Error(
        `Drive can't find file ${fileId}. ` +
        `Either the link is wrong, or the file isn't shared with the service account (${ctx.serviceAccountEmail}).`
      );
    }
    throw e;
  }
  const mimeType = meta?.data?.mimeType || "";
  const name = meta?.data?.name || "(unnamed)";
  const parents = meta?.data?.parents || [];

  // 2. Download. If it's already a .docx, get bytes directly. If it's a
  // Google Doc (mime "application/vnd.google-apps.document"), export to .docx.
  let buffer: Buffer;
  if (mimeType === "application/vnd.google-apps.document") {
    const resp = await ctx.drive.files.export(
      { fileId, mimeType: DOCX_MIME },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(resp.data as ArrayBuffer);
  } else if (mimeType === DOCX_MIME || mimeType === "application/octet-stream") {
    const resp = await ctx.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    buffer = Buffer.from(resp.data as ArrayBuffer);
  } else {
    throw new Error(
      `Unsupported template type "${mimeType}". Use a Word .docx or a Google Doc.`
    );
  }

  return { buffer, name, mimeType, parents };
}

/**
 * Ensure there's a per-account sub-folder under the proposals root. Folder
 * name = account companyName (sanitized). Idempotent — searches by name first.
 */
export async function ensureAccountFolder(
  ctx: DriveCtx,
  parentFolderId: string,
  accountName: string,
): Promise<{ folderId: string; folderName: string; created: boolean }> {
  const folderName = sanitizeFolderName(accountName);
  // Search for an existing folder by exact name + parent + non-trashed.
  const q = [
    `mimeType='${FOLDER_MIME}'`,
    `'${parentFolderId}' in parents`,
    `name='${escapeForQuery(folderName)}'`,
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
  if (existing?.id) return { folderId: existing.id, folderName, created: false };

  const created = await ctx.drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME,
      parents: [parentFolderId],
    },
    fields: "id, name",
    supportsAllDrives: true,
  });
  if (!created?.data?.id) throw new Error("Drive didn't return an id for the new account folder.");
  return { folderId: created.data.id, folderName, created: true };
}

/**
 * Upload a generated proposal .docx into the account's folder. Always creates
 * a new file (we never overwrite a previous proposal — Drive's own version
 * history is for in-place edits, not regenerations).
 */
export async function uploadProposalDocx(
  ctx: DriveCtx,
  args: { folderId: string; name: string; buffer: Buffer },
): Promise<{ fileId: string; webViewLink: string }> {
  const created = await ctx.drive.files.create({
    requestBody: {
      name: args.name,
      mimeType: DOCX_MIME,
      parents: [args.folderId],
    },
    media: {
      mimeType: DOCX_MIME,
      body: Readable.from(args.buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = created?.data?.id;
  if (!fileId) throw new Error("Drive didn't return an id for the new proposal file.");
  return {
    fileId,
    webViewLink: created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}

function sanitizeFolderName(s: string): string {
  // Drive folder names can be just about anything, but slashes confuse the UI.
  return (s || "").replace(/[\/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Unnamed Account";
}

function escapeForQuery(s: string): string {
  // Google Drive query strings need single-quote escaping inside name='...'.
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
