import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function periodRange(period: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  if (period === "daily") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const label = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return { start, end, label };
  }
  if (period === "week") {
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day; // start on Monday
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(now.getDate() + diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
  }
  // month
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const label = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, label };
}

/** Compute actual hours from timestamps (calendar hours), fallback to durationHours for completed tasks */
function actualHours(task: any): number {
  if (task.actualStart && task.actualEnd) {
    const ms = new Date(task.actualEnd).getTime() - new Date(task.actualStart).getTime();
    const h = ms / 3600000;
    // sanity cap: no more than 3× the budget (handles bad data)
    return Math.min(Math.max(h, 0), (task.durationHours ?? 8) * 3);
  }
  // completed but no actual timestamps → use budget as proxy
  if (task.status === "completed") return task.durationHours ?? 8;
  return 0;
}

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "month";
    const { start, end, label } = periodRange(period);

    // Active projects for this user
    const projects = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, companyName FROM Project WHERE status = 'active' AND userId = ? ORDER BY name ASC`,
      session.user.id
    );

    if (!projects.length) {
      return NextResponse.json({
        period: { start: start.toISOString(), end: end.toISOString(), label },
        byProject: [],
        byOwner: [],
      });
    }

    const projectIds = projects.map((p: any) => p.id);
    const ph = projectIds.map(() => "?").join(",");

    // Tasks overlapping with the period (not archived, not recurring templates)
    const tasks = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, projectId, status, owner, durationHours, actualStart, actualEnd, plannedStart, plannedEnd, kanbanLaneId
       FROM TimelineItem
       WHERE projectId IN (${ph})
         AND archived = 0
         AND isRecurringTemplate = 0
         AND plannedStart IS NOT NULL
         AND plannedEnd IS NOT NULL
         AND plannedStart <= ?
         AND plannedEnd >= ?`,
      ...projectIds, end.toISOString(), start.toISOString()
    );

    // DailyTask allotted/actual hours for tasks in this period
    const taskIds = tasks.map((t: any) => t.id);
    let dailyTaskTotals: any[] = [];
    if (taskIds.length) {
      const tph = taskIds.map(() => "?").join(",");
      dailyTaskTotals = await prisma.$queryRawUnsafe<any[]>(
        `SELECT timelineItemId,
                SUM(allottedHours) as totalAllotted,
                SUM(COALESCE(actualHours, 0)) as totalActual
         FROM DailyTask
         WHERE timelineItemId IN (${tph})
           AND date >= ?
           AND date <= ?
         GROUP BY timelineItemId`,
        ...taskIds, start.toISOString(), end.toISOString()
      );
    }
    const allottedByTask = new Map<string, { allotted: number; actual: number }>();
    for (const r of dailyTaskTotals) {
      allottedByTask.set(r.timelineItemId, {
        allotted: r.totalAllotted ?? 0,
        actual: r.totalActual ?? 0,
      });
    }

    // Kanban boards + lanes for all active projects
    const boards = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, projectId FROM KanbanBoard WHERE projectId IN (${ph})`,
      ...projectIds
    );

    let lanes: any[] = [];
    if (boards.length) {
      const boardIds = boards.map((b: any) => b.id);
      const lph = boardIds.map(() => "?").join(",");
      lanes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, boardId, name, mappedStatus, color, position FROM KanbanLane WHERE boardId IN (${lph}) ORDER BY position ASC`,
        ...boardIds
      );
    }

    // Map projectId → lanes
    const lanesByProject = new Map<string, any[]>();
    boards.forEach((b: any) => {
      lanesByProject.set(b.projectId, lanes.filter(l => l.boardId === b.id));
    });

    // ── Per-project aggregation ──
    const byProject = projects
      .map((project: any) => {
        const ptasks = tasks.filter((t: any) => t.projectId === project.id);
        if (!ptasks.length) return null;

        const projectLanes = lanesByProject.get(project.id) ?? [];
        let budget = 0, logged = 0, remaining = 0, allotted = 0, eodActual = 0;
        const laneCount = new Map<string, number>();

        for (const t of ptasks) {
          const dh = t.durationHours ?? 8;
          budget += dh;
          if (t.status === "completed") {
            logged += actualHours(t);
          } else {
            remaining += dh;
          }
          const dt = allottedByTask.get(t.id);
          if (dt) { allotted += dt.allotted; eodActual += dt.actual; }

          // Kanban placement
          const laneKey = t.kanbanLaneId
            ?? projectLanes.find((l: any) => l.mappedStatus === t.status)?.id
            ?? null;
          if (laneKey) laneCount.set(laneKey, (laneCount.get(laneKey) ?? 0) + 1);
        }

        const forecast = logged + remaining;
        const variance = budget - forecast; // positive = under budget

        const kanban = projectLanes.map((l: any) => ({
          laneId: l.id,
          laneName: l.name,
          mappedStatus: l.mappedStatus,
          color: l.color ?? "#64748b",
          count: laneCount.get(l.id) ?? 0,
        }));

        return {
          projectId: project.id,
          name: project.name,
          companyName: project.companyName,
          budget: Math.round(budget * 10) / 10,
          logged: Math.round(logged * 10) / 10,
          remaining: Math.round(remaining * 10) / 10,
          forecast: Math.round(forecast * 10) / 10,
          variance: Math.round(variance * 10) / 10,
          allotted: Math.round(allotted * 10) / 10,
          eodActual: Math.round(eodActual * 10) / 10,
          taskCount: ptasks.length,
          completedCount: ptasks.filter((t: any) => t.status === "completed").length,
          kanban,
          hasBoard: projectLanes.length > 0,
        };
      })
      .filter(Boolean);

    // ── Per-owner aggregation ──
    const ownerMap = new Map<string, { budget: number; logged: number; remaining: number; allotted: number; eodActual: number; projects: Map<string, any> }>();
    for (const t of tasks) {
      const owner = t.owner ?? "Unassigned";
      if (!ownerMap.has(owner)) ownerMap.set(owner, { budget: 0, logged: 0, remaining: 0, allotted: 0, eodActual: 0, projects: new Map() });
      const o = ownerMap.get(owner)!;
      
      if (!o.projects.has(t.projectId)) {
        o.projects.set(t.projectId, {
          projectId: t.projectId,
          projectName: projects.find((p: any) => p.id === t.projectId)?.name || "Unknown Project",
          budget: 0, logged: 0, remaining: 0
        });
      }
      const op = o.projects.get(t.projectId)!;

      const dh = t.durationHours ?? 8;
      o.budget += dh;
      op.budget += dh;

      if (t.status === "completed") {
        const actual = actualHours(t);
        o.logged += actual;
        op.logged += actual;
      } else {
        o.remaining += dh;
        op.remaining += dh;
      }
      const dt = allottedByTask.get(t.id);
      if (dt) { o.allotted += dt.allotted; o.eodActual += dt.actual; }
    }

    const byOwner = Array.from(ownerMap.entries())
      .map(([owner, m]) => ({
        owner,
        budget: Math.round(m.budget * 10) / 10,
        logged: Math.round(m.logged * 10) / 10,
        remaining: Math.round(m.remaining * 10) / 10,
        forecast: Math.round((m.logged + m.remaining) * 10) / 10,
        variance: Math.round((m.budget - m.logged - m.remaining) * 10) / 10,
        allotted: Math.round(m.allotted * 10) / 10,
        eodActual: Math.round(m.eodActual * 10) / 10,
        projects: Array.from(m.projects.values()).map(p => ({
          ...p,
          budget: Math.round(p.budget * 10) / 10,
          logged: Math.round(p.logged * 10) / 10,
          remaining: Math.round(p.remaining * 10) / 10,
          forecast: Math.round((p.logged + p.remaining) * 10) / 10,
          variance: Math.round((p.budget - p.logged - p.remaining) * 10) / 10,
        })).sort((a, b) => b.budget - a.budget)
      }))
      .sort((a, b) => b.budget - a.budget);

    return NextResponse.json({
      period: { start: start.toISOString(), end: end.toISOString(), label },
      byProject,
      byOwner,
    });
  } catch (error: any) {
    console.error("GET /api/dashboard/effort error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
