import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proposals, proposalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema, canAccessClient } from "@/lib/access/accounts";
import { renderTemplateProposalToPdf } from "@/lib/proposal/render-template-to-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/proposal-maker/<id>/export-pdf
 *
 * Fills the configured Word template with the proposal's sourceInputs JSON
 * (via docxtemplater), uploads the filled .docx to Drive for conversion to
 * Google Doc + PDF, files the PDF in the per-account folder, and updates
 * the Proposal row with pdfDriveFileId + pdfDriveUrl.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    const isAdmin = (session.user as any).role === "admin";

    const proposalRows = await db.select().from(proposals).where(eq(proposals.id, params.id)).limit(1);
    const row = proposalRows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, row.clientProfileId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const settingsRows = await db.select().from(proposalSettings).where(eq(proposalSettings.id, "default")).limit(1);
    const settings = settingsRows[0];
    if (!settings) return NextResponse.json({ error: "Proposal Maker settings not configured. Open /proposal-maker/settings and configure both the Drive folder and the template file." }, { status: 400 });
    if (!settings.templateDriveFileId) return NextResponse.json({ error: "Proposal template not configured. Open /proposal-maker/settings and paste the Drive link to your template .docx (must contain the placeholders — see the in-app guide)." }, { status: 400 });

    let content: any;
    try { content = JSON.parse(row.sourceInputs || ""); }
    catch { return NextResponse.json({ error: "Proposal has no rendered content yet — chat with ARIMA first." }, { status: 400 }); }

    const today = new Date().toISOString().slice(0, 10);
    const safeTitle = (row.title || "Proposal").replace(/[\/\\]+/g, " ").replace(/\s+/g, " ").trim();
    const accountName = content.client?.name || "Unknown Account";
    const fileName = `${today} — ${accountName} — ${safeTitle} (v${row.versionNumber}).pdf`;

    const result = await renderTemplateProposalToPdf({
      content,
      templateDriveFileId: settings.templateDriveFileId,
      proposalsRootFolderId: settings.proposalsRootFolderId,
      outputFileName: fileName,
    });

    const now = new Date().toISOString();
    await db.update(proposals)
      .set({
        pdfDriveFileId: result.pdfFileId,
        pdfDriveUrl: result.pdfWebViewLink,
        status: "exported",
        exportedAt: now,
        exportedBy: session.user.id,
      })
      .where(eq(proposals.id, params.id));

    return NextResponse.json({
      pdfDriveFileId: result.pdfFileId,
      pdfDriveUrl: result.pdfWebViewLink,
      fileName,
    });
  } catch (error: any) {
    console.error("[proposal-maker/[id]/export-pdf POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
