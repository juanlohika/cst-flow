import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { timelineItemId, title, date, startTime, endTime, allottedHours } = await req.json();

    if (!title || !date) {
      return NextResponse.json({ error: "Title and Date are required" }, { status: 400 });
    }

    const dailyTask = await prisma.dailyTask.create({
      data: {
        userId: session.user.id,
        timelineItemId: timelineItemId || null,
        title,
        date: new Date(date),
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        allottedHours: allottedHours || 1,
        status: "todo",
      },
    });

    // Optional: If this is linked to a timeline item, we could automatically mark the 
    // timeline item as "in-progress" if it's currently "pending".
    if (timelineItemId) {
        await prisma.timelineItem.update({
            where: { id: timelineItemId },
            data: { status: "in-progress" }
        });
    }

    return NextResponse.json(dailyTask);
  } catch (error: any) {
    console.error("SOD Deployment Error:", error);
    return NextResponse.json({ error: error.message || "Failed to deploy task" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    const month = searchParams.get("month");
    const year = searchParams.get("year");
    const projectId = searchParams.get("projectId");
    
    const where: any = { userId: session.user.id };
    
    if (dateStr) {
      const date = new Date(dateStr);
      where.date = {
        gte: new Date(date.setHours(0, 0, 0, 0)),
        lte: new Date(date.setHours(23, 59, 59, 999)),
      };
    } else if (month && year) {
      const start = new Date(parseInt(year), parseInt(month) - 1, 1);
      const end = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }

    if (projectId && projectId !== "ALL") {
       where.timelineItem = { projectId: projectId };
    }

    const tasks = await prisma.dailyTask.findMany({
      where,
      include: {
        timelineItem: {
          select: {
            project: {
              select: { name: true }
            }
          }
        }
      },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(tasks);
  } catch (error: any) {
    console.error("Fetch Daily Tasks Error:", error);
    return NextResponse.json({ error: "Failed to fetch daily tasks" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, status, actualHours } = await req.json();

    const updatedTask = await prisma.dailyTask.update({
      where: { id, userId: session.user.id },
      data: { 
        status,
        actualHours: actualHours || undefined,
      },
    });

    return NextResponse.json(updatedTask);
  } catch (error: any) {
    console.error("Update Daily Task Error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
