import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects as projectsTable, timelineItems as timelineItemsTable, timelineTemplates as timelineTemplatesTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, desc, or, like } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, startDate, templateId, clientProfileId, events, assignedIds } = await req.json();

    if (!name || !events || !Array.isArray(events)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const projectId = `proj_${Date.now()}`;
    const nowStr = new Date().toISOString();

    // Drizzle Transaction to ensure both project and its items are created
    const project = await db.transaction(async (tx) => {
      // 1. Create the project
      await tx.insert(projectsTable).values({
        id: projectId,
        userId: userId,
        name: name,
        companyName: name,
        clientProfileId: clientProfileId || null,
        startDate: new Date(startDate).toISOString(),
        templateId: templateId || null,
        assignedIds: assignedIds ? (Array.isArray(assignedIds) ? assignedIds.join(",") : assignedIds) : null,
        status: "active",
        createdAt: nowStr,
        updatedAt: nowStr,
      });

      // 2. Create the timeline items
      if (events.length > 0) {
        await tx.insert(timelineItemsTable).values(
          events.map((event: any, index: number) => ({
            id: `ti_${projectId}_${index}_${Math.random().toString(36).substring(7)}`,
            projectId: projectId,
            clientProfileId: clientProfileId || null,
            taskCode: event.taskCode,
            subject: event.subject,
            plannedStart: new Date(event.startDate).toISOString(),
            plannedEnd: new Date(event.endDate).toISOString(),
            durationHours: event.durationHours || 8,
            owner: event.owner || null,
            description: event.description || null,
            status: "pending",
            sortOrder: index + 1,
            createdAt: nowStr,
            updatedAt: nowStr,
          }))
        );
      }

      // Return the project summary
      const rows = await tx.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
      return rows[0];
    });

    return NextResponse.json(project);
  } catch (error: any) {
    console.error("Save Project Error:", error);
    return NextResponse.json({ error: error.message || "Failed to save project" }, { status: 500 });
  }
}

/**
 * GET /api/projects
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = session?.user?.role;
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter');

    // Visibility Logic
    // Admins see all. Owners see their own. Assigned users see assigned.
    let whereClause: any = undefined;
    
    if (filter === 'mine') {
       whereClause = eq(projectsTable.userId, userId);
    } else if (userRole !== "admin") {
       whereClause = or(
         eq(projectsTable.userId, userId),
         like(projectsTable.assignedIds, `%${userId}%`)
       );
    }

    // Drizzle select with left join
    const projects = await db.select({
      id: projectsTable.id,
      name: projectsTable.name,
      companyName: projectsTable.companyName,
      clientProfileId: projectsTable.clientProfileId,
      startDate: projectsTable.startDate,
      status: projectsTable.status,
      templateId: projectsTable.templateId,
      assignedIds: projectsTable.assignedIds,
      createdAt: projectsTable.createdAt,
      updatedAt: projectsTable.updatedAt,
      templateType: timelineTemplatesTable.type,
      templateName: timelineTemplatesTable.name
    })
    .from(projectsTable)
    .leftJoin(timelineTemplatesTable, eq(projectsTable.templateId, timelineTemplatesTable.id))
    .where(whereClause)
    .orderBy(desc(projectsTable.updatedAt));

    return NextResponse.json(projects);
  } catch (error: any) {
    console.error("Fetch Projects Error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}
