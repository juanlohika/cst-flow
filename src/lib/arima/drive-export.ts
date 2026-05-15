/**
 * Phase 22.3 — BRD export to Google Drive as .docx (editable) + .pdf (read-only).
 *
 * v4.1 — PDF via Drive's native conversion. The original v4 used puppeteer-core
 * + @sparticuz/chromium for PDF rendering but that fails on Firebase App Hosting
 * because the Cloud Run base image is missing libnss3 / libatk / libcups etc.
 * Switching to Drive's native Word→Doc→PDF conversion sidesteps Chromium
 * entirely — Google Docs does the rendering, which is also what teams will
 * see when they open the Word file anyway.
 *
 * Flow:
 *   1. Render Markdown → HTML once (with Mermaid SVGs inlined). Reuses the
 *      same renderer as the in-CST-OS BRD viewer so what you see is what
 *      gets exported.
 *   2. From that HTML, generate a .docx using `html-to-docx` (proven path —
 *      same library the existing BRD Maker app uses).
 *   3. Upload the .docx to Drive.
 *   4. Make a temporary Google Doc copy (Drive converts the .docx on upload)
 *      and export that as PDF via drive.files.export. Upload the PDF bytes
 *      as a separate file alongside the .docx, then delete the temp Doc.
 *   5. Both .docx + .pdf live in the configured Drive folder. Word opens in
 *      Google Docs viewer (editable); PDF is the read-only version
 *      Eliana/ARIMA can share with clients.
 *
 * Per-format diagnostics still recorded so failures stay visible in /eliana.
 */
import { db } from "@/db";
import { arimaRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Readable } from "stream";
import { renderBrdMarkdownToHtml } from "./brd-html-renderer";

interface GoogleConfig {
  serviceAccountJson: string;
  driveFolderId: string;
}

async function loadGoogleConfig(): Promise<GoogleConfig | null> {
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

export interface BrdExportResult {
  ok: boolean;
  docxUrl?: string;
  pdfUrl?: string;
  docxFileId?: string;
  pdfFileId?: string;
  error?: string;
}

export async function exportBrdToDrive(args: { requestId: string }): Promise<BrdExportResult> {
  const cfg = await loadGoogleConfig();
  if (!cfg) {
    return { ok: false, error: "Drive export is not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_BRD_FOLDER_ID in admin settings." };
  }

  const rows = await db.select().from(arimaRequests).where(eq(arimaRequests.id, args.requestId)).limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "Request not found" };
  if (!(row as any).brdDocument) return { ok: false, error: "No BRD document to export. Generate the BRD first." };

  let credentials: any;
  try {
    credentials = JSON.parse(cfg.serviceAccountJson);
  } catch (e: any) {
    return { ok: false, error: `Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e?.message}` };
  }

  const startedAt = Date.now();
  const diagnostics: any = { version: "v4-docx-pdf", steps: {} };

  try {
    // ─── Step 1: render Markdown → HTML (with Mermaid SVGs inlined) ─────────
    const markdown = String((row as any).brdDocument || "");
    const renderStartedAt = Date.now();
    const { html, diagnostics: htmlDiag } = await renderBrdMarkdownToHtml(markdown);
    diagnostics.steps.html = {
      ms: Date.now() - renderStartedAt,
      length: html.length,
      mermaidBlocks: htmlDiag.mermaidBlocks,
      mermaidRendered: htmlDiag.mermaidRendered,
      mermaidFailedCount: htmlDiag.mermaidFailed.length,
      mermaidFailures: htmlDiag.mermaidFailed, // [{ index, error }] for debugging
    };

    // ─── Step 2: generate .docx (PDF comes later via Drive's converter) ─────
    const title = row.title.slice(0, 200);
    const safeTitleForFilename = title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 100) || "BRD";

    const docxBuf = await generateDocxBuffer(html, title).catch((e: any) => {
      diagnostics.steps.docx = { error: String(e?.message || e).slice(0, 500) };
      return null;
    });

    if (docxBuf) diagnostics.steps.docx = { ...(diagnostics.steps.docx || {}), bytes: docxBuf.length };

    if (!docxBuf) {
      throw new Error("Word generation failed — see diagnostics. PDF can't be produced without it.");
    }

    // ─── Step 3: Drive auth + folder check ──────────────────────────────────
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

    try {
      await drive.files.get({
        fileId: cfg.driveFolderId,
        fields: "id, name, mimeType",
        supportsAllDrives: true,
      });
    } catch (folderErr: any) {
      const code = folderErr?.code || folderErr?.status;
      if (code === 404) {
        throw new Error(
          `Service account can't see the configured Drive folder (${cfg.driveFolderId}). ` +
          `Open the folder in Google Drive → Share → add the service account email (${credentials.client_email}) as Editor.`
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

    // ─── Step 4: upload both files (replace existing if present) ────────────
    const existingDocxId = (row as any).brdDocxFileId as string | null;
    const existingPdfId = (row as any).brdPdfFileId as string | null;

    let docxFileId = existingDocxId || "";
    let docxUrl = (row as any).brdDocxUrl as string | null || "";
    let pdfFileId = existingPdfId || "";
    let pdfUrl = (row as any).brdPdfUrl as string | null || "";

    // Upload .docx
    {
      const result = await uploadOrUpdateFile(drive, {
        existingFileId: existingDocxId,
        folderId: cfg.driveFolderId,
        name: `${safeTitleForFilename}.docx`,
        buffer: docxBuf,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      docxFileId = result.id;
      docxUrl = result.webViewLink;
      diagnostics.steps.docx.uploaded = true;
    }

    // Generate PDF via Drive's native Word→Doc→PDF conversion.
    // We do this even on re-export so the PDF stays in sync with the latest
    // .docx content. Steps:
    //   a. Upload the same .docx buffer to a temp Google Doc (Drive converts
    //      on the fly via mimeType=application/vnd.google-apps.document).
    //   b. drive.files.export({mimeType: 'application/pdf'}) returns the PDF bytes.
    //   c. Upload those PDF bytes as the final .pdf alongside the .docx.
    //   d. Delete the temp Google Doc — we only kept it for the conversion.
    try {
      const pdfBuf = await generatePdfViaDrive(drive, {
        docxBuffer: docxBuf,
        folderId: cfg.driveFolderId,
        title: `${safeTitleForFilename}__pdfsource_temp`,
      });
      diagnostics.steps.pdf = { bytes: pdfBuf.length, method: "drive-native" };

      const result = await uploadOrUpdateFile(drive, {
        existingFileId: existingPdfId,
        folderId: cfg.driveFolderId,
        name: `${safeTitleForFilename}.pdf`,
        buffer: pdfBuf,
        mimeType: "application/pdf",
      });
      pdfFileId = result.id;
      pdfUrl = result.webViewLink;
      diagnostics.steps.pdf.uploaded = true;
    } catch (e: any) {
      diagnostics.steps.pdf = {
        error: String(e?.message || e).slice(0, 500),
        method: "drive-native",
      };
    }

    diagnostics.totalMs = Date.now() - startedAt;
    diagnostics.timestamp = new Date().toISOString();

    const now = new Date().toISOString();
    await db.update(arimaRequests)
      .set({
        brdDocxFileId: docxFileId || null,
        brdDocxUrl: docxUrl || null,
        brdPdfFileId: pdfFileId || null,
        brdPdfUrl: pdfUrl || null,
        brdGoogleDocSyncedAt: now,
        brdStatus: "exported",
        brdExportLog: JSON.stringify(diagnostics).slice(0, 30_000),
        brdError: null,
        updatedAt: now,
      } as any)
      .where(eq(arimaRequests.id, row.id));

    return {
      ok: true,
      docxFileId: docxFileId || undefined,
      docxUrl: docxUrl || undefined,
      pdfFileId: pdfFileId || undefined,
      pdfUrl: pdfUrl || undefined,
    };
  } catch (e: any) {
    const errMsg = e?.message || "BRD export failed";
    diagnostics.error = errMsg.slice(0, 800);
    diagnostics.timestamp = new Date().toISOString();
    await db.update(arimaRequests)
      .set({
        brdError: `Drive export error: ${errMsg.slice(0, 800)}`,
        brdExportLog: JSON.stringify(diagnostics).slice(0, 30_000),
        updatedAt: new Date().toISOString(),
      } as any)
      .where(eq(arimaRequests.id, row.id));
    return { ok: false, error: errMsg };
  }
}

// ─── .docx generation via html-to-docx ─────────────────────────────────────
async function generateDocxBuffer(html: string, title: string): Promise<Buffer> {
  // Lazy-import — html-to-docx is heavy and bundling-hostile
  const HTMLtoDOCX = (await import("html-to-docx")).default as any;

  // The renderBrdMarkdownToHtml output already includes a styled wrapper.
  // html-to-docx accepts a full HTML document and handles tables natively.
  const result = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
    font: "Arial",
    title,
  });
  // html-to-docx returns Blob in browser and Buffer in node — normalize
  if (Buffer.isBuffer(result)) return result;
  if (result && typeof (result as any).arrayBuffer === "function") {
    const ab = await (result as any).arrayBuffer();
    return Buffer.from(ab);
  }
  return Buffer.from(result as any);
}

// ─── .pdf generation via Drive's native Word→Doc→PDF conversion ────────────
async function generatePdfViaDrive(
  drive: any,
  args: { docxBuffer: Buffer; folderId: string; title: string }
): Promise<Buffer> {
  // Step a: upload the .docx as a temp Google Doc (Drive converts on the fly)
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
    // Step b: export the temp Doc as PDF
    const resp = await drive.files.export(
      { fileId: tempDocId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" }
    );
    // googleapis returns the buffer in resp.data as an ArrayBuffer
    const data = resp.data;
    if (!data) throw new Error("Drive PDF export returned empty body");
    return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  } finally {
    // Step d: delete the temp Doc — we only kept it for the conversion.
    // Wrap in try/catch so a cleanup failure doesn't break the export.
    try {
      await drive.files.delete({ fileId: tempDocId, supportsAllDrives: true });
    } catch (cleanupErr: any) {
      console.warn("[drive-export] failed to delete temp Doc:", cleanupErr?.message);
    }
  }
}

// ─── Drive upload helper ────────────────────────────────────────────────────
async function uploadOrUpdateFile(
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
      // File may have been deleted in Drive — fall through to create a fresh copy.
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
