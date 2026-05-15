/**
 * Phase 22.3 — BRD export to Google Drive as .docx (editable) + .pdf (read-only).
 *
 * Replaces the Google-Docs HTML upload approach (v3) which couldn't get tables
 * and Mermaid to render correctly through Drive's importer. Now:
 *
 *   1. Render Markdown → HTML once (with Mermaid SVGs inlined). Reuses the
 *      same renderer as the in-CST-OS BRD viewer so what you see is what
 *      gets exported.
 *   2. From that HTML, generate a .docx using `html-to-docx` (proven path —
 *      this is the same library the existing BRD Maker app uses, and its
 *      table rendering works).
 *   3. From the same HTML, render a .pdf using puppeteer-core + Chromium
 *      (real headless browser → tables + Mermaid SVG render identically to
 *      the BRD viewer).
 *   4. Upload BOTH files to the configured Drive folder. Word file opens in
 *      Google Docs viewer (editable on click); PDF is the read-only version
 *      Eliana/ARIMA can share with clients.
 *
 * If either generator fails, the other still uploads — we record per-format
 * diagnostics so failures are visible in the /eliana modal.
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
      mermaidFailed: htmlDiag.mermaidFailed.length,
    };

    // ─── Step 2: generate .docx + .pdf in parallel ──────────────────────────
    const title = row.title.slice(0, 200);
    const safeTitleForFilename = title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 100) || "BRD";

    const [docxBuf, pdfBuf] = await Promise.all([
      generateDocxBuffer(html, title).catch((e: any) => {
        diagnostics.steps.docx = { error: String(e?.message || e).slice(0, 500) };
        return null;
      }),
      generatePdfBuffer(html).catch((e: any) => {
        diagnostics.steps.pdf = { error: String(e?.message || e).slice(0, 500) };
        return null;
      }),
    ]);

    if (docxBuf) diagnostics.steps.docx = { ...(diagnostics.steps.docx || {}), bytes: docxBuf.length };
    if (pdfBuf) diagnostics.steps.pdf = { ...(diagnostics.steps.pdf || {}), bytes: pdfBuf.length };

    if (!docxBuf && !pdfBuf) {
      throw new Error("Both Word and PDF generation failed — see diagnostics for details.");
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

    if (docxBuf) {
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

    if (pdfBuf) {
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

// ─── .pdf generation via puppeteer-core + chromium ─────────────────────────
async function generatePdfBuffer(html: string): Promise<Buffer> {
  // Lazy imports — only loaded when an export actually runs
  const chromiumMod: any = await import("@sparticuz/chromium");
  const chromium = chromiumMod.default || chromiumMod;
  const puppeteer: any = await import("puppeteer-core");

  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless ?? true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
    const pdfBuf = await page.pdf({
      format: "A4",
      margin: { top: "20mm", right: "18mm", bottom: "20mm", left: "18mm" },
      printBackground: true,
      preferCSSPageSize: false,
    });
    return Buffer.isBuffer(pdfBuf) ? pdfBuf : Buffer.from(pdfBuf);
  } finally {
    await browser.close().catch(() => {});
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
