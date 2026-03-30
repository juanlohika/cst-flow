import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { computeDailyHours, CapacityRow } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = session.user.id;
    const todayDate = new Date();
    const in3Days = new Date(todayDate.getTime() + 3 * 86400000);

    // 1. Fetch all active tasks
    const allTasks = await prisma.timelineItem.findMany({
      where: { archived: false },
      include: { 
        project: { select: { id: true, name: true, companyName: true } }
      } as any,
      orderBy: { plannedStart: "asc" },
    });

    // 2. Fetch all meetings
    const allMeetings = await prisma.tarkieMeeting.findMany({
      where: { 
        status: { not: "cancelled" }
      },
      include: { 
        project: { select: { id: true, name: true, companyName: true } }
      } as any
    });

    // 3. Fetch Assignments manually via Raw SQL
    const taskIds = allTasks.map(t => t.id);
    const meetingIds = allMeetings.map(m => m.id);

    const [taskAssignments, meetingAssignments] = await Promise.all([
      taskIds.length > 0 ? prisma.$queryRawUnsafe<any[]>(`SELECT timelineItemId, userId FROM TaskAssignment WHERE timelineItemId IN (${taskIds.map(id => `'${id}'`).join(',')})`) : Promise.resolve([]),
      meetingIds.length > 0 ? prisma.$queryRawUnsafe<any[]>(`SELECT meetingId, userId FROM MeetingAssignment WHERE meetingId IN (${meetingIds.map(id => `'${id}'`).join(',')})`) : Promise.resolve([]),
    ]);

    const taskAssignMap = new Map<string, string[]>();
    taskAssignments.forEach(a => {
      if (!taskAssignMap.has(a.timelineItemId)) taskAssignMap.set(a.timelineItemId, []);
      taskAssignMap.get(a.timelineItemId)!.push(a.userId);
    });

    const meetingAssignMap = new Map<string, string[]>();
    meetingAssignments.forEach(a => {
      if (!meetingAssignMap.has(a.meetingId)) meetingAssignMap.set(a.meetingId, []);
      meetingAssignMap.get(a.meetingId)!.push(a.userId);
    });

    // 4. Convert meetings to task-like objects
    const meetingTasks = allMeetings.map(m => {
      const assignedIds = meetingAssignMap.get(m.id) || [];
      return {
        id: `mtg-${m.id}`,
        projectId: m.projectId,
        taskCode: "MEETING",
        subject: `[MTG] ${m.title}`,
        plannedStart: m.scheduledAt,
        plannedEnd: new Date(new Date(m.scheduledAt).getTime() + (m.durationMinutes || 60) * 60000),
        durationHours: (m.durationMinutes || 60) / 60,
        owner: m.facilitatorId || m.userId,
        status: (m as any).status === "completed" ? "completed" : "pending",
        archived: false,
        project: (m as any).project,
        isMeeting: true,
        isRecurringTemplate: false,
        assignments: assignedIds.map(uid => ({ userId: uid }))
      };
    });

    const combinedTasks = [
      ...allTasks.map(t => ({ ...t, assignments: (taskAssignMap.get(t.id) || []).map(uid => ({ userId: uid })) })),
      ...meetingTasks
    ];

    // 5. Explode for personal dashboard (where the user is owner or assigned)
    const personalTasks = combinedTasks.filter(t => {
      const isOwner = t.owner === userId;
      const isAssigned = (t.assignments || []).some((a: any) => a.userId === userId);
      return isOwner || isAssigned;
    });

    // 6. Metadata
    const allProjects = await prisma.project.findMany({
      where: { status: { not: "completed" } },
      select: { id: true, name: true, companyName: true },
    });

    const recentActivity = await prisma.taskHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { timelineItem: { select: { subject: true, taskCode: true, projectId: true } } },
    });

    // 7. Data shape according to DashboardData interface
    const todayFocus = personalTasks.filter(t => {
      if (!t.plannedStart || !t.plannedEnd) return false;
      const s = new Date(t.plannedStart);
      const e = new Date(t.plannedEnd);
      return s <= todayDate && e >= todayDate && t.status !== "completed";
    });

    const overdue = personalTasks.filter(t => {
      if (!t.plannedEnd || t.status === "completed") return false;
      return new Date(t.plannedEnd) < todayDate;
    });

    const approachingDeadline = personalTasks.filter(t => {
      if (!t.plannedEnd || t.status === "completed") return false;
      const e = new Date(t.plannedEnd);
      return e >= todayDate && e <= in3Days;
    });

    // 8. Heatmap (Team-wide)
    const explodedTasks: any[] = [];
    combinedTasks.forEach(task => {
      const assignedIds = (task.assignments || []).map((a: any) => a.userId);
      const involved = new Set<string>();
      if (task.owner) involved.add(task.owner);
      assignedIds.forEach((id: string) => involved.add(id));
      if (involved.size === 0) explodedTasks.push(task); 
      else involved.forEach(id => explodedTasks.push({ ...task, owner: id }));
    });

    const workloadHeatmap: any[] = [];
    const flatTasks = explodedTasks.map(t => ({
      owner: t.owner,
      plannedStart: t.plannedStart instanceof Date ? t.plannedStart.toISOString() : (t.plannedStart ?? ""),
      plannedEnd: t.plannedEnd instanceof Date ? t.plannedEnd.toISOString() : (t.plannedEnd ?? ""),
      durationHours: t.durationHours ?? 8,
      status: t.status,
      archived: t.archived,
    }));

    const teamSize = await prisma.user.count({ where: { status: "approved" } }) || 1;
    const totalTeamCapacity = teamSize * 8;

    for (let i = 0; i < 14; i++) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const dailyMap = computeDailyHours(flatTasks, d);
      let totalPlanned = 0;
      dailyMap.forEach(h => { totalPlanned += h; });
      const ratio = totalPlanned / totalTeamCapacity;
      const level = ratio > 1 ? "critical" : ratio >= 0.75 ? "warning" : "ok";
      workloadHeatmap.push({ date: dateStr, plannedHours: Math.round(totalPlanned * 10) / 10, capacity: totalTeamCapacity, level, byOwner: [] });
    }

    // 9. Project Health
    const projectHealth = allProjects.map(p => {
      const pTasks = combinedTasks.filter(t => t.projectId === p.id);
      const done = pTasks.filter(t => t.status === 'completed').length;
      const total = pTasks.length;
      const overdueProj = pTasks.filter(t => t.status !== 'completed' && t.plannedEnd && new Date(t.plannedEnd) < todayDate).length;
      
      // Calculate de facto project deadline from tasks
      let latestEnd: Date | null = null;
      pTasks.forEach(t => {
        if (!t.plannedEnd) return;
        const d = new Date(t.plannedEnd);
        if (!latestEnd || d > latestEnd) latestEnd = d;
      });

      let daysToDeadline = null;
      if (latestEnd) {
        const diff = latestEnd.getTime() - todayDate.getTime();
        daysToDeadline = Math.ceil(diff / (1000 * 60 * 60 * 24));
      }

      return {
        projectId: p.id,
        name: p.name,
        companyName: p.companyName || p.name,
        percentComplete: total > 0 ? Math.round((done / total) * 100) : 0,
        daysToDeadline,
        overdueCount: overdueProj,
        totalTasks: total
      };
    }).filter(p => p.totalTasks > 0);

    const recurringMaintenance = combinedTasks.filter(t => {
      if (!(t as any).isRecurringTemplate) return false;
      const s = new Date(t.plannedStart);
      const e = new Date(t.plannedEnd);
      return s <= todayDate && e >= todayDate;
    });

    return NextResponse.json({
      todayFocus,
      critical: {
        overdue,
        approachingDeadline
      },
      workloadHeatmap,
      projectHealth,
      recurringMaintenance,
      recentActivity
    });
  } catch (error: any) {
    console.error("Dashboard API Sync Error:", error);
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack,
      hint: "Check if TaskAssignment and MeetingAssignment tables exist and are populated correctly."
    }, { status: 500 });
  }
}
