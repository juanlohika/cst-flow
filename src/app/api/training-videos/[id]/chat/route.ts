import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { trainingVideos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { refineScriptWithChat } from "@/lib/training-video/build-script";
import type { TrainingVideoContent } from "@/lib/training-video/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/training-videos/<id>/chat
 * Body: { message: string }
 *
 * Conversational refinement. Sends the current content + the new user message
 * to Gemini, persists the updated content + new message, returns the AI's
 * reply. Does NOT regenerate audio — that's a separate /regenerate-audio call.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

    const rows = await db.select().from(trainingVideos).where(eq(trainingVideos.id, params.id)).limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let currentContent: TrainingVideoContent | null = null;
    let messages: any[] = [];
    try { currentContent = row.scenes ? JSON.parse(row.scenes) : null; } catch {}
    try { messages = row.messages ? JSON.parse(row.messages) : []; } catch {}

    if (!currentContent) {
      return NextResponse.json({ error: "No script generated yet — wait for the initial generation to finish." }, { status: 400 });
    }

    const result = await refineScriptWithChat({
      userMessage: message,
      currentContent,
      language: row.language,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, rawAi: (result as any).rawAi }, { status: 500 });
    }

    // Persist conversation + updated content (if changed)
    const newMessages = [
      ...messages,
      { role: "user", content: message },
      { role: "assistant", content: result.reply || "" },
    ];
    const updates: any = {
      messages: JSON.stringify(newMessages),
      updatedAt: new Date().toISOString(),
    };
    let updatedContent = currentContent;
    if (result.content) {
      updatedContent = result.content;
      updates.scenes = JSON.stringify(result.content);
      if (result.content.title && result.content.title !== row.title) {
        updates.title = result.content.title;
      }
    }
    await db.update(trainingVideos).set(updates).where(eq(trainingVideos.id, params.id));

    return NextResponse.json({
      reply: result.reply || "",
      content: updatedContent,
    });
  } catch (error: any) {
    console.error("[training-videos/[id]/chat POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
