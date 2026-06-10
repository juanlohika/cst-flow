import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/training-videos/upload-finalize-source
 * body: { videoId, driveFileId }
 *
 * Records the Drive file id the browser just uploaded to and flips status
 * to "source-uploaded". DOES NOT run any pipeline work — that's split into
 * separate stages (extract-source → generate-script → generate-scene-audio)
 * each as its own HTTP call so any failure is independently retryable.
 *
 * Returns in well under 1 second so we never hit Cloud Run timeouts.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const videoId = String(body?.videoId || "").trim();
    const driveFileId = String(body?.driveFileId || "").trim();
    if (!videoId || !driveFileId) {
      return NextResponse.json({ error: "videoId and driveFileId required" }, { status: 400 });
    }

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, videoId)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Video row not found" }, { status: 404 });

    await db.update(trainingVideos)
      .set({
        sourceDriveFileId: driveFileId,
        status: "source-uploaded",
        errorMessage: null,
        errorStage: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trainingVideos.id, videoId));

    return NextResponse.json({ videoId, status: "source-uploaded" });
  } catch (error: any) {
    console.error("[training-videos/upload-finalize-source POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
