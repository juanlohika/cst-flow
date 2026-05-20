import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proposalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, parseDriveId } from "@/lib/proposal/drive";

export const dynamic = "force-dynamic";

/**
 * GET /api/proposal-maker/settings — current ProposalSettings row (or null).
 * PUT — admin saves the Drive folder where generated proposals are filed.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();
    const rows = await db.select().from(proposalSettings).where(eq(proposalSettings.id, "default")).limit(1);
    return NextResponse.json({ settings: rows[0] || null });
  } catch (error: any) {
    console.error("[proposal-maker/settings GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const proposalsRootLink = String(body?.proposalsRootLink || "").trim();
    const proposalsRootFolderId = parseDriveId(proposalsRootLink);
    if (!proposalsRootFolderId) return NextResponse.json({ error: "proposalsRootLink isn't a recognizable Drive folder URL or id." }, { status: 400 });

    // Verify access
    const ctx = await loadDriveCtx();
    try {
      await ctx.drive.files.get({ fileId: proposalsRootFolderId, fields: "id, name, mimeType", supportsAllDrives: true });
    } catch (e: any) {
      const msg = (e?.code === 404 || e?.status === 404)
        ? `Service account can't see the Proposals folder. Share it with ${ctx.serviceAccountEmail} as Editor.`
        : (e?.message || "Failed to read Proposals folder.");
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const now = new Date().toISOString();
    await db.insert(proposalSettings)
      .values({ id: "default", proposalsRootFolderId, updatedBy: session.user.id, updatedAt: now })
      .onConflictDoUpdate({
        target: proposalSettings.id,
        set: { proposalsRootFolderId, updatedBy: session.user.id, updatedAt: now },
      });
    const fresh = await db.select().from(proposalSettings).where(eq(proposalSettings.id, "default")).limit(1);
    return NextResponse.json({ settings: fresh[0] || null });
  } catch (error: any) {
    console.error("[proposal-maker/settings PUT]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
