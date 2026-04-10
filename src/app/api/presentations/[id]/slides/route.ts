import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { presentationSlides, presentationBlocks } from "@/db/schema";
import { auth } from "@/auth";
import { eq, sql } from "drizzle-orm";

/**
 * POST /api/presentations/[id]/slides — add a new slide to a presentation
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { id, title, layout, order, blocks, action, slideId, ...updates } = body;
    const now = new Date().toISOString();

    // Support for slide updates in this route if needed
    if (action === "update_slide" && slideId) {
      const slideUpdates: any = { ...updates, updatedAt: now };
      await db.update(presentationSlides).set(slideUpdates).where(eq(presentationSlides.id, slideId));
      return NextResponse.json({ success: true });
    }

    // Create Slide
    const sid = id || `slide_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    
    await db.insert(presentationSlides).values({
      id: sid,
      presentationId: params.id,
      title: title || "New Slide",
      layout: layout || "content-light",
      order: order || 0,
      createdAt: now,
      updatedAt: now,
    });

    // Create Blocks if provided
    if (blocks && Array.isArray(blocks)) {
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const bid = b.id || `block_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
        
        await db.insert(presentationBlocks).values({
          id: bid,
          slideId: sid,
          order: b.order ?? i,
          blockType: b.blockType || "text",
          intelligenceMapping: b.intelligenceMapping || null,
          prompt: b.prompt || null,
          content: b.content || null,
          isAiGenerated: !!b.isAiGenerated,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return NextResponse.json({ id: sid, success: true }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/presentations/[id]/slides error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
