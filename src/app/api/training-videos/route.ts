import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/training-videos
 * Lists training videos (newest first). No filtering for v1.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db.select({
      id: trainingVideos.id,
      title: trainingVideos.title,
      status: trainingVideos.status,
      voice: trainingVideos.voice,
      aspectRatio: trainingVideos.aspectRatio,
      generatedAt: trainingVideos.generatedAt,
      updatedAt: trainingVideos.updatedAt,
    })
      .from(trainingVideos)
      .orderBy(desc(trainingVideos.updatedAt))
      .limit(50);

    return NextResponse.json({ videos: rows });
  } catch (error: any) {
    console.error("[training-videos GET]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
