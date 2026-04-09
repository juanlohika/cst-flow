import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { presentations, presentationSlides, presentationBlocks, presentationTemplates, clientProfiles } from "@/db/schema";
import { auth } from "@/auth";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/presentations — list all presentations (optionally filtered by accountId)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    let query = db.select().from(presentations).orderBy(desc(presentations.createdAt));
    
    if (accountId) {
      const rows = await db.select().from(presentations)
        .where(eq(presentations.clientProfileId, accountId))
        .orderBy(desc(presentations.createdAt));
      return NextResponse.json(rows);
    }

    const rows = await query;
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error("GET /api/presentations error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/presentations — create a new presentation from a template
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { name, templateId, clientProfileId } = body;

    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    // Load template if provided
    let slideDefinitions: any[] = [];
    let designSkillId: string | null = null;
    let designSnapshot: string | null = null;
    let presentationType = "custom";

    if (templateId) {
      const templates = await db.select().from(presentationTemplates)
        .where(eq(presentationTemplates.id, templateId)).limit(1);
      
      if (templates.length > 0) {
        const tmpl = templates[0];
        slideDefinitions = JSON.parse(tmpl.slideDefinitions);
        designSkillId = tmpl.designSkillId;
        presentationType = "kickoff"; // Default for the kick-off template
      }
    }

    // Load account intelligence if available
    let intelligenceSnapshot: string | null = null;
    if (clientProfileId) {
      const profiles = await db.select().from(clientProfiles)
        .where(eq(clientProfiles.id, clientProfileId)).limit(1);
      if (profiles.length > 0 && profiles[0].intelligenceContent) {
        intelligenceSnapshot = profiles[0].intelligenceContent;
      }
    }

    // Create the presentation
    const presId = `pres_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    await db.insert(presentations).values({
      id: presId,
      clientProfileId: clientProfileId || null,
      templateId: templateId || null,
      designSkillId,
      name,
      presentationType,
      status: "draft",
      intelligenceSnapshot,
      designSnapshot,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    });

    // Create slides + blocks from template
    for (const slideDef of slideDefinitions) {
      const slideId = `slide_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      
      await db.insert(presentationSlides).values({
        id: slideId,
        presentationId: presId,
        order: slideDef.order,
        title: slideDef.title,
        layout: slideDef.layout || "content-light",
        createdAt: now,
        updatedAt: now,
      });

      if (slideDef.blocks) {
        for (let bi = 0; bi < slideDef.blocks.length; bi++) {
          const blockDef = slideDef.blocks[bi];
          const blockId = `block_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
          
          await db.insert(presentationBlocks).values({
            id: blockId,
            slideId,
            order: bi,
            blockType: blockDef.blockType,
            intelligenceMapping: blockDef.intelligenceMapping || null,
            prompt: blockDef.defaultPrompt || null,
            content: blockDef.defaultContent || null,
            isAiGenerated: false,
            isLocked: false,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    // Fetch the created presentation with slides
    const created = await db.select().from(presentations).where(eq(presentations.id, presId)).limit(1);
    const slides = await db.select().from(presentationSlides)
      .where(eq(presentationSlides.presentationId, presId))
      .orderBy(presentationSlides.order);

    return NextResponse.json({ ...created[0], slides }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/presentations error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
