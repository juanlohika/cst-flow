/**
 * Pure scheduling utility functions.
 * No DB calls — all functions operate on plain data objects.
 * Used by: /api/tasks, /api/capacity, /api/dashboard, /api/tasks/suggest-slot
 */

export interface VirtualTask {
  id: string;                  // synthetic: `${templateId}_${dateStr}`
  taskCode: string;
  subject: string;
  plannedStart: string;        // ISO string
  plannedEnd: string;          // ISO string
  durationHours: number;
  owner: string | null;
  status: string;
  projectId: string;
  parentId: string | null;
  archived: boolean;
  isVirtual: true;
  recurringParentId: string;   // the template row's id
  recurringFrequency: string;
  project?: { id: string; name: string; companyName?: string };
}

export interface OverloadResult {
  owner: string;
  date: string;       // YYYY-MM-DD
  plannedHours: number;
  capacity: number;
  level: "ok" | "warning" | "critical";
}

export interface ConflictResult {
  taskId: string;
  conflictingTaskId: string;
  owner: string;
  overlapStart: string;
  overlapEnd: string;
}

export interface CapacityRow {
  owner: string;
  dailyHours: number;
  restDays: string;
}

// ── Date helpers ────────────────────────────────────────────────

function toDate(dt: string | Date | null | undefined): Date | null {
  if (!dt) return null;
  if (dt instanceof Date) return dt;
  const d = new Date(String(dt).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

/** Parse "Saturday,Sunday" → Set of day-of-week numbers (0=Sun,6=Sat) */
function parseRestDays(restDays: string): Set<number> {
  const map: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  };
  return new Set(
    restDays.split(",").map(d => map[d.trim()]).filter(n => n !== undefined)
  );
}

export function isRestDay(date: Date, restDays: string): boolean {
  return parseRestDays(restDays).has(date.getUTCDay());
}

/** Count working days in [start, end] inclusive */
function workingDaysBetween(start: Date, end: Date, restDays: string): number {
  const rest = parseRestDays(restDays);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (!rest.has(cur.getUTCDay())) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return Math.max(count, 1);
}

/** Advance date by one recurrence period */
function advanceByFrequency(d: Date, freq: string): Date {
  switch (freq) {
    case "weekly":    return addDays(d, 7);
    case "monthly":   return addMonths(d, 1);
    case "quarterly": return addMonths(d, 3);
    case "yearly":    return addMonths(d, 12);
    default:          return addMonths(d, 1);
  }
}

// ── Recurring materialization ────────────────────────────────────

/**
 * Given a recurring template task and a visible date window,
 * returns virtual task instances that fall within the window.
 * Skips slots where existingInstanceDates already has an entry (real DB row wins).
 */
export function materializeRecurringInstances(
  template: {
    id: string;
    taskCode: string;
    subject: string;
    plannedStart: string;
    plannedEnd: string;
    durationHours: number;
    owner: string | null;
    status: string;
    projectId: string;
    parentId: string | null;
    recurringFrequency: string;
    recurringUntil: string | null;
    project?: { id: string; name: string; companyName?: string };
  },
  windowStart: Date,
  windowEnd: Date,
  existingInstanceDates: Set<string>  // YYYY-MM-DD dates of already-stored instances
): VirtualTask[] {
  const freq = template.recurringFrequency;
  const protoStart = toDate(template.plannedStart);
  const protoEnd = toDate(template.plannedEnd);
  if (!protoStart || !protoEnd) return [];

  const until = template.recurringUntil ? toDate(template.recurringUntil) : null;
  const effectiveEnd = until && until < windowEnd ? until : windowEnd;

  // Duration of one occurrence in ms
  const durationMs = protoEnd.getTime() - protoStart.getTime();

  const instances: VirtualTask[] = [];

  // Find first occurrence at or after windowStart
  let cur = new Date(protoStart);
  // Advance until cur >= windowStart
  while (cur < windowStart) {
    cur = advanceByFrequency(cur, freq);
  }

  while (cur <= effectiveEnd) {
    const dateStr = toDateStr(cur);
    if (!existingInstanceDates.has(dateStr)) {
      const occEnd = new Date(cur.getTime() + durationMs);
      instances.push({
        id: `${template.id}_${dateStr}`,
        taskCode: template.taskCode,
        subject: template.subject,
        plannedStart: cur.toISOString(),
        plannedEnd: occEnd.toISOString(),
        durationHours: template.durationHours,
        owner: template.owner,
        status: "pending",
        projectId: template.projectId,
        parentId: template.parentId,
        archived: false,
        isVirtual: true,
        recurringParentId: template.id,
        recurringFrequency: freq,
        project: template.project,
      });
    }
    cur = advanceByFrequency(cur, freq);
  }

  return instances;
}

// ── Overload detection ───────────────────────────────────────────

/**
 * For a given date, compute total planned hours per owner across all tasks
 * whose [plannedStart, plannedEnd] spans that date.
 * Hours contribution = durationHours / workingDaysInSpan
 */
export function computeDailyHours(
  tasks: Array<{
    owner: string | null;
    plannedStart: string;
    plannedEnd: string;
    durationHours: number;
    status: string;
    archived: boolean;
  }>,
  date: Date,
  defaultRestDays = "Saturday,Sunday"
): Map<string, number> {
  const map = new Map<string, number>();
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000 - 1);

  for (const t of tasks) {
    if (t.archived || t.status === "completed") continue;
    if (!t.owner) continue;
    const ps = toDate(t.plannedStart);
    const pe = toDate(t.plannedEnd);
    if (!ps || !pe) continue;
    if (ps > dayEnd || pe < dayStart) continue; // doesn't overlap this day

    const workDays = workingDaysBetween(ps, pe, defaultRestDays);
    const contribution = t.durationHours / workDays;
    map.set(t.owner, (map.get(t.owner) ?? 0) + contribution);
  }
  return map;
}

/**
 * Given daily hour totals and capacity config, return overload results.
 */
export function detectOverload(
  dailyHoursMap: Map<string, number>,
  capacities: CapacityRow[],
  date: Date,
  defaultCapacity = 8
): OverloadResult[] {
  const results: OverloadResult[] = [];
  const dateStr = toDateStr(date);

  for (const [owner, plannedHours] of Array.from(dailyHoursMap)) {
    const cap = capacities.find(c => c.owner === owner)?.dailyHours ?? defaultCapacity;
    const ratio = plannedHours / cap;
    const level: OverloadResult["level"] =
      ratio > 1 ? "critical" : ratio >= 0.75 ? "warning" : "ok";
    results.push({ owner, date: dateStr, plannedHours, capacity: cap, level });
  }
  return results;
}

// ── Conflict detection ───────────────────────────────────────────

/**
 * Detect time-window overlaps between tasks assigned to the same owner.
 * Two tasks conflict when their [plannedStart, plannedEnd] windows overlap.
 */
export function detectConflicts(
  tasks: Array<{
    id: string;
    owner: string | null;
    plannedStart: string;
    plannedEnd: string;
    archived: boolean;
    status: string;
  }>
): ConflictResult[] {
  const results: ConflictResult[] = [];
  const byOwner = new Map<string, typeof tasks>();

  for (const t of tasks) {
    if (t.archived || t.status === "completed" || !t.owner) continue;
    if (!byOwner.has(t.owner)) byOwner.set(t.owner, []);
    byOwner.get(t.owner)!.push(t);
  }

  for (const [owner, ownerTasks] of Array.from(byOwner)) {
    for (let i = 0; i < ownerTasks.length; i++) {
      for (let j = i + 1; j < ownerTasks.length; j++) {
        const a = ownerTasks[i];
        const b = ownerTasks[j];
        const aStart = toDate(a.plannedStart);
        const aEnd = toDate(a.plannedEnd);
        const bStart = toDate(b.plannedStart);
        const bEnd = toDate(b.plannedEnd);
        if (!aStart || !aEnd || !bStart || !bEnd) continue;

        // Skip if times are both midnight (timeNA tasks — date-only, no real time conflict)
        const aTimeNA = aStart.getUTCHours() === 0 && aStart.getUTCMinutes() === 0 && aEnd.getUTCHours() === 0;
        const bTimeNA = bStart.getUTCHours() === 0 && bStart.getUTCMinutes() === 0 && bEnd.getUTCHours() === 0;
        if (aTimeNA || bTimeNA) continue;

        // Overlap: a starts before b ends AND b starts before a ends
        if (aStart < bEnd && bStart < aEnd) {
          const overlapStart = aStart > bStart ? aStart : bStart;
          const overlapEnd = aEnd < bEnd ? aEnd : bEnd;
          results.push({
            taskId: a.id,
            conflictingTaskId: b.id,
            owner,
            overlapStart: overlapStart.toISOString(),
            overlapEnd: overlapEnd.toISOString(),
          });
        }
      }
    }
  }
  return results;
}

// ── Slot finder ──────────────────────────────────────────────────

/**
 * Find the next available date where the owner has enough capacity
 * for a task of durationHours, starting from afterDate.
 */
export function findNextAvailableSlot(
  owner: string,
  durationHours: number,
  afterDate: Date,
  tasks: Array<{
    owner: string | null;
    plannedStart: string;
    plannedEnd: string;
    durationHours: number;
    status: string;
    archived: boolean;
  }>,
  capacity: CapacityRow
): Date {
  const restDays = parseRestDays(capacity.restDays);
  let candidate = new Date(afterDate);
  candidate.setUTCHours(0, 0, 0, 0);

  for (let attempt = 0; attempt < 365; attempt++) {
    // Skip rest days
    if (!restDays.has(candidate.getUTCDay())) {
      const existing = computeDailyHours(tasks, candidate, capacity.restDays);
      const used = existing.get(owner) ?? 0;
      if (used + durationHours <= capacity.dailyHours) {
        return candidate;
      }
    }
    candidate = addDays(candidate, 1);
  }
  return candidate; // fallback: return whatever we landed on
}
