/**
 * Drive client for the worker. The service-account JSON is sent in the
 * render job payload — that way the worker doesn't need its own credentials
 * and CST OS stays the single source of auth.
 */
import { google } from "googleapis";
import { Readable } from "node:stream";

const MP4_MIME = "video/mp4";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";

export interface DriveCtx {
  drive: any;
}

export function buildDriveCtx(serviceAccountJson: string): DriveCtx {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });
  return { drive };
}

export async function downloadFile(ctx: DriveCtx, fileId: string): Promise<Buffer> {
  const res = await ctx.drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function uploadMp4(ctx: DriveCtx, args: {
  folderId: string;
  name: string;
  filePath: string;
}): Promise<{ fileId: string; webViewLink: string }> {
  const fs = await import("node:fs");
  const created = await ctx.drive.files.create({
    requestBody: {
      name: args.name,
      mimeType: MP4_MIME,
      parents: [args.folderId],
    },
    media: {
      mimeType: MP4_MIME,
      body: fs.createReadStream(args.filePath),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = created.data.id;
  if (!fileId) throw new Error("Drive didn't return an id for the uploaded MP4");
  return {
    fileId,
    webViewLink: created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}

/**
 * Convert a PPTX into a PDF via LibreOffice. The worker has libreoffice
 * installed, so we shell out to soffice --headless --convert-to pdf.
 * Returns the path to the produced PDF.
 */
export async function convertPptxToPdf(args: {
  pptxPath: string;
  outDir: string;
}): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const path = await import("node:path");
  const exec = promisify(execFile);

  // LibreOffice's HOME must be writable — set it to a temp path inside the
  // container so the headless instance doesn't blow up on read-only /home.
  const env = { ...process.env, HOME: args.outDir };
  await exec("soffice", [
    "--headless",
    "--convert-to", "pdf",
    "--outdir", args.outDir,
    args.pptxPath,
  ], { env, timeout: 120_000 });

  const base = path.basename(args.pptxPath, path.extname(args.pptxPath));
  return path.join(args.outDir, `${base}.pdf`);
}

/**
 * Rasterize a PDF to one PNG per page via pdftoppm (poppler-utils).
 * Returns the paths of the generated PNGs in page order.
 */
export async function rasterizePdfToPngs(args: {
  pdfPath: string;
  outDir: string;
  dpi: number;
}): Promise<string[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const exec = promisify(execFile);

  const prefix = path.join(args.outDir, "slide");
  await exec("pdftoppm", [
    "-png",
    "-r", String(args.dpi),
    args.pdfPath,
    prefix,
  ], { timeout: 180_000 });

  const files = (await fs.readdir(args.outDir))
    .filter(f => f.startsWith("slide-") && f.endsWith(".png"))
    .sort()
    .map(f => path.join(args.outDir, f));
  return files;
}
