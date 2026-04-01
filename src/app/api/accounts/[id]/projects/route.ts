import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable, projects as projectsTable, timelineItems as timelineItemsTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/projects
 * MIGRATED TO DRIZZLE
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = params.id;

    // Check account exists
    const accountRows = await db.select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, accountId))
      .limit(1);
      
    if (accountRows.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const projects = await db.select()
      .from(projectsTable)
      .where(eq(projectsTable.clientProfileId, accountId))
      .orderBy(desc(projectsTable.startDate));

    if (projects.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch task counts
    const projectIds = projects.map((p: any) => p.id);
    const tasks = await db.select()
      .from(timelineItemsTable)
      .where(and(
        inArray(timelineItemsTable.projectId, projectIds),
        eq(timelineItemsTable.archived, false)
      ));

    const tasksByProject: Record<string, any[]> = {};
    for (const t of tasks) {
      if (!tasksByProject[t.projectId]) tasksByProject[t.projectId] = [];
      tasksByProject[t.projectId].push(t);
    }

    const result = projects.map((p: any) => {
      const projectTasks = tasksByProject[p.id] || [];
      return {
        ...p,
        taskCount: projectTasks.length,
        taskSummary: {
          pending: projectTasks.filter((t: any) => t.status === "pending").length,
          inProgress: projectTasks.filter((t: any) => t.status === "in-progress").length,
          completed: projectTasks.filter((t: any) => t.status === "completed").length,
        },
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Account projects error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch projects" }, { status: 500 });
  }
}
