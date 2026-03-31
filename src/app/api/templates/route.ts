import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { 
  timelineTemplates as timelineTemplatesTable, 
  templateTasks as templateTasksTable 
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** 
 * GET /api/templates — list all templates with their tasks 
 * MIGRATED TO DRIZZLE
 */
export async function GET() {
  try {
    const templates = await db.select().from(timelineTemplatesTable).orderBy(asc(timelineTemplatesTable.createdAt));
    const allTasks = await db.select().from(templateTasksTable).orderBy(asc(templateTasksTable.sortOrder));

    const results = templates.map(t => ({
      ...t,
      tasks: allTasks.filter(task => task.templateId === t.id)
    }));

    return NextResponse.json(results);
  } catch (err: any) {
    console.error("Template Fetch Error:", err);
    return NextResponse.json({ 
      error: err.message, 
      hint: "Run /api/auth/config to repair the database schema.",
      stack: err.stack 
    }, { status: 500 });
  }
}

/** 
 * POST /api/templates — create a new template 
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, restDays, type, tasks } = body;

    const templateId = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      await tx.insert(timelineTemplatesTable).values({
        id: templateId,
        name,
        description: description || "",
        restDays: restDays || "Saturday,Sunday",
        type: type || "project",
        createdAt: now,
        updatedAt: now
      });

      if (tasks && tasks.length > 0) {
        const taskValues = tasks.map((t: any, idx: number) => ({
          id: `tpt_${templateId}_${idx}`,
          templateId,
          taskCode: t.taskCode || `CUSTOM-${String(idx + 1).padStart(4, "0")}`,
          subject: t.subject,
          defaultDuration: t.defaultDuration || 8,
          sortOrder: idx + 1,
        }));
        await tx.insert(templateTasksTable).values(taskValues);
      }
    });

    const rows = await db.select().from(timelineTemplatesTable).where(eq(timelineTemplatesTable.id, templateId)).limit(1);
    const resultTasks = await db.select().from(templateTasksTable).where(eq(templateTasksTable.templateId, templateId)).orderBy(asc(templateTasksTable.sortOrder));

    return NextResponse.json({ ...rows[0], tasks: resultTasks });
  } catch (err: any) {
    console.error("Template Create Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
