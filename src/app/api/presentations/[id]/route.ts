import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { presentations, presentationSlides, presentationBlocks } from "@/db/schema";
import { auth } from "@/auth";
import { eq, asc } from "drizzle-orm";

/**
 * GET /api/presentations/[id] — get a single presentation with all slides and blocks
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const pres = await db.select().from(presentations)
      .where(eq(presentations.id, params.id)).limit(1);
    
    if (pres.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Get all slides
    const slides = await db.select().from(presentationSlides)
      .where(eq(presentationSlides.presentationId, params.id))
      .orderBy(asc(presentationSlides.order));

    // Get all blocks for all slides
    const slideIds = slides.map(s => s.id);
    const allBlocks = slideIds.length > 0
      ? await db.select().from(presentationBlocks)
          .where(eq(presentationBlocks.slideId, slideIds[0]))
          .orderBy(asc(presentationBlocks.order))
      : [];

    // For multiple slides, fetch blocks per slide
    const slidesWithBlocks = await Promise.all(slides.map(async (slide) => {
      const blocks = await db.select().from(presentationBlocks)
        .where(eq(presentationBlocks.slideId, slide.id))
        .orderBy(asc(presentationBlocks.order));
      return { ...slide, blocks };
    }));

    return NextResponse.json({ ...pres[0], slides: slidesWithBlocks });
  } catch (err: any) {
    console.error("GET /api/presentations/[id] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/presentations/[id] — update presentation metadata or block content
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const now = new Date().toISOString();

    // Update presentation-level fields
    if (body.name || body.status) {
      const updates: any = { updatedAt: now };
      if (body.name) updates.name = body.name;
      if (body.status) updates.status = body.status;
      await db.update(presentations).set(updates).where(eq(presentations.id, params.id));
    }

    // Update a specific block's content
    if (body.blockId && body.content !== undefined) {
      await db.update(presentationBlocks).set({
        content: typeof body.content === "string" ? body.content : JSON.stringify(body.content),
        updatedAt: now,
      }).where(eq(presentationBlocks.id, body.blockId));
    }

    // Update slide order
    if (body.slideOrder && Array.isArray(body.slideOrder)) {
      for (let i = 0; i < body.slideOrder.length; i++) {
        await db.update(presentationSlides).set({ order: i, updatedAt: now })
          .where(eq(presentationSlides.id, body.slideOrder[i]));
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("PATCH /api/presentations/[id] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/presentations/[id] — delete a presentation (cascades slides and blocks)
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await db.delete(presentations).where(eq(presentations.id, params.id));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/presentations/[id] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
