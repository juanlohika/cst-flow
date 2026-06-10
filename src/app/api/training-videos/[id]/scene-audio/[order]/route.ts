import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { loadDriveCtx, downloadFile } from "@/lib/training-video/drive";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/training-videos/[id]/scene-audio/[order]
 *
 * Streams a scene's audio bytes from Drive so the browser can play it
 * inline via an <audio> tag — no need to open the Drive link in a new
 * tab. The service account JSON stays server-side; the browser just sees
 * a same-origin audio URL.
 */
export async function GET(_req: Request, { params }: { params: { id: string; order: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const order = Number(params.order);
    if (!Number.isFinite(order)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!row.scenes) return NextResponse.json({ error: "No scenes" }, { status: 404 });

    let content: TrainingVideoContent;
    try { content = JSON.parse(row.scenes); } catch { return NextResponse.json({ error: "Corrupt scenes" }, { status: 500 }); }

    const scene = content.scenes.find(s => s.order === order);
    if (!scene) return NextResponse.json({ error: "Scene not found" }, { status: 404 });
    if (!scene.audioDriveFileId) return NextResponse.json({ error: "Scene has no audio yet" }, { status: 404 });

    const ctx = await loadDriveCtx();
    const buf = await downloadFile(ctx, scene.audioDriveFileId);

    // WAV bytes go to the browser as audio/wav. We let the browser cache it
    // briefly so re-playing the same scene doesn't re-download.
    // Convert Buffer to Uint8Array so Response accepts it as BodyInit.
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename="scene_${order}.wav"`,
      },
    });
  } catch (error: any) {
    console.error("[scene-audio GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
