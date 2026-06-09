import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/training-videos/<id>/scenes/<order>
 * Body: { narrationScript?: string, title?: string, caption?: string }
 *
 * Edits a single scene's text without re-running AI. Marks scene as edited.
 * Audio is NOT regenerated automatically — caller must hit
 * /api/training-videos/<id>/regenerate-audio with sceneOrder afterward.
 */
export async function PATCH(req: Request, { params }: { params: { id: string; order: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const order = Number(params.order);
    if (!order || isNaN(order)) return NextResponse.json({ error: "Invalid scene order" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const narrationScript: string | undefined = typeof body?.narrationScript === "string" ? body.narrationScript : undefined;
    const title: string | undefined = typeof body?.title === "string" ? body.title : undefined;
    const caption: string | undefined = typeof body?.caption === "string" ? body.caption : undefined;
    if (narrationScript === undefined && title === undefined && caption === undefined) {
      return NextResponse.json({ error: "Nothing to update — provide narrationScript, title, or caption" }, { status: 400 });
    }

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let content: TrainingVideoContent | null = null;
    try { content = row.scenes ? JSON.parse(row.scenes) : null; } catch {}
    if (!content) return NextResponse.json({ error: "No script to edit" }, { status: 400 });

    const idx = content.scenes.findIndex(s => s.order === order);
    if (idx === -1) return NextResponse.json({ error: `Scene ${order} not found` }, { status: 404 });

    if (narrationScript !== undefined) {
      content.scenes[idx].narrationScript = narrationScript.trim();
      // For v1, caption mirrors narrationScript unless explicitly set
      if (caption === undefined) content.scenes[idx].caption = narrationScript.trim();
      content.scenes[idx].edited = true;
      // Existing audio is now stale relative to the new script
      content.scenes[idx].audioDriveFileId = null;
      content.scenes[idx].audioDriveUrl = null;
      content.scenes[idx].audioDurationSec = null;
    }
    if (title !== undefined) {
      content.scenes[idx].title = title.trim();
    }
    if (caption !== undefined) {
      content.scenes[idx].caption = caption.trim();
    }

    await db.update(trainingVideos)
      .set({
        scenes: JSON.stringify(content),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trainingVideos.id, params.id));

    return NextResponse.json({ scene: content.scenes[idx], content });
  } catch (error: any) {
    console.error("[training-videos/scenes PATCH]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
