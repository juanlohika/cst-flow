import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proposalTemplate } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, fetchTemplateDocx } from "@/lib/proposal/drive";
import { inspectTemplate } from "@/lib/proposal/extract-spec";

export const dynamic = "force-dynamic";

/**
 * POST /api/proposal-maker/settings/resync
 * Re-fetches the configured template and re-runs the inspector. Used after
 * an admin edits the template in Drive.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const rows = await db.select().from(proposalTemplate).where(eq(proposalTemplate.id, "default")).limit(1);
    const existing = rows[0];
    if (!existing) return NextResponse.json({ error: "No template configured yet." }, { status: 400 });

    const ctx = await loadDriveCtx();
    let syncStatus: "extracted" | "error" = "extracted";
    let syncError: string | null = null;
    let extractedSpec: any = null;
    let rawHtmlPreview: string | null = null;
    let driveFileName: string | null = existing.driveFileName;
    try {
      const fetched = await fetchTemplateDocx(ctx, existing.driveFileId);
      driveFileName = fetched.name;
      const preview = await inspectTemplate(fetched.buffer);
      extractedSpec = preview.outline;
      rawHtmlPreview = preview.html.slice(0, 80_000);
      if (preview.warnings.length > 0) {
        syncError = `warnings: ${preview.warnings.slice(0, 3).join(" | ")}`;
      }
    } catch (e: any) {
      syncStatus = "error";
      syncError = e?.message || String(e);
    }

    const now = new Date().toISOString();
    await db.update(proposalTemplate)
      .set({
        driveFileName,
        extractedSpec: extractedSpec ? JSON.stringify(extractedSpec) : null,
        rawHtmlPreview,
        syncStatus,
        syncError,
        lastSyncedAt: syncStatus === "extracted" ? now : existing.lastSyncedAt,
        updatedBy: session.user.id,
        updatedAt: now,
      })
      .where(eq(proposalTemplate.id, "default"));

    const fresh = await db.select().from(proposalTemplate).where(eq(proposalTemplate.id, "default")).limit(1);
    return NextResponse.json({ template: fresh[0] || null });
  } catch (error: any) {
    console.error("[proposal-maker/settings resync POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
