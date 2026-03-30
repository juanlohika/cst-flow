import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
 
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, startDate, templateId, clientProfileId, events } = await req.json();

    if (!name || !events || !Array.isArray(events)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        userId: session.user.id,
        name: name,
        companyName: name,
        clientProfileId: clientProfileId || null,
        startDate: new Date(startDate),
        templateId: templateId || null,
        status: "active",
        timelineItems: {
          create: events.map((event: any, index: number) => ({
            taskCode: event.taskCode,
            subject: event.subject,
            plannedStart: new Date(event.startDate),
            plannedEnd: new Date(event.endDate),
            durationHours: event.durationHours || 8,
            owner: event.owner || null,
            description: event.description || null,
            status: "pending",
            sortOrder: index + 1,
          })),
        },
      },
    });

    return NextResponse.json(project);
  } catch (error: any) {
    console.error("Save Project Error:", error);
    return NextResponse.json({ error: error.message || "Failed to save project" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use raw SQL to include templateType (Prisma client may not have type field regenerated)
    const projects = await prisma.$queryRawUnsafe<any[]>(`
      SELECT p.*, tt.type as templateType, tt.name as templateName
      FROM Project p
      LEFT JOIN TimelineTemplate tt ON p.templateId = tt.id
      WHERE p.userId = ?
      ORDER BY p.updatedAt DESC
    `, session.user.id);

    return NextResponse.json(projects);
  } catch (error: any) {
    console.error("Fetch Projects Error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}
