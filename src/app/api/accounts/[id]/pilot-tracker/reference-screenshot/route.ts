/**
 * Pilot Tracker — reference screenshot upload.
 *
 * POST /api/accounts/[id]/pilot-tracker/reference-screenshot
 *   multipart/form-data with `file` field (PNG/JPEG/WebP)
 *
 * Uploads the "what your app-version screen should look like" reference
 * image to the pilot project's Drive folder. Serves two purposes:
 *   1. Shown to participants on Screen F as a visual guide.
 *   2. Shown to CST admins side-by-side with participant uploads during
 *      manual verification review.
 *
 * If a previous reference screenshot exists, it's NOT deleted from Drive —
 * useful for audit / rolling-back to a previous build. The DB just points
 * at the new one.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { uploadScreenshotToDrive } from "@/lib/pilot/drive";

export const dynamic = "force-dynamic";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(and(eq(pilotProjects.clientProfileId, id), eq(pilotProjects.status, "active")))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "No active pilot project" }, { status: 404 });
  }
  if (!project.driveFolderId) {
    return NextResponse.json({ error: "Pilot project has no Drive folder configured" }, { status: 500 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `File type ${file.type} not allowed. Use PNG, JPEG, or WebP.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Max ${MAX_BYTES} bytes.` },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type.split("/")[1] || "png";
    const filename = `reference-screenshot-${Date.now()}.${ext}`;
    const uploaded = await uploadScreenshotToDrive({
      folderId: project.driveFolderId,
      buffer,
      filename,
      mimeType: file.type,
    });

    await db
      .update(pilotProjects)
      .set({
        referenceScreenshotDriveId: uploaded.fileId,
        referenceScreenshotUrl: uploaded.webViewLink,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(pilotProjects.id, project.id));

    return NextResponse.json({
      fileId: uploaded.fileId,
      url: uploaded.webViewLink,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Reference screenshot upload failed" },
      { status: 500 },
    );
  }
}
