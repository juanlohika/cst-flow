/**
 * Phase 22.2 — Google Docs export (v3: HTML upload to Drive).
 *
 * The previous approach used the Docs API call-by-call (insertTable,
 * insertInlineImage, batchUpdate). That fought Google's API design and
 * produced broken output for tables and Mermaid.
 *
 * This v3 approach uses Drive's import endpoint:
 *   1. Render Markdown → HTML server-side (with Mermaid PNGs inlined)
 *   2. Upload the HTML to Drive with mimeType: 'application/vnd.google-apps.document'
 *   3. Drive's importer automatically converts the HTML into a real Google
 *      Doc with proper tables, headings, lists, embedded images.
 *
 * One Drive API call instead of dozens of Docs API calls. Reliable.
 *
 * For re-export (when brdGoogleDocId already exists), we use
 *   drive.files.update with the new HTML body — same mechanism.
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

export async function exportBrdToGoogleDocs(args: { requestId: string }): Promise<{
  ok: boolean;
  docId?: string;
  docUrl?: string;
  error?: string;
}> {
  const cfg = await loadGoogleConfig();
  if (!cfg) {
    return { ok: false, error: "Google Docs export is not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_BRD_FOLDER_ID in admin settings." };
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

  const renderStartedAt = Date.now();

  try {
    // Step 1: render Markdown → HTML (with Mermaid PNGs inlined)
    const markdown = String((row as any).brdDocument || "");
    const { html, diagnostics } = await renderBrdMarkdownToHtml(markdown);
    const renderMs = Date.now() - renderStartedAt;

    // Step 2: auth
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

    const title = row.title.slice(0, 200);
    const existingDocId = (row as any).brdGoogleDocId as string | null;
    let docId = existingDocId || "";
    let docUrl = (row as any).brdGoogleDocUrl as string | null || "";

    const htmlBuffer = Buffer.from(html, "utf-8");

    if (!docId) {
      // Verify folder access (same diagnostic as before)
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

      // Create the doc by uploading HTML → Drive converts it.
      const created = await drive.files.create({
        requestBody: {
          name: title,
          mimeType: "application/vnd.google-apps.document", // force convert to Google Doc
          parents: [cfg.driveFolderId],
        },
        media: {
          mimeType: "text/html",
          body: Readable.from(htmlBuffer),
        },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      docId = created.data.id || "";
      docUrl = created.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;
      if (!docId) throw new Error("Google didn't return a doc id");
    } else {
      // Update existing doc: re-upload the HTML. Drive will replace the content.
      // We use files.update with media — Drive's import re-converts on update.
      const updated = await drive.files.update({
        fileId: docId,
        requestBody: { name: title },
        media: {
          mimeType: "text/html",
          body: Readable.from(htmlBuffer),
        },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      docUrl = updated.data.webViewLink || docUrl || `https://docs.google.com/document/d/${docId}/edit`;
    }

    const finalUrl = docUrl || `https://docs.google.com/document/d/${docId}/edit`;
    const now = new Date().toISOString();

    const summary = {
      version: "v3-html-upload",
      docId,
      markdownLength: markdown.length,
      htmlLength: html.length,
      renderMs,
      mermaidBlocks: diagnostics.mermaidBlocks,
      mermaidRendered: diagnostics.mermaidRendered,
      mermaidFailed: diagnostics.mermaidFailed,
      timestamp: now,
    };

    await db.update(arimaRequests)
      .set({
        brdGoogleDocId: docId,
        brdGoogleDocUrl: finalUrl,
        brdGoogleDocSyncedAt: now,
        brdStatus: "exported",
        brdExportLog: JSON.stringify(summary).slice(0, 30_000),
        brdError: null,
        updatedAt: now,
      } as any)
      .where(eq(arimaRequests.id, row.id));

    return { ok: true, docId, docUrl: finalUrl };
  } catch (e: any) {
    const errMsg = e?.message || "Google Docs export failed";
    const debugSummary = {
      version: "v3-html-upload",
      failedAt: e?.code || e?.status || "unknown",
      message: errMsg.slice(0, 800),
      timestamp: new Date().toISOString(),
    };
    await db.update(arimaRequests)
      .set({
        brdError: `Google Docs export error: ${errMsg.slice(0, 800)}`,
        brdExportLog: JSON.stringify(debugSummary).slice(0, 30_000),
        updatedAt: new Date().toISOString(),
      } as any)
      .where(eq(arimaRequests.id, row.id));
    return { ok: false, error: errMsg };
  }
}
