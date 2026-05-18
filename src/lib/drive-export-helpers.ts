/**
 * Shared Drive export helpers — extracted from src/lib/arima/drive-export.ts
 * so both the BRD export AND the Executive Summary export can use the same
 * Word + PDF + Drive-upload pipeline.
 *
 * What's exposed:
 *   - loadGoogleConfig()    : reads service-account JSON + Drive folder ID
 *   - getDriveClient()      : authed `drive.v3` client from the service account
 *   - generateDocxBuffer()  : HTML → .docx (via html-to-docx)
 *   - generatePdfViaDrive() : .docx → temp Google Doc → exported PDF bytes
 *   - uploadOrUpdateFile()  : upsert a file by existing ID, returns webViewLink
 *
 * Why a separate module: BRD export is request-scoped (binds to ArimaRequest
 * rows). Executive summary is portfolio-scoped (no DB row to bind to). They
 * share the rendering / upload mechanics but nothing else.
 */
import { Readable } from "stream";
import { db } from "@/db";

interface GoogleConfig {
  serviceAccountJson: string;
  driveFolderId: string;
}

export async function loadGoogleConfig(): Promise<GoogleConfig | null> {
  try {
    const { globalSettings } = await import("@/db/schema");
    const rows = await db.select().from(globalSettings);
    const map = new Map(rows.map((r: any) => [r.key, r.value]));
    const serviceAccountJson = map.get("GOOGLE_SERVICE_ACCOUNT_JSON") || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    const driveFolderId = map.get("GOOGLE_DRIVE_BRD_FOLDER_ID") || process.env.GOOGLE_DRIVE_BRD_FOLDER_ID || "";
    if (!serviceAccountJson || !driveFolderId) return null;
    return { serviceAccountJson, driveFolderId };
  } catch {
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    const driveFolderId = process.env.GOOGLE_DRIVE_BRD_FOLDER_ID || "";
    if (!serviceAccountJson || !driveFolderId) return null;
    return { serviceAccountJson, driveFolderId };
  }
}

export async function getDriveClient(cfg: GoogleConfig): Promise<{ drive: any; credentials: any }> {
  let credentials: any;
  try {
    credentials = JSON.parse(cfg.serviceAccountJson);
  } catch (e: any) {
    throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e?.message}`);
  }
  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  await auth.authorize();
  const drive = google.drive({ version: "v3", auth });
  return { drive, credentials };
}

export async function verifyDriveFolderAccess(drive: any, folderId: string, serviceAccountEmail: string): Promise<void> {
  try {
    await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
  } catch (folderErr: any) {
    const code = folderErr?.code || folderErr?.status;
    if (code === 404) {
      throw new Error(
        `Service account can't see the configured Drive folder (${folderId}). ` +
        `Open the folder in Google Drive → Share → add the service account email (${serviceAccountEmail}) as Editor.`
      );
    }
    if (code === 403) {
      throw new Error(
        `Service account doesn't have Editor permission on the configured Drive folder. ` +
        `Open the folder → Share → change role to Editor.`
      );
    }
    throw folderErr;
  }
}

export async function generateDocxBuffer(html: string, title: string): Promise<Buffer> {
  const HTMLtoDOCX = (await import("html-to-docx")).default as any;
  const result = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
    font: "Arial",
    title,
  });
  if (Buffer.isBuffer(result)) return result;
  if (result && typeof (result as any).arrayBuffer === "function") {
    const ab = await (result as any).arrayBuffer();
    return Buffer.from(ab);
  }
  return Buffer.from(result as any);
}

export async function generatePdfViaDrive(
  drive: any,
  args: { docxBuffer: Buffer; folderId: string; title: string }
): Promise<Buffer> {
  const tempDoc = await drive.files.create({
    requestBody: {
      name: args.title,
      mimeType: "application/vnd.google-apps.document",
      parents: [args.folderId],
    },
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: Readable.from(args.docxBuffer),
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const tempDocId = tempDoc.data.id;
  if (!tempDocId) throw new Error("Drive didn't return an id for the temp Doc copy");
  try {
    const resp = await drive.files.export(
      { fileId: tempDocId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" }
    );
    const data = resp.data;
    if (!data) throw new Error("Drive PDF export returned empty body");
    return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  } finally {
    try {
      await drive.files.delete({ fileId: tempDocId, supportsAllDrives: true });
    } catch (cleanupErr: any) {
      console.warn("[drive-export-helpers] failed to delete temp Doc:", cleanupErr?.message);
    }
  }
}

export async function uploadOrUpdateFile(
  drive: any,
  args: {
    existingFileId: string | null;
    folderId: string;
    name: string;
    buffer: Buffer;
    mimeType: string;
  }
): Promise<{ id: string; webViewLink: string }> {
  if (args.existingFileId) {
    try {
      const updated = await drive.files.update({
        fileId: args.existingFileId,
        requestBody: { name: args.name },
        media: {
          mimeType: args.mimeType,
          body: Readable.from(args.buffer),
        },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      return {
        id: updated.data.id || args.existingFileId,
        webViewLink: updated.data.webViewLink || `https://drive.google.com/file/d/${updated.data.id || args.existingFileId}/view`,
      };
    } catch (e: any) {
      if (e?.code !== 404 && e?.status !== 404) throw e;
    }
  }
  const created = await drive.files.create({
    requestBody: {
      name: args.name,
      mimeType: args.mimeType,
      parents: [args.folderId],
    },
    media: {
      mimeType: args.mimeType,
      body: Readable.from(args.buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return {
    id: created.data.id || "",
    webViewLink: created.data.webViewLink || `https://drive.google.com/file/d/${created.data.id}/view`,
  };
}
