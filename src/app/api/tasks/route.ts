import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { materializeRecurringInstances, detectConflicts, computeDailyHours, detectOverload } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const showArchived = searchParams.get("showArchived") === "true";
    const windowStart = searchParams.get("windowStart");
    const windowEnd = searchParams.get("windowEnd");
    const includeConflicts = searchParams.get("includeConflicts") === "true";
    const includeOverload = searchParams.get("includeOverload") === "true";

    const where: any = { archived: showArchived };
    if (projectId && projectId !== "ALL") where.projectId = projectId;

    // 1. Fetch EVERYTHING flat
    const allItems = await prisma.timelineItem.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, companyName: true } },
      } as any,
      orderBy: { sortOrder: "asc" },
    });

    // Fetch meetings and convert to task-like objects
    const allMeetings = await prisma.tarkieMeeting.findMany({
      where: {
        status: { not: "cancelled" },
        ...(projectId && projectId !== "ALL" ? { projectId } : {})
      },
      include: { project: { select: { id: true, name: true, companyName: true } } }
    });

    // 2. Fetch Assignments manually via Raw SQL (Prisma client out-of-sync)
    const taskIds = allItems.map(i => i.id);
    const meetingIds = allMeetings.map(m => m.id);

    const [taskAssignments, meetingAssignments, users] = await Promise.all([
      taskIds.length > 0 ? prisma.$queryRawUnsafe<any[]>(`SELECT * FROM TaskAssignment WHERE timelineItemId IN (${taskIds.map(id => `'${id}'`).join(',')})`) : Promise.resolve([]),
      meetingIds.length > 0 ? prisma.$queryRawUnsafe<any[]>(`SELECT * FROM MeetingAssignment WHERE meetingId IN (${meetingIds.map(id => `'${id}'`).join(',')})`) : Promise.resolve([]),
      prisma.user.findMany({ select: { id: true, name: true, email: true, image: true } })
    ]);

    const userMap = new Map(users.map(u => [u.id, u]));
    const taskAssignMap = new Map<string, any[]>();
    taskAssignments.forEach(a => {
      const u = userMap.get(a.userId);
      if (u) {
        if (!taskAssignMap.has(a.timelineItemId)) taskAssignMap.set(a.timelineItemId, []);
        taskAssignMap.get(a.timelineItemId)!.push({ id: a.id, userId: a.userId, user: u });
      }
    });

    const meetingAssignMap = new Map<string, any[]>();
    meetingAssignments.forEach(a => {
      const u = userMap.get(a.userId);
      if (u) {
        if (!meetingAssignMap.has(a.meetingId)) meetingAssignMap.set(a.meetingId, []);
        meetingAssignMap.get(a.meetingId)!.push({ id: a.id, userId: a.userId, user: u });
      }
    });

    const meetingItems = allMeetings.map(m => {
      const start = new Date(m.scheduledAt);
      return {
        id: `mtg-${m.id}`,
        projectId: m.projectId,
        taskCode: "MEETING",
        subject: `[MTG] ${m.title}`,
        plannedStart: start,
        plannedEnd: new Date(start.getTime() + (m.durationMinutes || 60) * 60000),
        durationHours: (m.durationMinutes || 60) / 60,
        owner: m.facilitatorId || m.userId,
        status: m.status === "completed" ? "completed" : "pending",
        archived: false,
        project: m.project,
        isMeeting: true,
        assignments: meetingAssignMap.get(m.id) || []
      };
    });

    // 3. Materialize recurring instances
    let allItemsWithVirtual: any[] = [...allItems, ...meetingItems];
    if (windowStart && windowEnd) {
      const wStart = new Date(windowStart);
      const wEnd = new Date(windowEnd);
      const templates = allItems.filter(i => i.isRecurringTemplate);
      const instanceDatesByTemplate = new Map<string, Set<string>>();
      allItems.forEach(i => {
        if (i.recurringParentId && i.plannedStart) {
          if (!instanceDatesByTemplate.has(i.recurringParentId)) instanceDatesByTemplate.set(i.recurringParentId, new Set());
          instanceDatesByTemplate.get(i.recurringParentId)!.add(new Date(i.plannedStart).toISOString().split("T")[0]);
        }
      });
      for (const template of templates) {
        if (!template.recurringFrequency) continue;
        const virtual = materializeRecurringInstances(
          {
            ...template,
            plannedStart: template.plannedStart?.toISOString() ?? "",
            plannedEnd: template.plannedEnd?.toISOString() ?? "",
            recurringFrequency: template.recurringFrequency!,
            recurringUntil: template.recurringUntil ?? null,
            project: (template as any).project ? { id: (template as any).projectId, ...(template as any).project } : undefined,
          },
          wStart,
          wEnd,
          instanceDatesByTemplate.get(template.id) ?? new Set()
        );
        allItemsWithVirtual = [...allItemsWithVirtual, ...virtual];
      }
    }

    // 4. Attach conflict info
    const conflictMap = new Map<string, any>();
    if (includeConflicts) {
      const conflicts = detectConflicts(allItemsWithVirtual.map(i => ({
        id: i.id, owner: i.owner,
        plannedStart: i.plannedStart instanceof Date ? i.plannedStart.toISOString() : (i.plannedStart ?? ""),
        plannedEnd: i.plannedEnd instanceof Date ? i.plannedEnd.toISOString() : (i.plannedEnd ?? ""),
        archived: i.archived ?? false, status: i.status ?? "pending",
      })));
      conflicts.forEach(c => {
        if (!conflictMap.has(c.taskId)) conflictMap.set(c.taskId, []);
        conflictMap.get(c.taskId).push(c);
      });
    }

    // 5. Manual Kanban & Client Data linking
    const extraDataMap = new Map<string, any>();
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, kanbanLaneId, clientProfileId FROM TimelineItem`
      );
      rows.forEach(r => extraDataMap.set(r.id, { k: r.kanbanLaneId, c: r.clientProfileId }));
    } catch {}

    // 6. Build Tree
    const itemMap = new Map();
    allItemsWithVirtual.forEach(item => {
      const extra = extraDataMap.get(item.id);
      itemMap.set(item.id, {
        ...item,
        kanbanLaneId: extra?.k ?? item.kanbanLaneId ?? null,
        clientProfileId: extra?.c ?? item.clientProfileId ?? null,
        assignments: taskAssignMap.get(item.id) || (item.assignments || []),
        subtasks: [],
        conflictInfo: conflictMap.get(item.id) || []
      });
    });

    const rootItems: any[] = [];
    itemMap.forEach(item => {
      if (item.parentId && itemMap.has(item.parentId)) itemMap.get(item.parentId).subtasks.push(item);
      else rootItems.push(item);
    });

    return NextResponse.json(rootItems);
  } catch (error: any) {
    console.error("GET Tasks Crash:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { projectId, subject, plannedStart, plannedEnd, owner, parentId, durationHours, assignedIds } = body;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { companyName: true, clientProfileId: true }
    });

    const prefix = project?.companyName 
      ? project.companyName.split(" ")[0].replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase()
      : "GEN";

    const taskCode = `TASK-${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    // Insertion via Raw SQL
    await prisma.$executeRawUnsafe(
      `INSERT INTO TimelineItem (
        id, projectId, clientProfileId, taskCode, subject, plannedStart, plannedEnd, 
        parentId, owner, status, durationHours, sortOrder, archived, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      taskId,
      projectId,
      project?.clientProfileId || null,
      taskCode,
      subject || "Untitled Task",
      new Date(plannedStart).toISOString(),
      new Date(plannedEnd).toISOString(),
      parentId || null,
      owner || null,
      'pending',
      durationHours ?? 8,
      0,
      0,
      now,
      now
    );

    if (assignedIds && Array.isArray(assignedIds)) {
      for (const uid of assignedIds) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO TaskAssignment (id, timelineItemId, userId) VALUES (?, ?, ?)`,
          `asgn_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          taskId,
          uid
        );
      }
    }

    if (parentId) {
      try {
        const childStartISO = new Date(plannedStart).toISOString();
        const childEndISO = new Date(plannedEnd).toISOString();
        await prisma.$executeRawUnsafe(
          `UPDATE TimelineItem
           SET "plannedStart" = MIN(COALESCE("plannedStart", ?), ?),
               "plannedEnd"   = MAX(COALESCE("plannedEnd",   ?), ?)
           WHERE id = ?`,
          childStartISO, childStartISO, childEndISO, childEndISO, parentId
        );
      } catch {}
    }

    return NextResponse.json({ id: taskId, taskCode, subject });
  } catch (error: any) {
    console.error("POST Tasks Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { id, comment, assignedIds, ...rawUpdate } = body;

    const current = await prisma.timelineItem.findUnique({ where: { id } });
    if (!current) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const ALLOWED = ["subject","owner","description","status","plannedStart","plannedEnd","actualStart","actualEnd","archived","sortOrder","durationHours","recurringFrequency","recurringUntil","isRecurringTemplate","kanbanLaneId"];
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const key of ALLOWED) {
      if (!(key in rawUpdate) || rawUpdate[key] === undefined) continue;
      let val = rawUpdate[key];
      if (["plannedStart","plannedEnd","actualStart","actualEnd"].includes(key) && val) {
        val = new Date(val).toISOString().replace("T", " ").replace("Z", "");
      }
      setClauses.push(`"${key}" = ?`);
      values.push(val);
    }

    if (setClauses.length > 0) {
      values.push(id);
      await prisma.$executeRawUnsafe(`UPDATE TimelineItem SET ${setClauses.join(", ")} WHERE id = ?`, ...values);
    }

    if (assignedIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM TaskAssignment WHERE timelineItemId = ?`, id);
      for (const uid of assignedIds) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO TaskAssignment (id, timelineItemId, userId) VALUES (?, ?, ?)`,
          `asgn_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          id, uid
        );
      }
    }

    if (current.parentId && (rawUpdate.plannedStart || rawUpdate.plannedEnd)) {
      try {
        const s = rawUpdate.plannedStart ? new Date(rawUpdate.plannedStart).toISOString() : null;
        const e = rawUpdate.plannedEnd ? new Date(rawUpdate.plannedEnd).toISOString() : null;
        if (s && e) {
          await prisma.$executeRawUnsafe(
            `UPDATE TimelineItem SET "plannedStart" = MIN(COALESCE("plannedStart", ?), ?), "plannedEnd" = MAX(COALESCE("plannedEnd", ?), ?) WHERE id = ?`,
            s, s, e, e, current.parentId
          );
        }
      } catch {}
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH Tasks Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
