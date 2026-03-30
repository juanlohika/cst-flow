import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meetingId = params.id;
    const body = await req.json();
    const { tasks, projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required to commit tasks" }, { status: 400 });
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return NextResponse.json({ error: "No tasks to commit" }, { status: 400 });
    }

    const meeting = await prisma.tarkieMeeting.findUnique({
      where: { id: meetingId },
      include: { project: { include: { clientProfile: true } } }
    });

    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    const companyName = meeting.project?.clientProfile?.companyName || meeting.project?.companyName || "GEN";
    const prefix = companyName.split(" ")[0].replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();

    const taskCodes = [];
    for (const task of tasks) {
      const ps = task.plannedStart ? new Date(task.plannedStart) : new Date();
      const pe = task.plannedEnd ? new Date(task.plannedEnd) : new Date(ps.getTime() + 3600000);
      const diffMs = pe.getTime() - ps.getTime();
      const durationHours = Math.max(0.25, Math.round((diffMs / 3600000) * 100) / 100);

      const numericPart = Math.floor(100000 + Math.random() * 900000);
      const taskCode = `TASK-${prefix}-${numericPart}`;
      const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

      // Use standard Prisma Client create calls for better reliability
      await prisma.timelineItem.create({
        data: {
          id: taskId,
          projectId,
          clientProfileId: meeting.clientProfileId || null,
          taskCode,
          subject: task.title || "Untitled Task",
          plannedStart: ps,
          plannedEnd: pe,
          status: 'pending',
          durationHours,
          sortOrder: 0,
          archived: false
        }
      });

      // Handle multi-assignees
      if (task.assignedIds && Array.isArray(task.assignedIds)) {
        for (const uid of task.assignedIds) {
          await prisma.taskAssignment.create({
            data: {
              id: `asgn_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
              timelineItemId: taskId,
              userId: uid,
            }
          });
        }
      }

      taskCodes.push(taskCode);
    }

    return NextResponse.json({ success: true, count: tasks.length, codes: taskCodes });
  } catch (error: any) {
    console.error("Task commit error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to commit tasks" },
      { status: 500 }
    );
  }
}
