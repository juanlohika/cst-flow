/**
 * Phase 22.1 — Google Docs export (v2: native tables + Mermaid images).
 *
 * Renders an Eliana-generated BRD Markdown into a fully-formatted Google Doc:
 *   - Headings (#, ##, ###, ####) become real Google Docs heading styles
 *   - Markdown tables become NATIVE Google Docs tables (insertTable + per-cell content)
 *   - Mermaid code fences are rendered to PNG via mermaid.ink and embedded as images
 *   - Other fenced code blocks stay as monospace plain text
 *   - Bullet / numbered lists become real Docs lists
 *   - Inline **bold** / *italic* / `code` survive as text runs (basic — v2.1 can refine)
 *
 * Strategy: parse the Markdown into a sequence of blocks (heading, paragraph,
 * table, mermaid, codeBlock, listItem). Insert them one at a time, query the
 * doc's current length between blocks so we never have to do index math
 * across operations that change body size unpredictably (tables add cells +
 * paragraph nodes; image insertion adds inline elements).
 *
 * Idempotent re-export: if the request already has a brdGoogleDocId we clear
 * the doc body and re-stream the content into the same doc.
 */
import { db } from "@/db";
import { arimaRequests } from "@/db/schema";
import { eq } from "drizzle-orm";

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

    const existingDocId = (row as any).brdGoogleDocId as string | null;
    let docId = existingDocId || "";
    let docUrl = (row as any).brdGoogleDocUrl as string | null || "";

    if (!docId) {
      // Verify the service account can see the folder before creating
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
      // Rename if title changed
      await drive.files.update({
        fileId: docId,
        requestBody: { name: title },
      }).catch(() => {});

      // Clear existing content
      await clearDocBody(docs, docId);
    }

    // Parse markdown into blocks and stream them into the doc, capturing
    // a per-block diagnostic so admins can see what happened on the live deploy.
    const blocks = parseMarkdownToBlocks(markdown);
    const exportLog = await streamBlocksIntoDoc(docs, docId, blocks);
    const summary = {
      docId,
      totalBlocks: blocks.length,
      kinds: blocks.reduce((acc, b) => { acc[b.kind] = (acc[b.kind] || 0) + 1; return acc; }, {} as Record<string, number>),
      perBlock: exportLog,
      markdownLength: markdown.length,
      timestamp: new Date().toISOString(),
    };

    const finalUrl = docUrl || `https://docs.google.com/document/d/${docId}/edit`;
    const now = new Date().toISOString();
    await db.update(arimaRequests)
      .set({
        brdGoogleDocId: docId,
        brdGoogleDocUrl: finalUrl,
        brdGoogleDocSyncedAt: now,
        brdStatus: "exported",
        brdExportLog: JSON.stringify(summary).slice(0, 30_000),
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

// ─── Doc helpers ──────────────────────────────────────────────────────

/**
 * Clear all body content from a Google Doc. The naive deleteContentRange
 * over [1, endIndex-1] FAILS or partially works when the body contains
 * structural elements like tables — Google's API requires those to be
 * cleared separately. We do a two-pass: first delete every table, THEN
 * delete the remaining text content.
 */
async function clearDocBody(docs: any, docId: string): Promise<void> {
  // Pass 1: find and delete every table individually
  let safetyCounter = 0;
  while (safetyCounter++ < 20) {
    const doc = await docs.documents.get({ documentId: docId });
    const elements = doc.data.body?.content || [];
    const firstTable = elements.find((el: any) => el.table);
    if (!firstTable) break;
    if (typeof firstTable.startIndex !== "number" || typeof firstTable.endIndex !== "number") break;
    try {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [{
            deleteContentRange: {
              range: { startIndex: firstTable.startIndex, endIndex: firstTable.endIndex - 1 },
            },
          }],
        },
      });
    } catch (e: any) {
      console.warn("[google-docs-export] table delete failed during clear:", e?.message);
      break;
    }
  }

  // Pass 2: delete remaining text content
  const after = await docs.documents.get({ documentId: docId });
  const endIndex = (after.data.body?.content || []).reduce((acc: number, el: any) => {
    return Math.max(acc, (el.endIndex || 1));
  }, 1);
  if (endIndex > 2) {
    try {
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
    } catch (e: any) {
      console.warn("[google-docs-export] residual delete failed:", e?.message);
    }
  }
}

/**
 * Query the current document length so the next insert can be positioned at
 * the very end (right before the trailing newline at body length - 1).
 */
async function getEndIndex(docs: any, docId: string): Promise<number> {
  const doc = await docs.documents.get({ documentId: docId });
  const elements = doc.data.body?.content || [];
  let max = 1;
  for (const el of elements) {
    if (typeof el.endIndex === "number" && el.endIndex > max) max = el.endIndex;
  }
  // The body always has a trailing empty segment that ends at the doc length.
  // To insert content "at the end" we insert at endIndex - 1 (before the
  // final newline of the body).
  return Math.max(1, max - 1);
}

// ─── Markdown parsing ────────────────────────────────────────────────

type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "mermaid"; code: string }
  | { kind: "code"; lang: string | null; code: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "blank" };

function parseMarkdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (mermaid or generic)
    const fenceMatch = line.match(/^```\s*([a-zA-Z0-9_-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || null;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      if (lang === "mermaid") {
        blocks.push({ kind: "mermaid", code: buf.join("\n") });
      } else {
        blocks.push({ kind: "code", lang, code: buf.join("\n") });
      }
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      const level = Math.min(6, hMatch[1].length) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, text: hMatch[2].trim() });
      i++;
      continue;
    }

    // Markdown table — looks like "| ... |" with a separator row of "|---|" below
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:-]+\|\s*$/.test(lines[i + 1])) {
      const headerRow = parseTableRow(line);
      i += 2; // skip header + separator
      const dataRows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        dataRows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers: headerRow, rows: dataRows });
      continue;
    }

    // List item (unordered)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      blocks.push({ kind: "blank" });
      i++;
      continue;
    }

    // Default: collect contiguous non-empty, non-special lines as one paragraph
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const nl = lines[i];
      if (nl.trim() === "" ||
        /^#{1,6}\s+/.test(nl) ||
        /^```/.test(nl) ||
        /^\s*\|.*\|\s*$/.test(nl) ||
        /^\s*[-*+]\s+/.test(nl) ||
        /^\s*\d+\.\s+/.test(nl)
      ) break;
      para.push(nl);
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ").trim() });
  }

  return blocks;
}

function parseTableRow(line: string): string[] {
  // Strip leading/trailing pipe + whitespace, split on |
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map(c => c.trim());
}

/**
 * Strip inline markdown formatting (we render plain text into cells/paragraphs
 * for now — inline bold/italic styling can be added in a follow-up).
 */
function stripInlineMarkdown(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")        // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1")     // italic
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"); // links → "text (url)"
}

// ─── Streaming blocks into a Google Doc ──────────────────────────────

async function streamBlocksIntoDoc(docs: any, docId: string, blocks: Block[]): Promise<Array<{ idx: number; kind: string; ok: boolean; error?: string; note?: string }>> {
  const log: Array<{ idx: number; kind: string; ok: boolean; error?: string; note?: string }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    try {
      const note = await insertBlock(docs, docId, block);
      log.push({ idx: i, kind: block.kind, ok: true, note: note || undefined });
    } catch (e: any) {
      const errStr = e?.message || String(e);
      console.warn(`[google-docs-export] block #${i} (${block.kind}) failed:`, errStr);
      log.push({ idx: i, kind: block.kind, ok: false, error: errStr.slice(0, 500) });
    }
  }
  return log;
}

async function insertBlock(docs: any, docId: string, block: Block): Promise<string | void> {
  const cursor = await getEndIndex(docs, docId);

  if (block.kind === "heading") {
    const text = stripInlineMarkdown(block.text);
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          { insertText: { location: { index: cursor }, text: text + "\n" } },
          {
            updateParagraphStyle: {
              range: { startIndex: cursor, endIndex: cursor + text.length + 1 },
              paragraphStyle: { namedStyleType: `HEADING_${block.level}` },
              fields: "namedStyleType",
            },
          },
        ],
      },
    });
    return;
  }

  if (block.kind === "paragraph") {
    const text = stripInlineMarkdown(block.text);
    if (!text) return;
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: cursor }, text: text + "\n" } }],
      },
    });
    return;
  }

  if (block.kind === "blank") {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: cursor }, text: "\n" } }],
      },
    });
    return;
  }

  if (block.kind === "list") {
    // Insert each item as a line, then apply list-style range over them
    const text = block.items.map(it => stripInlineMarkdown(it)).join("\n") + "\n";
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          { insertText: { location: { index: cursor }, text } },
          {
            createParagraphBullets: {
              range: { startIndex: cursor, endIndex: cursor + text.length },
              bulletPreset: block.ordered ? "NUMBERED_DECIMAL_ALPHA_ROMAN" : "BULLET_DISC_CIRCLE_SQUARE",
            },
          },
        ],
      },
    });
    return;
  }

  if (block.kind === "code") {
    // Render code as a single paragraph with Courier-style formatting.
    // True monospace styling requires updateTextStyle on the range.
    const text = block.code + "\n";
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          { insertText: { location: { index: cursor }, text } },
          {
            updateTextStyle: {
              range: { startIndex: cursor, endIndex: cursor + text.length },
              textStyle: { weightedFontFamily: { fontFamily: "Courier New" } },
              fields: "weightedFontFamily",
            },
          },
        ],
      },
    });
    return;
  }

  if (block.kind === "mermaid") {
    // Render the Mermaid diagram via the mermaid.ink public service →
    // we get a PNG URL that Google's insertInlineImage accepts.
    // Fallback: if image embed fails, drop the raw code as a styled paragraph
    // so the diagram source isn't lost.
    const imageUrl = mermaidInkUrl(block.code);
    try {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [
            {
              insertInlineImage: {
                location: { index: cursor },
                uri: imageUrl,
                objectSize: {
                  width: { magnitude: 500, unit: "PT" },
                  height: { magnitude: 320, unit: "PT" },
                },
              },
            },
            // Add a newline after the image
            { insertText: { location: { index: cursor + 1 }, text: "\n" } },
          ],
        },
      });
      return `image-embedded`;
    } catch (imgErr: any) {
      const errMsg = imgErr?.message || String(imgErr);
      console.warn("[google-docs-export] mermaid image embed failed; falling back to code:", errMsg);
      const fallbackText = "[Mermaid diagram — open in mermaid.live to view]\n" + block.code + "\n";
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [
            { insertText: { location: { index: cursor }, text: fallbackText } },
            {
              updateTextStyle: {
                range: { startIndex: cursor, endIndex: cursor + fallbackText.length },
                textStyle: { weightedFontFamily: { fontFamily: "Courier New" } },
                fields: "weightedFontFamily",
              },
            },
          ],
        },
      });
      return `fallback-text:${errMsg.slice(0, 100)}`;
    }
  }

  if (block.kind === "table") {
    // 1) Insert an empty native table of the right dimensions
    const numRows = 1 + block.rows.length; // +1 for header row
    const numCols = Math.max(block.headers.length, ...block.rows.map(r => r.length));
    if (numCols === 0) return "skipped-no-columns";
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{
          insertTable: {
            location: { index: cursor },
            rows: numRows,
            columns: numCols,
          },
        }],
      },
    });

    // 2) Re-query the doc to find the table we just inserted and walk its
    //    cells in document order. Each cell starts with an empty paragraph
    //    we can insert text into.
    const doc = await docs.documents.get({ documentId: docId });
    const elements = doc.data.body?.content || [];
    // Find the table that starts at or after our cursor
    let table: any = null;
    for (const el of elements) {
      if (el.table && el.startIndex && el.startIndex >= cursor) {
        table = el;
        break;
      }
    }
    if (!table || !table.table) return;

    // Collect cell start indexes in row-major order
    const cellInserts: Array<{ index: number; text: string }> = [];
    let r = 0;
    for (const tableRow of table.table.tableRows || []) {
      let c = 0;
      const sourceRow = r === 0 ? block.headers : (block.rows[r - 1] || []);
      for (const cell of tableRow.tableCells || []) {
        const cellContent = cell.content?.[0];
        const cellStart = cellContent?.startIndex;
        if (typeof cellStart === "number") {
          const cellText = stripInlineMarkdown(sourceRow[c] || "");
          if (cellText) {
            cellInserts.push({ index: cellStart, text: cellText });
          }
        }
        c++;
      }
      r++;
    }

    // Insert cell text in REVERSE order so earlier insertions don't shift
    // later cell start indexes (each insertText changes downstream indexes).
    cellInserts.sort((a, b) => b.index - a.index);
    if (cellInserts.length > 0) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: cellInserts.map(ci => ({
            insertText: { location: { index: ci.index }, text: ci.text },
          })),
        },
      });

      // Bold the header row text (re-query to find current cell ranges since
      // text was inserted; we approximate by re-finding the first row's cells)
      try {
        const updated = await docs.documents.get({ documentId: docId });
        const els = updated.data.body?.content || [];
        let tbl: any = null;
        for (const el of els) {
          if (el.table && el.startIndex && el.startIndex >= cursor) { tbl = el; break; }
        }
        if (tbl?.table?.tableRows?.[0]) {
          const headerRequests: any[] = [];
          for (const cell of tbl.table.tableRows[0].tableCells || []) {
            const cellContent = cell.content?.[0];
            const startIdx = cellContent?.startIndex;
            const endIdx = cellContent?.endIndex;
            if (typeof startIdx === "number" && typeof endIdx === "number" && endIdx > startIdx + 1) {
              headerRequests.push({
                updateTextStyle: {
                  range: { startIndex: startIdx, endIndex: endIdx - 1 },
                  textStyle: { bold: true },
                  fields: "bold",
                },
              });
            }
          }
          if (headerRequests.length > 0) {
            await docs.documents.batchUpdate({
              documentId: docId,
              requestBody: { requests: headerRequests },
            });
          }
        }
      } catch {}
    }
    return `table:${numRows}x${numCols},cells:${cellInserts.length}`;
  }
}

// ─── Mermaid.ink helper ───────────────────────────────────────────────

/**
 * mermaid.ink is a free public renderer. We base64-encode the graph
 * definition (URL-safe variant) and request a PNG image. The resulting URL
 * is publicly accessible and Google's insertInlineImage can fetch it.
 *
 * Tradeoff: depends on a third-party service. If mermaid.ink is down or
 * rate-limits us, the export still succeeds — we fall back to plain code.
 */
function mermaidInkUrl(graph: string): string {
  // mermaid.ink expects base64url-encoded graph definition
  const b64 = Buffer.from(graph, "utf-8").toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `https://mermaid.ink/img/${b64}?type=png&bgColor=FFFFFF`;
}
