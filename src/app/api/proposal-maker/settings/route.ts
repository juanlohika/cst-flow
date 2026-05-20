import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proposalTemplate } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, parseDriveId, fetchTemplateDocx } from "@/lib/proposal/drive";
import { inspectTemplate } from "@/lib/proposal/extract-spec";

export const dynamic = "force-dynamic";

/**
 * GET /api/proposal-maker/settings
 *
 * Admin-only. Returns the active template config + extraction status.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const rows = await db.select().from(proposalTemplate).where(eq(proposalTemplate.id, "default")).limit(1);
    return NextResponse.json({ template: rows[0] || null });
  } catch (error: any) {
    console.error("[proposal-maker/settings GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

/**
 * PUT /api/proposal-maker/settings
 * Body: { templateLink, proposalsRootLink }
 *
 * Validates both Drive links by fetching their metadata through the service
 * account, downloads the template, runs the inspector, and stores the result.
 * On error the row is still upserted with syncStatus='error' + syncError set.
 */
export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const templateLink = String(body?.templateLink || "").trim();
    const proposalsRootLink = String(body?.proposalsRootLink || "").trim();

    const templateFileId = parseDriveId(templateLink);
    const proposalsRootFolderId = parseDriveId(proposalsRootLink);
    if (!templateFileId) return NextResponse.json({ error: "templateLink isn't a recognizable Drive URL or id." }, { status: 400 });
    if (!proposalsRootFolderId) return NextResponse.json({ error: "proposalsRootLink isn't a recognizable Drive folder URL or id." }, { status: 400 });

    const ctx = await loadDriveCtx();

    // Validate root folder access.
    try {
      await ctx.drive.files.get({ fileId: proposalsRootFolderId, fields: "id, name, mimeType", supportsAllDrives: true });
    } catch (e: any) {
      const msg = (e?.code === 404 || e?.status === 404)
        ? `Service account can't see the Proposals folder. Share it with ${ctx.serviceAccountEmail} as Editor.`
        : (e?.message || "Failed to read Proposals folder.");
      throw new Error(msg);
    }

    // Fetch + inspect template.
    let driveFileName: string | null = null;
    let driveFolderId: string | null = null;
    let syncStatus: "extracted" | "error" = "extracted";
    let syncError: string | null = null;
    let extractedSpec: any = null;
    let rawHtmlPreview: string | null = null;
    try {
      const fetched = await fetchTemplateDocx(ctx, templateFileId);
      driveFileName = fetched.name;
      driveFolderId = fetched.parents?.[0] || null;
      const preview = await inspectTemplate(fetched.buffer);
      extractedSpec = preview.outline;          // F.1 stores the coarse outline; F.2 will replace with a real spec
      rawHtmlPreview = preview.html.slice(0, 80_000); // cap to keep the row reasonable
      if (preview.warnings.length > 0) {
        syncError = `warnings: ${preview.warnings.slice(0, 3).join(" | ")}`;
      }
    } catch (e: any) {
      syncStatus = "error";
      syncError = e?.message || String(e);
    }

    const now = new Date().toISOString();
    await db.insert(proposalTemplate)
      .values({
        id: "default",
        driveFileId: templateFileId,
        driveFileName,
        driveFolderId,
        proposalsRootFolderId,
        extractedSpec: extractedSpec ? JSON.stringify(extractedSpec) : null,
        rawHtmlPreview,
        syncStatus,
        syncError,
        lastSyncedAt: syncStatus === "extracted" ? now : null,
        updatedBy: session.user.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: proposalTemplate.id,
        set: {
          driveFileId: templateFileId,
          driveFileName,
          driveFolderId,
          proposalsRootFolderId,
          extractedSpec: extractedSpec ? JSON.stringify(extractedSpec) : null,
          rawHtmlPreview,
          syncStatus,
          syncError,
          lastSyncedAt: syncStatus === "extracted" ? now : null,
          updatedBy: session.user.id,
          updatedAt: now,
        },
      });

    const fresh = await db.select().from(proposalTemplate).where(eq(proposalTemplate.id, "default")).limit(1);
    return NextResponse.json({ template: fresh[0] || null });
  } catch (error: any) {
    console.error("[proposal-maker/settings PUT]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
