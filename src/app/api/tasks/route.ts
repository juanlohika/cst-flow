import { NextResponse } from "next/server";
import { db } from "@/db";
import { 
  timelineItems as timelineItemsTable, 
  tarkieMeetings as tarkieMeetingsTable, 
  taskAssignments as taskAssignmentsTable, 
  meetingAssignments as meetingAssignmentsTable,
  users as usersTable,
  projects as projectsTable,
  clientProfiles as clientProfilesTable,
  taskHistory as taskHistoryTable
} from "@/db/schema";
import { auth } from "@/auth";
import { materializeRecurringInstances, detectConflicts } from "@/lib/scheduling";
import { eq, and, or, inArray, asc, desc, not, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks
 * MIGRATED TO DRIZZLE
 */
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

    const conditions: any[] = [eq(timelineItemsTable.archived, showArchived)];
    if (projectId && projectId !== "ALL") {
      conditions.push(eq(timelineItemsTable.projectId, projectId));
    }

    // 1. Fetch EVERYTHING flat
    const allItemsRaw = await db.select({
      id: timelineItemsTable.id,
      projectId: timelineItemsTable.projectId,
      taskCode: timelineItemsTable.taskCode,
      subject: timelineItemsTable.subject,
      plannedStart: timelineItemsTable.plannedStart,
      plannedEnd: timelineItemsTable.plannedEnd,
      actualStart: timelineItemsTable.actualStart,
      actualEnd: timelineItemsTable.actualEnd,
      durationHours: timelineItemsTable.durationHours,
      owner: timelineItemsTable.owner,
      status: timelineItemsTable.status,
      sortOrder: timelineItemsTable.sortOrder,
      archived: timelineItemsTable.archived,
      parentId: timelineItemsTable.parentId,
      isRecurringTemplate: timelineItemsTable.isRecurringTemplate,
      recurringFrequency: timelineItemsTable.recurringFrequency,
      recurringUntil: timelineItemsTable.recurringUntil,
      recurringParentId: timelineItemsTable.recurringParentId,
      kanbanLaneId: timelineItemsTable.kanbanLaneId,
      clientProfileId: timelineItemsTable.clientProfileId,
      project: {
        id: projectsTable.id,
        name: projectsTable.name,
        companyName: projectsTable.companyName,
      }
    })
    .from(timelineItemsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, timelineItemsTable.projectId))
    .where(and(...conditions))
    .orderBy(asc(timelineItemsTable.sortOrder));

    // Fetch meetings
    const meetingConditions: any[] = [not(eq(tarkieMeetingsTable.status, "cancelled"))];
    if (projectId && projectId !== "ALL") {
      meetingConditions.push(eq(tarkieMeetingsTable.projectId, projectId));
    }

    const allMeetings = await db.select({
      id: tarkieMeetingsTable.id,
      projectId: tarkieMeetingsTable.projectId,
      title: tarkieMeetingsTable.title,
      scheduledAt: tarkieMeetingsTable.scheduledAt,
      durationMinutes: tarkieMeetingsTable.durationMinutes,
      status: tarkieMeetingsTable.status,
      facilitatorId: tarkieMeetingsTable.facilitatorId,
      userId: tarkieMeetingsTable.userId,
      project: {
        id: projectsTable.id,
        name: projectsTable.name,
        companyName: projectsTable.companyName,
      }
    })
    .from(tarkieMeetingsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, tarkieMeetingsTable.projectId))
    .where(and(...meetingConditions));

    // 2. Fetch Assignments and Users
    const taskIds = allItemsRaw.map(i => i.id);
    const meetingIds = allMeetings.map(m => m.id);

    const [taskAssignments, meetingAssignments, users] = await Promise.all([
      taskIds.length > 0 
        ? db.select({
            id: taskAssignmentsTable.id,
            timelineItemId: taskAssignmentsTable.timelineItemId,
            userId: taskAssignmentsTable.userId,
            user: { id: usersTable.id, name: usersTable.name, email: usersTable.email, image: usersTable.image }
          })
          .from(taskAssignmentsTable)
          .innerJoin(usersTable, eq(usersTable.id, taskAssignmentsTable.userId))
          .where(inArray(taskAssignmentsTable.timelineItemId, taskIds))
        : Promise.resolve([]),
      meetingIds.length > 0 
        ? db.select({
            id: meetingAssignmentsTable.id,
            meetingId: meetingAssignmentsTable.meetingId,
            userId: meetingAssignmentsTable.userId,
            user: { id: usersTable.id, name: usersTable.name, email: usersTable.email, image: usersTable.image }
          })
          .from(meetingAssignmentsTable)
          .innerJoin(usersTable, eq(usersTable.id, meetingAssignmentsTable.userId))
          .where(inArray(meetingAssignmentsTable.meetingId, meetingIds))
        : Promise.resolve([]),
      db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, image: usersTable.image })
        .from(usersTable)
    ]);

    const taskAssignMap = new Map<string, any[]>();
    taskAssignments.forEach(a => {
      if (!taskAssignMap.has(a.timelineItemId)) taskAssignMap.set(a.timelineItemId, []);
      taskAssignMap.get(a.timelineItemId)!.push(a);
    });

    const meetingAssignMap = new Map<string, any[]>();
    meetingAssignments.forEach(a => {
      if (!meetingAssignMap.has(a.meetingId)) meetingAssignMap.set(a.meetingId, []);
      meetingAssignMap.get(a.meetingId)!.push(a);
    });

    const meetingItems = allMeetings.map(m => {
      const start = new Date(m.scheduledAt);
      return {
        id: `mtg-${m.id}`,
        projectId: m.projectId,
        taskCode: "MEETING",
        subject: `[MTG] ${m.title}`,
        plannedStart: start.toISOString(),
        plannedEnd: new Date(start.getTime() + (m.durationMinutes || 60) * 60000).toISOString(),
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
    let allItemsWithVirtual: any[] = [...allItemsRaw, ...meetingItems];
    if (windowStart && windowEnd) {
      const wStart = new Date(windowStart);
      const wEnd = new Date(windowEnd);
      const templates = allItemsRaw.filter(i => i.isRecurringTemplate);
      const instanceDatesByTemplate = new Map<string, Set<string>>();
      allItemsRaw.forEach(i => {
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
            plannedStart: template.plannedStart ?? "",
            plannedEnd: template.plannedEnd ?? "",
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
        id: i.id, 
        owner: i.owner,
        plannedStart: i.plannedStart ?? "",
        plannedEnd: i.plannedEnd ?? "",
        archived: i.archived ?? false, 
        status: i.status ?? "pending",
      })));
      conflicts.forEach(c => {
        if (!conflictMap.has(c.taskId)) conflictMap.set(c.taskId, []);
        conflictMap.get(c.taskId).push(c);
      });
    }

    // 5. Build Tree
    const itemMap = new Map();
    allItemsWithVirtual.forEach(item => {
      itemMap.set(item.id, {
        ...item,
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

/**
 * POST /api/tasks
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const body = await req.json();
    const { projectId, subject, plannedStart, plannedEnd, owner, parentId, durationHours, assignedIds } = body;

    const projectRows = await db.select({ companyName: projectsTable.companyName, clientProfileId: projectsTable.clientProfileId })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    const project = projectRows[0];

    const prefix = project?.companyName 
      ? project.companyName.split(" ")[0].replace(/[^a-zA-Z]/g, "").toUpperCase().substring(0, 3)
      : "GEN";

    const taskCode = `TASK-${Math.floor(100000 + Math.random() * 900000)}`;
    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db.transaction(async (tx) => {
      // 1. Insert Task
      await tx.insert(timelineItemsTable).values({
        id: taskId,
        projectId,
        clientProfileId: project?.clientProfileId || null,
        taskCode,
        subject: subject || "Untitled Task",
        plannedStart: new Date(plannedStart).toISOString(),
        plannedEnd: new Date(plannedEnd).toISOString(),
        parentId: parentId || null,
        owner: owner || null,
        status: 'pending',
        durationHours: durationHours ?? 8,
        sortOrder: 0,
        archived: false,
        createdAt: now,
        updatedAt: now
      });

      // 2. Insert Assignments
      if (assignedIds && Array.isArray(assignedIds)) {
        for (const uid of assignedIds) {
          await tx.insert(taskAssignmentsTable).values({
            id: `asgn_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
            timelineItemId: taskId,
            userId: uid
          });
        }
      }

      // 3. Roll-up dates to parent
      if (parentId) {
        const startISO = new Date(plannedStart).toISOString();
        const endISO = new Date(plannedEnd).toISOString();
        await tx.run(sql`
          UPDATE TimelineItem
          SET plannedStart = MIN(COALESCE(plannedStart, ${startISO}), ${startISO}),
              plannedEnd   = MAX(COALESCE(plannedEnd,   ${endISO}),   ${endISO})
          WHERE id = ${parentId}
        `);
      }
    });

    return NextResponse.json({ id: taskId, taskCode, subject });
  } catch (error: any) {
    console.error("POST Tasks Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tasks
 * MIGRATED TO DRIZZLE
 */
export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { id, comment, assignedIds, ...rawUpdate } = body;

    const currentRows = await db.select().from(timelineItemsTable).where(eq(timelineItemsTable.id, id)).limit(1);
    const current = currentRows[0];
    if (!current) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const ALLOWED = ["subject","owner","description","status","plannedStart","plannedEnd","actualStart","actualEnd","archived","sortOrder","durationHours","recurringFrequency","recurringUntil","isRecurringTemplate","kanbanLaneId"];
    const updateData: any = {};
    for (const key of ALLOWED) {
      if (!(key in rawUpdate) || rawUpdate[key] === undefined) continue;
      let val = rawUpdate[key];
      if (["plannedStart","plannedEnd","actualStart","actualEnd"].includes(key) && val) {
        val = new Date(val).toISOString();
      }
      updateData[key] = val;
    }

    await db.transaction(async (tx) => {
      // 1. Update Task
      if (Object.keys(updateData).length > 0) {
        await tx.update(timelineItemsTable)
          .set({ ...updateData, updatedAt: new Date().toISOString() })
          .where(eq(timelineItemsTable.id, id));

        // 1b. Record History
        for (const [key, newVal] of Object.entries(updateData)) {
          const oldVal = (current as any)[key];
          if (String(oldVal) !== String(newVal)) {
            await tx.insert(taskHistoryTable).values({
              id: `hist_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
              timelineItemId: id,
              type: "field_update",
              oldValue: oldVal != null ? String(oldVal) : null,
              newValue: newVal != null ? String(newVal) : null,
              changedBy: session.user.name || session.user.email || "System",
              comment: comment || `Updated ${key}`,
              createdAt: new Date().toISOString()
            });
          }
        }
      }

      // 2. Update Assignments
      if (assignedIds) {
        await tx.delete(taskAssignmentsTable).where(eq(taskAssignmentsTable.timelineItemId, id));
        for (const uid of assignedIds) {
          await tx.insert(taskAssignmentsTable).values({
            id: `asgn_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
            timelineItemId: id,
            userId: uid
          });
        }
      }

      // 3. Roll-up dates to parent
      if (current.parentId && (updateData.plannedStart || updateData.plannedEnd)) {
        const startISO = updateData.plannedStart || current.plannedStart;
        const endISO = updateData.plannedEnd || current.plannedEnd;
        if (startISO && endISO) {
          await tx.run(sql`
            UPDATE TimelineItem
            SET plannedStart = MIN(COALESCE(plannedStart, ${startISO}), ${startISO}),
                plannedEnd   = MAX(COALESCE(plannedEnd,   ${endISO}),   ${endISO})
            WHERE id = ${current.parentId}
          `);
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH Tasks Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
