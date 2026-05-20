/**
 * Phase F.2 (template-fill) — Render a Proposal to a final PDF via the
 * docx template pipeline:
 *
 *   1. Download the configured template .docx from Drive
 *   2. Fill the 5 coarse placeholders with docxtemplater + raw-XML body
 *   3. Upload the filled .docx to Drive as a Google Doc (auto-converts) —
 *      Google Drive preserves Word styles cleanly during this import
 *   4. Export the Doc as PDF
 *   5. Upload the PDF to the per-account folder
 *   6. Delete the intermediate Doc
 *
 * Step 3-5 are identical to the BRD export pipeline (proven on Cloud Run).
 */
import { Readable } from "stream";
import { loadDriveCtx, ensureAccountFolder, fetchTemplateDocx, type DriveCtx } from "./drive";
import { renderProposalDocx } from "./render-docx";
import type { ProposalContent } from "./types";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/vnd.google-apps.document";
const PDF_MIME = "application/pdf";

export async function renderTemplateProposalToPdf(args: {
  content: ProposalContent;
  templateDriveFileId: string;
  proposalsRootFolderId: string;
  outputFileName: string;
}): Promise<{ pdfFileId: string; pdfWebViewLink: string }> {
  const ctx = await loadDriveCtx();

  // 1. Pull the template .docx bytes
  const tpl = await fetchTemplateDocx(ctx, args.templateDriveFileId);
  // 2. Fill placeholders
  const filledDocx = renderProposalDocx({ templateBuffer: tpl.buffer, content: args.content });

  // 3. Ensure account folder
  const folder = await ensureAccountFolder(ctx, args.proposalsRootFolderId, args.content.client.name);

  // 4. Upload filled .docx as Google Doc (auto-converts → preserves Word styles)
  const tempDocId = await uploadDocxAsGoogleDoc(ctx, {
    folderId: folder.folderId,
    name: `__tmp ${args.outputFileName}`,
    buffer: filledDocx,
  });

  try {
    // 5. Export the Doc as PDF
    const pdfBytes = await exportDocAsPdf(ctx, tempDocId);

    // 6. Upload PDF
    const pdf = await uploadPdf(ctx, {
      folderId: folder.folderId,
      name: args.outputFileName,
      buffer: pdfBytes,
    });

    return { pdfFileId: pdf.fileId, pdfWebViewLink: pdf.webViewLink };
  } finally {
    try {
      await ctx.drive.files.delete({ fileId: tempDocId, supportsAllDrives: true });
    } catch (e) {
      console.warn("[render-template-to-pdf] temp Doc cleanup failed:", e);
    }
  }
}

/**
 * Upload a .docx and tell Drive to convert it into a native Google Doc.
 * Drive's import preserves: headings, tables (incl. borders + shading),
 * paragraphs, bullets, bold/italic, color runs. Far better fidelity than
 * trying to convert HTML.
 */
async function uploadDocxAsGoogleDoc(ctx: DriveCtx, args: {
  folderId: string;
  name: string;
  buffer: Buffer;
}): Promise<string> {
  const created = await ctx.drive.files.create({
    requestBody: {
      name: args.name,
      mimeType: DOC_MIME,                  // tells Drive to convert
      parents: [args.folderId],
    },
    media: {
      mimeType: DOCX_MIME,
      body: Readable.from(args.buffer),
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
