/**
 * Phase F.2 (B7) — PDF rendering pipeline.
 *
 * Pipeline:
 *   1. Render the React component server-side to static HTML.
 *   2. Upload that HTML to Drive with mimeType=google-apps.document — Drive
 *      auto-converts HTML into a native Google Doc, applying styling cleanly.
 *   3. Export the Doc as PDF via files.export.
 *   4. Upload the PDF as a regular Drive file to the account's folder.
 *   5. Delete the intermediate Doc (we don't need it after PDF is in place).
 *
 * Drive's HTML import preserves: headings, tables (incl. borders + alternating
 * row bg), paragraphs, bullet lists, bold/italic, color spans. It DROPS:
 * complex CSS layouts, flexbox, gradients on plain divs. So the renderer
 * sticks to table-based + inline-style HTML (no flexbox-only layouts).
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Readable } from "stream";
import { loadDriveCtx, ensureAccountFolder, type DriveCtx } from "./drive";
import ProposalDocument from "@/components/proposal/ProposalDocument";
import type { ProposalContent } from "./types";

const DOC_MIME = "application/vnd.google-apps.document";
const HTML_MIME = "text/html";
const PDF_MIME = "application/pdf";

export async function renderProposalToPdf(args: {
  content: ProposalContent;
  proposalsRootFolderId: string;
  outputFileName: string;
}): Promise<{ pdfFileId: string; pdfWebViewLink: string }> {
  const ctx = await loadDriveCtx();

  // 1. React → HTML
  const html = wrapHtml(renderToStaticMarkup(<ProposalDocument content={args.content} />));

  // 2. Ensure the per-account folder exists
  const folder = await ensureAccountFolder(ctx, args.proposalsRootFolderId, args.content.client.name);

  // 3. Upload HTML to Drive as a Google Doc (auto-convert)
  const tempDocId = await uploadHtmlAsGoogleDoc(ctx, {
    folderId: folder.folderId,
    name: `__tmp ${args.outputFileName}`,
    html,
  });

  try {
    // 4. Export as PDF bytes
    const pdfBytes = await exportDocAsPdf(ctx, tempDocId);

    // 5. Upload PDF as final file
    const pdf = await uploadPdf(ctx, {
      folderId: folder.folderId,
      name: args.outputFileName,
      buffer: pdfBytes,
    });

    return { pdfFileId: pdf.fileId, pdfWebViewLink: pdf.webViewLink };
  } finally {
    // 6. Always try to clean up the temp Doc
    try {
      await ctx.drive.files.delete({ fileId: tempDocId, supportsAllDrives: true });
    } catch (e) {
      console.warn("[render-pdf] failed to delete temp Doc:", e);
    }
  }
}

function wrapHtml(body: string): string {
  // Drive's HTML import looks at the body; a minimal shell keeps things clean.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Proposal</title>
</head>
<body>
${body}
</body>
</html>`;
}

async function uploadHtmlAsGoogleDoc(ctx: DriveCtx, args: {
  folderId: string;
  name: string;
  html: string;
}): Promise<string> {
  const created = await ctx.drive.files.create({
    requestBody: {
      name: args.name,
      mimeType: DOC_MIME,                  // Drive auto-converts HTML body → Doc
      parents: [args.folderId],
    },
    media: {
      mimeType: HTML_MIME,
      body: Readable.from(Buffer.from(args.html, "utf8")),
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created?.data?.id) throw new Error("Drive didn't return an id for the temp Doc");
  return created.data.id;
}

async function exportDocAsPdf(ctx: DriveCtx, docId: string): Promise<Buffer> {
  const resp = await ctx.drive.files.export(
    { fileId: docId, mimeType: PDF_MIME },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(resp.data as ArrayBuffer);
}

async function uploadPdf(ctx: DriveCtx, args: {
  folderId: string;
  name: string;
  buffer: Buffer;
}): Promise<{ fileId: string; webViewLink: string }> {
  const created = await ctx.drive.files.create({
    requestBody: {
      name: args.name,
      mimeType: PDF_MIME,
      parents: [args.folderId],
    },
    media: {
      mimeType: PDF_MIME,
      body: Readable.from(args.buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const fileId = created?.data?.id;
  if (!fileId) throw new Error("Drive didn't return an id for the PDF");
  return { fileId, webViewLink: created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view` };
}
