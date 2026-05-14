/**
 * Phase 22.1 — Google Docs export.
 *
 * Takes a generated BRD Markdown document and creates a Google Doc in the
 * configured Drive folder. The Google Doc is created with the team's
 * service-account credentials and shared via the team's Workspace (folder
 * permissions inherit).
 *
 * Configuration (in order of precedence):
 *   1. globalSettings DB keys: GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_DRIVE_BRD_FOLDER_ID
 *   2. process.env equivalents
 *
 * Idempotent: if a row already has brdGoogleDocId, we re-use the existing
 * doc and update its contents instead of creating a new one.
 *
 * Best-effort: failures don't break the BRD generation flow — the BRD
 * document already exists as Markdown on the request row, the Google Doc
 * is a bonus export.
 */
import { db } from "@/db";
import { arimaRequests } from "@/db/schema";
import { eq } from "drizzle-orm";

interface GoogleConfig {
  serviceAccountJson: string;
  driveFolderId: string;
}

async function loadGoogleConfig(): Promise<GoogleConfig | null> {
  // Try DB-stored globalSettings first
  try {
    const { globalSettings } = await import("@/db/schema");
    const rows = await db.select().from(globalSettings);
    const map = new Map(rows.map((r: any) => [r.key, r.value]));
    const serviceAccountJson = map.get("GOOGLE_SERVICE_ACCOUNT_JSON") || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    const driveFolderId = map.get("GOOGLE_DRIVE_BRD_FOLDER_ID") || process.env.GOOGLE_DRIVE_BRD_FOLDER_ID || "";
    if (!serviceAccountJson || !driveFolderId) return null;
    return { serviceAccountJson, driveFolderId };
  } catch {
    // Fall through to env-only
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    const driveFolderId = process.env.GOOGLE_DRIVE_BRD_FOLDER_ID || "";
    if (!serviceAccountJson || !driveFolderId) return null;
    return { serviceAccountJson, driveFolderId };
  }
}

/**
 * Convert a Markdown BRD into a Google Doc.
 *
 * Strategy: Create the doc as plain text first (preserves all structure as
 * readable content), then use batchUpdate to apply formatting on top —
 * headings, bold, tables. Mermaid code blocks are left as plain text since
 * Google Docs doesn't have native Mermaid; clients view them as the raw
 * code or paste into a Mermaid renderer.
 *
 * For simplicity we use the "insert as plain text" approach with a few
 * heading transformations. Good enough for v1 — admins can refine.
 */
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

  // Load the request
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

  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/drive",
      ],
    });
    await auth.authorize();

    const docs = google.docs({ version: "v1", auth });
    const drive = google.drive({ version: "v3", auth });

    const title = row.title.slice(0, 200);
    const markdown = String((row as any).brdDocument || "");

    // If the row already has a Google Doc, update its content instead of creating a new one.
    const existingDocId = (row as any).brdGoogleDocId as string | null;
    let docId = existingDocId || "";
    let docUrl = (row as any).brdGoogleDocUrl as string | null || "";

    if (!docId) {
      // Verify the service account can actually see the configured folder.
      // Without this, drive.files.create returns "File not found: <folderId>"
      // which is misleading — the folder exists, the service account just
      // lacks permission on it.
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
            `Open the folder in Google Drive → right-click → Share → add the service account email (${credentials.client_email}) as Editor. ` +
            `Then try export again.`
          );
        }
        if (code === 403) {
          throw new Error(
            `Service account doesn't have Editor permission on the configured Drive folder. ` +
            `Open the folder → Share → find the service account (${credentials.client_email}) → change role to Editor.`
          );
        }
        throw folderErr;
      }

      // Create a new doc in the configured folder
      const created = await drive.files.create({
        requestBody: {
          name: title,
          mimeType: "application/vnd.google-apps.document",
          parents: [cfg.driveFolderId],
        },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      docId = created.data.id || "";
      docUrl = created.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;
      if (!docId) throw new Error("Google didn't return a doc id");
    } else {
      // Update title on the existing doc
      await drive.files.update({
        fileId: docId,
        requestBody: { name: title },
      }).catch(() => {});

      // Clear existing content (replace the body with our markdown)
      const existing = await docs.documents.get({ documentId: docId });
      const endIndex = (existing.data.body?.content || []).reduce((acc, el) => {
        return Math.max(acc, (el.endIndex || 1));
      }, 1);
      if (endIndex > 2) {
        // Delete from index 1 to endIndex - 1 (leaves the trailing newline)
        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [{
              deleteContentRange: {
                range: { startIndex: 1, endIndex: endIndex - 1 },
              },
            }],
          },
        });
      }
    }

    // Insert the markdown content as plain text + apply heading styles
    const requests = buildDocsRequestsFromMarkdown(markdown);
    if (requests.length > 0) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests },
      });
    }

    const finalUrl = docUrl || `https://docs.google.com/document/d/${docId}/edit`;
    const now = new Date().toISOString();
    await db.update(arimaRequests)
      .set({
        brdGoogleDocId: docId,
        brdGoogleDocUrl: finalUrl,
        brdGoogleDocSyncedAt: now,
        brdStatus: "exported",
        updatedAt: now,
      } as any)
      .where(eq(arimaRequests.id, row.id));

    return { ok: true, docId, docUrl: finalUrl };
  } catch (e: any) {
    const errMsg = e?.message || "Google Docs export failed";
    await db.update(arimaRequests)
      .set({
        brdError: `Google Docs export error: ${errMsg.slice(0, 800)}`,
        updatedAt: new Date().toISOString(),
      } as any)
      .where(eq(arimaRequests.id, row.id));
    return { ok: false, error: errMsg };
  }
}

/**
 * Convert a Markdown BRD into Google Docs batchUpdate requests. We do a
 * minimal pass — insert all text, then apply heading paragraph styles on the
 * heading lines, bold on the lines we transformed. Tables and Mermaid blocks
 * are kept as plain text (Google Docs natively renders code blocks as
 * monospace; tables we'd need to construct via insertTable for full
 * fidelity — a v2 enhancement).
 */
function buildDocsRequestsFromMarkdown(markdown: string): any[] {
  const requests: any[] = [];
  // Insert all the content first
  requests.push({
    insertText: {
      location: { index: 1 },
      text: markdown + "\n",
    },
  });

  // Walk through and find H1/H2/H3 lines for paragraph-style application
  let cursor = 1;
  const lines = markdown.split("\n");
  for (const line of lines) {
    const lineLen = line.length + 1; // +1 for newline
    let style: string | null = null;
    if (/^#\s+/.test(line)) style = "HEADING_1";
    else if (/^##\s+/.test(line)) style = "HEADING_2";
    else if (/^###\s+/.test(line)) style = "HEADING_3";
    else if (/^####\s+/.test(line)) style = "HEADING_4";

    if (style) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: cursor, endIndex: cursor + lineLen - 1 },
          paragraphStyle: { namedStyleType: style },
          fields: "namedStyleType",
        },
      });
    }
    cursor += lineLen;
  }

  return requests;
}
