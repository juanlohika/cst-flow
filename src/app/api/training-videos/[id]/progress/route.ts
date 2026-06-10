import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/training-videos/<id>/progress
 *
 * Polled by the UI while TTS is running. Returns the latest snapshot the
 * create/regenerate routes wrote to the ttsProgress column. The column is
 * cleared on completion, so the UI knows we're done when status flips and
 * ttsProgress is null.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db.select({
      status: trainingVideos.status,
      ttsProgress: trainingVideos.ttsProgress,
      renderStatus: trainingVideos.renderStatus,
    }).from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);

    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let progress: any = null;
    if (row.ttsProgress) {
      try { progress = JSON.parse(row.ttsProgress); } catch {}
    }

    return NextResponse.json({
      status: row.status,
      renderStatus: row.renderStatus,
      ttsProgress: progress,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
