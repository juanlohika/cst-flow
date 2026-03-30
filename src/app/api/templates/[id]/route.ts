import { NextRequest, NextResponse } from "next/server";
import { prisma as db } from "@/lib/prisma";

// GET /api/templates/[id] — get a single template with tasks
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const template = await db.timelineTemplate.findUnique({
      where: { id: params.id },
      include: { tasks: { orderBy: { sortOrder: "asc" } } },
    });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(template);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/templates/[id] — update a template and its tasks
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { name, description, restDays, type, tasks } = body;

    await db.timelineTemplate.update({
      where: { id: params.id },
      data: { name, description, restDays },
    });

    // Update type via raw SQL (field not in generated Prisma client)
    try {
      await db.$executeRawUnsafe("UPDATE TimelineTemplate SET type = ? WHERE id = ?", type || "project", params.id);
    } catch {
      // `type` column may not exist — skip silently
    }

    if (tasks) {
      await db.templateTask.deleteMany({ where: { templateId: params.id } });
      await db.templateTask.createMany({
        data: tasks.map((t: any, idx: number) => ({
          templateId: params.id,
          taskCode: t.taskCode || `CUSTOM-${String(idx + 1).padStart(4, "0")}`,
          subject: t.subject,
          defaultDuration: t.defaultDuration || 8,
          sortOrder: idx + 1,
        })),
      });
    }

    const updated = await db.timelineTemplate.findUnique({
      where: { id: params.id },
      include: { tasks: { orderBy: { sortOrder: "asc" } } },
    });

    return NextResponse.json({ ...updated, type: type || "project" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/templates/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await db.templateTask.deleteMany({ where: { templateId: params.id } });
    await db.timelineTemplate.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
