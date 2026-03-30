import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/**
 * GET /api/accounts/[id]/tasks
 * Fetches all tasks related to a client profile (account), including:
 * 1. Tasks directly linked to the clientProfileId (account-level items)
 * 2. Tasks linked via projects belonging to the clientProfileId
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: accountId } = params;

    // 1. Fetch all project IDs belonging to this account
    const projects = await prisma.project.findMany({
      where: { clientProfileId: accountId },
      select: { id: true, name: true }
    });
    const projectIds = projects.map(p => p.id);

    // 2. Fetch all TimelineItems (tasks) for this account (direct link OR through project)
    // We cast to any for includes because of recent schema changes
    const tasks = await prisma.timelineItem.findMany({
      where: {
        OR: [
          { clientProfileId: accountId },
          { projectId: { in: projectIds } }
        ],
        archived: false
      },
      include: {
        project: { select: { name: true } },
        assignments: { 
          include: { 
            user: { select: { id: true, name: true, image: true, email: true } } 
          } 
        }
      } as any,
      orderBy: { createdAt: "desc" }
    });

    // 3. Map to the structure expected by the AccountHub frontend
    // The frontend expects: title, project (obj), assignedUser (obj), due (date), status
    const mappedTasks = tasks.map((t: any) => ({
      id: t.id,
      title: t.subject,
      status: t.status,
      due: t.plannedEnd,
      project: t.project,
      // For legacy UI support while transition to multi-assignee is final,
      // we pick the first assignee if available
      assignedUser: t.assignments?.[0]?.user || null,
      tempOwner: t.owner,
      assignments: t.assignments
    }));

    return NextResponse.json(mappedTasks);
  } catch (error: any) {
    console.error("error fetching account tasks:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
