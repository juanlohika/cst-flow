import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { buildExecutiveSummary, clusterThemes } from "@/lib/accounts/executive-summary";
import { renderExecutiveSummaryHtml } from "@/lib/accounts/executive-summary-html";
import {
  loadGoogleConfig, getDriveClient, verifyDriveFolderAccess,
  generateDocxBuffer, generatePdfViaDrive, uploadOrUpdateFile,
} from "@/lib/drive-export-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/executive-summary/export?format=pdf|docx|both
 *
 * Renders the executive summary HTML, generates Word + PDF via the same
 * pipeline the BRD export uses, uploads both to the configured Drive folder.
 * Always runs the AI clustering pass so the export has the executive blurb.
 *
 * Returns { docxUrl, pdfUrl, generatedAt }.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const cfg = await loadGoogleConfig();
    if (!cfg) return NextResponse.json({ error: "Drive export not configured. Add GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_BRD_FOLDER_ID in admin settings." }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "both").toLowerCase();
    const wantDocx = format === "docx" || format === "both";
    const wantPdf = format === "pdf" || format === "both";

    // Build + AI cluster
    const summary = await buildExecutiveSummary();
    await clusterThemes(summary);

    const html = renderExecutiveSummaryHtml(summary);
    const stamp = new Date().toISOString().slice(0, 10);
    const baseTitle = `Account_Health_Executive_Summary_${stamp}`;

    // Drive auth + folder check
    const { drive, credentials } = await getDriveClient(cfg);
    await verifyDriveFolderAccess(drive, cfg.driveFolderId, credentials.client_email);

    let docxUrl: string | undefined;
    let pdfUrl: string | undefined;
    const errors: string[] = [];

    if (wantDocx) {
      try {
        const docxBuf = await generateDocxBuffer(html, baseTitle);
        const uploaded = await uploadOrUpdateFile(drive, {
          existingFileId: null,    // always a fresh file (timestamped name)
          folderId: cfg.driveFolderId,
          name: `${baseTitle}.docx`,
          buffer: docxBuf,
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        docxUrl = uploaded.webViewLink;

        if (wantPdf) {
          try {
            const pdfBuf = await generatePdfViaDrive(drive, {
              docxBuffer: docxBuf,
              folderId: cfg.driveFolderId,
              title: `${baseTitle}__pdfsource_temp`,
            });
            const pdfUploaded = await uploadOrUpdateFile(drive, {
              existingFileId: null,
              folderId: cfg.driveFolderId,
              name: `${baseTitle}.pdf`,
              buffer: pdfBuf,
              mimeType: "application/pdf",
            });
            pdfUrl = pdfUploaded.webViewLink;
          } catch (e: any) {
            errors.push(`PDF: ${e?.message || e}`);
          }
        }
      } catch (e: any) {
        errors.push(`Word: ${e?.message || e}`);
      }
    } else if (wantPdf) {
      // PDF only — we still need the .docx as a transient input
      try {
        const docxBuf = await generateDocxBuffer(html, baseTitle);
        const pdfBuf = await generatePdfViaDrive(drive, {
          docxBuffer: docxBuf,
          folderId: cfg.driveFolderId,
          title: `${baseTitle}__pdfsource_temp`,
        });
        const pdfUploaded = await uploadOrUpdateFile(drive, {
          existingFileId: null,
          folderId: cfg.driveFolderId,
          name: `${baseTitle}.pdf`,
          buffer: pdfBuf,
          mimeType: "application/pdf",
        });
        pdfUrl = pdfUploaded.webViewLink;
      } catch (e: any) {
        errors.push(`PDF: ${e?.message || e}`);
      }
    }

    if (!docxUrl && !pdfUrl) {
      return NextResponse.json({ error: errors.join(" · ") || "Export failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      docxUrl,
      pdfUrl,
      generatedAt: summary.generatedAt,
      errors,
    });
  } catch (error: any) {
    console.error("[executive-summary export]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
