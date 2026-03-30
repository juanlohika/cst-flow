import { NextRequest, NextResponse } from "next/server";
import { prisma as db } from "@/lib/prisma";
 
export const dynamic = "force-dynamic";

// GET /api/templates — list all templates with their tasks
export async function GET() {
  if (!db) {
    return NextResponse.json({ error: "Database not initialized." }, { status: 503 });
  }

  try {
    // Get known fields + tasks via Prisma
    const templates = await db.timelineTemplate.findMany({
      include: { tasks: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    // Merge in `type` field via raw query (field added via ALTER TABLE)
    let typeMap: Record<string, string> = {};
    try {
      const types = await db.$queryRawUnsafe<{id: string, type: string}[]>("SELECT id, type FROM TimelineTemplate");
      typeMap = Object.fromEntries(types.map(t => [t.id, t.type]));
    } catch {
      // `type` column may not exist yet — default to "project"
    }
    return NextResponse.json(templates.map(t => ({ ...t, type: typeMap[t.id] || "project" })));
  } catch (err: any) {
    console.error("Template Fetch Error:", err);
    return NextResponse.json({ 
      error: err.message, 
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
    }, { status: 500 });
  }
}

// POST /api/templates — create a new template
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, restDays, type, tasks } = body;

    const template = await db.timelineTemplate.create({
      data: {
        name,
        description: description || "",
        restDays: restDays || "Saturday,Sunday",
        tasks: {
          create: (tasks || []).map((t: any, idx: number) => ({
            taskCode: t.taskCode || `CUSTOM-${String(idx + 1).padStart(4, "0")}`,
            subject: t.subject,
            defaultDuration: t.defaultDuration || 8,
            sortOrder: idx + 1,
          })),
        },
      },
      include: { tasks: { orderBy: { sortOrder: "asc" } } },
    });

    // Set type via raw SQL (field not in generated Prisma client)
    if (type && type !== "project") {
      try {
        await db.$executeRawUnsafe("UPDATE TimelineTemplate SET type = ? WHERE id = ?", type, template.id);
      } catch {
        // `type` column may not exist — skip silently
      }
    }

    return NextResponse.json({ ...template, type: type || "project" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
