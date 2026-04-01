import { NextResponse } from "next/server";
import { db } from "@/db";
import { 
  timelineItems as timelineItemsTable, 
  tarkieMeetings as tarkieMeetingsTable, 
  projects as projectsTable, 
  taskHistory as taskHistoryTable, 
  users as usersTable,
  taskAssignments as taskAssignmentsTable,
  meetingAssignments as meetingAssignmentsTable
} from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, ne, asc, desc, inArray, sql, count, isNull, or, gte, lte, lt } from "drizzle-orm";
import { computeDailyHours } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

/** 
 * GET /api/dashboard — aggregated status for the landing page 
 * MIGRATED TO DRIZZLE
 */
export async function GET() {
  try {
    const session = await auth();
    const currentUserId = session?.user?.id;
    if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const todayDate = new Date();
    const todayStr = todayDate.toISOString();
    const in3Days = new Date(todayDate.getTime() + 3 * 86400000);
    const in3DaysStr = in3Days.toISOString();

    // 1. Fetch all active tasks with project info
    const allTasks = await db.select({
      id: timelineItemsTable.id,
      projectId: timelineItemsTable.projectId,
      taskCode: timelineItemsTable.taskCode,
      subject: timelineItemsTable.subject,
      plannedStart: timelineItemsTable.plannedStart,
      plannedEnd: timelineItemsTable.plannedEnd,
      durationHours: timelineItemsTable.durationHours,
      owner: timelineItemsTable.owner,
      status: timelineItemsTable.status,
      archived: timelineItemsTable.archived,
      isRecurringTemplate: timelineItemsTable.isRecurringTemplate,
      projectName: projectsTable.name,
      companyName: projectsTable.companyName
    })
    .from(timelineItemsTable)
    .leftJoin(projectsTable, eq(timelineItemsTable.projectId, projectsTable.id))
    .where(eq(timelineItemsTable.archived, false))
    .orderBy(asc(timelineItemsTable.plannedStart));

    // 2. Fetch all active meetings
    const allMeetings = await db.select({
      id: tarkieMeetingsTable.id,
      projectId: tarkieMeetingsTable.projectId,
      title: tarkieMeetingsTable.title,
      scheduledAt: tarkieMeetingsTable.scheduledAt,
      durationMinutes: tarkieMeetingsTable.durationMinutes,
      facilitatorId: tarkieMeetingsTable.facilitatorId,
      userId: tarkieMeetingsTable.userId,
      status: tarkieMeetingsTable.status,
      projectName: projectsTable.name,
      companyName: projectsTable.companyName
    })
    .from(tarkieMeetingsTable)
    .leftJoin(projectsTable, eq(tarkieMeetingsTable.projectId, projectsTable.id))
    .where(ne(tarkieMeetingsTable.status, "cancelled"));

    // 3. Fetch Assignments
    const taskIds = allTasks.map(t => t.id);
    const meetingIds = allMeetings.map(m => m.id);

    const [taskAssignments, meetingAssignments] = await Promise.all([
      taskIds.length > 0 ? db.select().from(taskAssignmentsTable).where(inArray(taskAssignmentsTable.timelineItemId, taskIds)) : Promise.resolve([]),
      meetingIds.length > 0 ? db.select().from(meetingAssignmentsTable).where(inArray(meetingAssignmentsTable.meetingId, meetingIds)) : Promise.resolve([]),
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

    // 4. Transform meetings to task-like objects
    const meetingTasks = allMeetings.map(m => {
      const assignedIds = meetingAssignMap.get(m.id) || [];
      return {
        id: `mtg-${m.id}`,
        projectId: m.projectId,
        taskCode: "MEETING",
        subject: `[MTG] ${m.title}`,
        plannedStart: m.scheduledAt,
        plannedEnd: new Date(new Date(m.scheduledAt).getTime() + (m.durationMinutes || 60) * 60000).toISOString(),
        durationHours: (m.durationMinutes || 60) / 60,
        owner: m.facilitatorId || m.userId,
        status: m.status === "completed" ? "completed" : "pending",
        archived: false,
        project: { id: m.projectId, name: m.projectName, companyName: m.companyName },
        isMeeting: true,
        isRecurringTemplate: false,
        assignments: assignedIds.map(uid => ({ userId: uid }))
      };
    });

    const combinedTasks = [
      ...allTasks.map(t => ({ 
        ...t, 
        project: { id: t.projectId, name: t.projectName, companyName: t.companyName },
        assignments: (taskAssignMap.get(t.id) || []).map(uid => ({ userId: uid })) 
      })),
      ...meetingTasks
    ];

    // 5. Personal view
    const personalTasks = combinedTasks.filter(t => {
      const isOwner = t.owner === currentUserId;
      const isAssigned = (t.assignments || []).some((a: any) => a.userId === currentUserId);
      return isOwner || isAssigned;
    });

    // 6. Metadata
    const allProjects = await db.select({
      id: projectsTable.id,
      name: projectsTable.name,
      companyName: projectsTable.companyName
    })
    .from(projectsTable)
    .where(ne(projectsTable.status, "completed"));

    const recentActivityRows = await db.select({
      id: taskHistoryTable.id,
      type: taskHistoryTable.type,
      oldValue: taskHistoryTable.oldValue,
      newValue: taskHistoryTable.newValue,
      comment: taskHistoryTable.comment,
      changedBy: taskHistoryTable.changedBy,
      createdAt: taskHistoryTable.createdAt,
      tiSubject: timelineItemsTable.subject,
      tiCode: timelineItemsTable.taskCode,
      tiProjId: timelineItemsTable.projectId
    })
    .from(taskHistoryTable)
    .leftJoin(timelineItemsTable, eq(taskHistoryTable.timelineItemId, timelineItemsTable.id))
    .orderBy(desc(taskHistoryTable.createdAt))
    .limit(20);

    const recentActivity = recentActivityRows.map(r => ({
      id: r.id,
      type: r.type,
      oldValue: r.oldValue,
      newValue: r.newValue,
      comment: r.comment,
      changedBy: r.changedBy,
      createdAt: r.createdAt,
      timelineItem: r.tiSubject ? {
        subject: r.tiSubject,
        taskCode: r.tiCode,
        projectId: r.tiProjId
      } : null
    }));

    // 7. Compute subsets
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

    // 8. Workload Heatmap
    const explodedTasks: any[] = [];
    combinedTasks.forEach(task => {
      const assignedIds = (task.assignments || []).map((a: any) => a.userId);
      const involved = new Set<string>();
      if (task.owner) involved.add(task.owner);
      assignedIds.forEach((id: string) => involved.add(id));
      if (involved.size === 0) explodedTasks.push(task); 
      else involved.forEach(id => explodedTasks.push({ ...task, owner: id }));
    });

    const flatTasks = explodedTasks.map(t => ({
      owner: t.owner,
      plannedStart: t.plannedStart,
      plannedEnd: t.plannedEnd,
      durationHours: t.durationHours ?? 8,
      status: t.status,
      archived: t.archived,
    }));

    const userCountRows = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.status, "active"));
    const teamSize = Number(userCountRows[0].count) || 1;
    const totalTeamCapacity = teamSize * 8;

    const workloadHeatmap: any[] = [];
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
      
      let latestEnd: Date | null = null;
      for (const t of pTasks) {
        if (!t.plannedEnd) continue;
        const d = new Date(t.plannedEnd);
        if (!latestEnd || d > latestEnd) latestEnd = d;
      }

      let daysToDeadline = null;
      if (latestEnd) {
        const diff = (latestEnd as Date).getTime() - todayDate.getTime();
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
      if (!t.isRecurringTemplate) return false;
      const s = new Date(t.plannedStart);
      const e = new Date(t.plannedEnd || "");
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
    console.error("Dashboard API Error:", error);
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
