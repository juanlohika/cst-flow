import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects as projectsTable, timelineItems as timelineItemsTable, projectStakeholders } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/share/[token]?email=...
 * Public access point for Client Portal data.
 * No Auth required, but validates the shareToken AND the requestor's email
 * against the registered projectStakeholders for this project.
 */
export async function GET(
  req: Request,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;
    if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email")?.toLowerCase().trim();
    const peek = searchParams.get("peek") === "true";

    // 1. Fetch Project by Share Token
    const projects = await db.select().from(projectsTable).where(eq(projectsTable.shareToken, token)).limit(1);
    const project = projects[0];

    if (!project) {
      return NextResponse.json({ error: "Project not found or link expired" }, { status: 404 });
    }

    // Peek mode: return only project name (for lock screen display)
    if (peek) {
      return NextResponse.json({ name: project.name, companyName: project.companyName });
    }

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    // 2. Validate email against registered stakeholders
    const stakeholders = await db
      .select()
      .from(projectStakeholders)
      .where(eq(projectStakeholders.projectId, project.id));

    const isRegistered = stakeholders.some(
      (s) => s.email?.toLowerCase().trim() === email
    );

    if (!isRegistered) {
      return NextResponse.json(
        { error: "This email is not registered as a stakeholder for this project." },
        { status: 403 }
      );
    }

    // 3. Fetch Timeline Items (Tasks)
    const tasks = await db.select()
      .from(timelineItemsTable)
      .where(eq(timelineItemsTable.projectId, project.id))
      .orderBy(asc(timelineItemsTable.sortOrder));

    // 4. Map: project the PADDED dates as the primary dates for clients
    const clientData = {
      id: project.id,
      name: project.name,
      companyName: project.companyName,
      startDate: project.startDate,
      status: project.status,
      tasks: tasks.map((t) => ({
        id: t.id,
        taskCode: t.taskCode,
        subject: t.subject,
        startDate: t.plannedStart,
        plannedEnd: t.externalPlannedEnd || t.plannedEnd,
        status: t.status,
        owner: t.owner || "Team",
        actualStart: t.actualStart,
        actualEnd: t.actualEnd,
      })),
    };

    return NextResponse.json(clientData);
  } catch (error: any) {
    console.error("[api/share] Error:", error);
    return NextResponse.json({ error: "Failed to load project details" }, { status: 500 });
  }
}
