import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideoSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, parseDriveId, verifyFolderAccess } from "@/lib/training-video/drive";
import { isValidVoice } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/training-videos/settings — current settings (admin only).
 * PUT — save settings (admin only).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();
    const rows = await db.select().from(trainingVideoSettings).where(eq(trainingVideoSettings.id, "default")).limit(1);
    return NextResponse.json({ settings: rows[0] || null });
  } catch (error: any) {
    console.error("[training-videos/settings GET]", error);
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
    const trainingRootLink = String(body?.trainingRootLink || "").trim();
    const defaultVoice = String(body?.defaultVoice || "Charon").trim();
    const defaultTtsModel = String(body?.defaultTtsModel || "gemini-2.5-flash-preview-tts").trim();
    const defaultLanguage = String(body?.defaultLanguage || "en-US").trim();
    const defaultAspectRatio = String(body?.defaultAspectRatio || "9:16").trim();

    const trainingRootFolderId = parseDriveId(trainingRootLink);
    if (!trainingRootFolderId) {
      return NextResponse.json({ error: "trainingRootLink isn't a recognizable Drive folder URL or id." }, { status: 400 });
    }
    if (!isValidVoice(defaultVoice)) {
      return NextResponse.json({ error: `Voice "${defaultVoice}" isn't a recognized Gemini voice.` }, { status: 400 });
    }
    if (defaultAspectRatio !== "9:16" && defaultAspectRatio !== "16:9") {
      return NextResponse.json({ error: "defaultAspectRatio must be '9:16' or '16:9'." }, { status: 400 });
    }

    const ctx = await loadDriveCtx();
    try {
      await verifyFolderAccess(ctx, trainingRootFolderId);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Drive folder check failed" }, { status: 400 });
    }

    const now = new Date().toISOString();
    await db.insert(trainingVideoSettings)
      .values({
        id: "default",
        trainingRootFolderId,
        defaultVoice,
        defaultTtsModel,
        defaultLanguage,
        defaultAspectRatio,
        updatedBy: session.user.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: trainingVideoSettings.id,
        set: {
          trainingRootFolderId,
          defaultVoice,
          defaultTtsModel,
          defaultLanguage,
          defaultAspectRatio,
          updatedBy: session.user.id,
          updatedAt: now,
        },
      });
    const fresh = await db.select().from(trainingVideoSettings).where(eq(trainingVideoSettings.id, "default")).limit(1);
    return NextResponse.json({ settings: fresh[0] || null });
  } catch (error: any) {
    console.error("[training-videos/settings PUT]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
