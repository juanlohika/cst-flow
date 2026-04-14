import { NextResponse } from "next/server";
import { db } from "@/db";
import { timelineItems as timelineItemsTable, projects as projectsTable } from "@/db/schema";
import { auth } from "@/auth";
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import { eq, and, ne, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** 
 * POST /api/ai/day-planner 
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { ownerLabel } = await req.json();
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const in3Days = new Date(today.getTime() + 3 * 86400000);

    // Fetch tasks relevant to this owner
    const conditions = [
      eq(timelineItemsTable.archived, false),
      ne(timelineItemsTable.status, "completed")
    ];
    if (ownerLabel) {
      conditions.push(eq(timelineItemsTable.owner, ownerLabel));
    }

    const rows = await db.select({
      id: timelineItemsTable.id,
      taskCode: timelineItemsTable.taskCode,
      subject: timelineItemsTable.subject,
      status: timelineItemsTable.status,
      durationHours: timelineItemsTable.durationHours,
      plannedEnd: timelineItemsTable.plannedEnd,
      projectName: projectsTable.name
    })
    .from(timelineItemsTable)
    .leftJoin(projectsTable, eq(timelineItemsTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(asc(timelineItemsTable.plannedStart))
    .limit(30);

    if (rows.length === 0) {
      return NextResponse.json({
        schedule: [],
        deferredTasks: [],
        summary: "No active tasks found. Enjoy a clear day!",
      });
    }

    // Classify urgency
    const classify = (t: any) => {
      if (!t.plannedEnd) return "normal";
      const e = new Date(t.plannedEnd);
      if (e < today) return "overdue";
      if (e <= in3Days) return "deadline-approaching";
      if (t.status === "in-progress") return "in-progress";
      return "normal";
    };

    const taskList = rows.map(t => ({
      id: t.id,
      taskCode: t.taskCode,
      subject: t.subject,
      project: t.projectName ?? "—",
      status: t.status,
      durationHours: t.durationHours ?? 8,
      plannedEnd: t.plannedEnd ? new Date(t.plannedEnd).toISOString().split("T")[0] : null,
      urgency: classify(t),
    }));

    const totalHours = taskList.reduce((s, t) => s + t.durationHours, 0);

    const systemPrompt = `You are an expert Project Manager AI assistant.
Your job is to create a structured, realistic daily work plan based on the task list provided.
Return ONLY valid JSON — no markdown, no explanation, no code fences.
Output format: { "schedule": TimeBlock[], "deferredTasks": string[], "summary": string }
TimeBlock: { "startTime": "HH:MM", "endTime": "HH:MM", "taskId": string, "taskCode": string, "subject": string, "action": string, "blockType": "focus" | "admin" | "break", "priority": "critical" | "high" | "normal" }
Rules:
- Day starts at 09:00, ends at 18:00
- Include a 30-minute lunch break at 12:00 (no taskId, blockType: "break")
- Prioritize: overdue > deadline-approaching > in-progress > normal
- If totalHours > 8, flag excess tasks in deferredTasks (array of taskCodes)
- Keep each block realistic (don't exceed the task's durationHours)
- action: one concise sentence describing what the user should DO in this block
- summary: 2-3 sentences coaching the user on today's priorities`;

    const userMessage = `Today: ${todayStr}
Owner: ${ownerLabel || "all"}
Total planned hours: ${totalHours}h (capacity: 8h)

Tasks:
${taskList.map(t => `- [${t.urgency.toUpperCase()}] ${t.taskCode} | ${t.subject} | Project: ${t.project} | ${t.durationHours}h | Due: ${t.plannedEnd ?? "no deadline"} | Status: ${t.status}`).join("\n")}

Build a realistic day plan. Defer tasks that don't fit in 8h.`;

    const model = await getModelForApp("tasks");
    const result = await generateWithRetry(model, `${systemPrompt}\n\n${userMessage}`);

    const raw = result.response.text().trim();
    // Strip any accidental markdown fences
    const json = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(json);

    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error("POST /api/ai/day-planner error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
