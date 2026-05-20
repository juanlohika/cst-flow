import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proposals, clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema, canAccessClient } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/proposal-maker/<id>
 * Returns the proposal record + its content JSON + the client name.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    const isAdmin = (session.user as any).role === "admin";

    const rows = await db.select({
      id: proposals.id,
      clientProfileId: proposals.clientProfileId,
      title: proposals.title,
      versionNumber: proposals.versionNumber,
      sourceInputs: proposals.sourceInputs,
      status: proposals.status,
      pdfDriveFileId: proposals.pdfDriveFileId,
      pdfDriveUrl: proposals.pdfDriveUrl,
      exportedAt: proposals.exportedAt,
      generatedBy: proposals.generatedBy,
      generatedAt: proposals.generatedAt,
      clientName: clientProfiles.companyName,
    })
      .from(proposals)
      .leftJoin(clientProfiles, eq(clientProfiles.id, proposals.clientProfileId))
      .where(eq(proposals.id, params.id))
      .limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, row.clientProfileId);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    let content: any = null;
    try { content = row.sourceInputs ? JSON.parse(row.sourceInputs) : null; } catch {}
    return NextResponse.json({ proposal: { ...row, content } });
  } catch (error: any) {
    console.error("[proposal-maker/[id] GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
