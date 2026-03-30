import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = params.id;

    // Verify account belongs to this user
    const account = await prisma.clientProfile.findFirst({
      where: { id: accountId, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const projects = await prisma.project.findMany({
      where: { clientProfileId: accountId, userId: session.user.id },
      orderBy: { startDate: "desc" },
    });

    if (projects.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch task counts separately (libsql adapter - no include)
    const projectIds = projects.map((p: any) => p.id);
    const tasks = await prisma.timelineItem.findMany({
      where: { projectId: { in: projectIds }, archived: false },
    });

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
