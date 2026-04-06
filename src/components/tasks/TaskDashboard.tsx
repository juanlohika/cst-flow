"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus,
  Search,
  Archive,
  ChevronRight,
  ChevronDown,
  Layers,
  Timer,
  X,
  MoreHorizontal,
  ExternalLink,
  Download,
  Image as ImageIcon,
  FileText,
  RotateCcw,
  CheckCircle2,
  Calendar,
  RefreshCw,
  Repeat,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { toPng } from "html-to-image";
import AddTaskModal from "./AddTaskModal";
import AllocateHoursModal from "./AllocateHoursModal";
import GlobalCalendar from "./GlobalCalendar";
import InteractiveGantt from "@/components/timeline/InteractiveGantt";
import TaskDetailModal from "./TaskDetailModal";
import ConfirmRescheduleModal from "./ConfirmRescheduleModal";
import ParentAdjustmentModal from "./ParentAdjustmentModal";
import { useToast } from "@/components/ui/ToastContext";
import StitchTimePicker from "@/components/ui/StitchTimePicker";
import OverloadBadge from "@/components/tasks/OverloadBadge";
import ConflictWarning from "@/components/tasks/ConflictWarning";
import KanbanView from "@/components/tasks/KanbanView";
import KanbanSetupModal from "@/components/tasks/KanbanSetupModal";
import KanbanTransitionModal from "@/components/tasks/KanbanTransitionModal";
import UserSelect from "@/components/ui/UserSelect";
import DonutChart from "@/components/charts/DonutChart";
import ProjectSettingsView from "@/components/projects/ProjectSettingsView";
import BufferModal from "@/components/timeline/BufferModal";

interface Task {
  id: string;
  taskCode: string;
  subject: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  owner: string;
  status: string;
  archived: boolean;
  durationHours?: number;
  parentId?: string;
  subtasks?: Task[];
  project?: { id: string; name: string };
  history?: any[];
  kanbanLaneId?: string | null;
  paddingDays?: number;
  externalPlannedEnd?: string;
}

interface TaskDashboardProps {
  projectId: string;
  projectName?: string | null;
  profile?: any;
}

interface DatePopover {
  taskId: string;
  mode: "planned" | "actual";
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  durationHours: number | null;
  timeNA: boolean;
  pos: { top: number; left: number };
  task: any;
}

const STATUS_OPTIONS = ["ALL", "pending", "in-progress", "completed"];
const STATUS_LABEL: Record<string, string> = { ALL: "ALL", pending: "PENDING", "in-progress": "ACTIVE", completed: "DONE" };
const STATUS_COLORS: Record<string, string> = {
  "pending": "bg-slate-500/10 text-slate-500 border-slate-500/20",
  "in-progress": "bg-amber-500/10 text-amber-600 border-amber-500/20",
  "completed": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

function getOwnerPillClass(owner: string): string {
  const colors = [
    "bg-indigo-50 text-indigo-700 border-indigo-100",
    "bg-sky-50 text-sky-700 border-sky-100",
    "bg-violet-50 text-violet-700 border-violet-100",
    "bg-rose-50 text-rose-700 border-rose-100",
    "bg-emerald-50 text-emerald-700 border-emerald-100",
    "bg-amber-50 text-amber-700 border-amber-100",
    "bg-blue-50 text-blue-700 border-blue-100",
  ];
  if (owner === "PM") return colors[0];
  if (owner === "BA") return colors[1];
  if (owner === "DEV") return colors[2];
  if (owner === "CLIENT") return colors[3];
  let hash = 0;
  for (let i = 0; i < owner.length; i++) {
    hash = owner.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

const today = new Date().toISOString().split("T")[0];

// Parse ISO or SQLite space-separated datetime to [date, time] strings
function parseDT(dt: string | null | undefined, fallbackDate = today, fallbackTime = "09:00") {
  if (!dt) return [fallbackDate, fallbackTime];
  if (dt.includes(" ")) {
    const parts = dt.split(" ");
    return [parts[0], parts[1].substring(0, 5)];
  }
  const norm = dt.replace(" ", "T");
  const d = new Date(norm);
  if (isNaN(d.getTime())) return [fallbackDate, fallbackTime];
  const date = d.toISOString().split("T")[0];
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return [date, time];
}

// Format owner for display (truncate emails)
function formatOwner(owner: string | undefined | null): string {
  if (!owner || owner === "TBD") return "—";
  if (owner.includes("@")) {
    return owner.split("@")[0].replace(/\b\w/g, l => l.toUpperCase());
  }
  return owner.replace(/\b\w/g, l => l.toUpperCase());
}

export default function TaskDashboard({ projectId, projectName, profile }: TaskDashboardProps) {
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [displayTasks, setDisplayTasks] = useState<Task[]>([]);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "calendar" | "gantt" | "archive" | "kanban" | "summary" | "settings">("list");
  const [isLevelZero, setIsLevelZero] = useState(false);
  const [bufferTask, setBufferTask] = useState<{ id: string; padding: number } | null>(null);
  const [kanbanBoard, setKanbanBoard] = useState<any>(null);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [showKanbanSetup, setShowKanbanSetup] = useState(false);
  const [members, setMembers] = useState<{ users: any[]; roles: any[] }>({ users: [], roles: [] });
  const [projectMeta, setProjectMeta] = useState<{ createdBy?: string } | null>(null);
  const [kanbanTransition, setKanbanTransition] = useState<{ task: Task; laneId: string; laneName: string; mappedStatus: string } | null>(null);
  const [ganttScale, setGanttScale] = useState<"day" | "week" | "month">("day");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [showArchived, setShowArchived] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [parentForNewSubtask, setParentForNewSubtask] = useState<Task | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [rescheduleInfo, setRescheduleInfo] = useState<{ id: string; newStart: string; newEnd: string } | null>(null);
  const [cascadeInfo, setCascadeInfo] = useState<{
    parentId: string; parentName: string;
    parentOldStart: string; parentOldEnd: string;
    parentNewStart: string; parentNewEnd: string;
  } | null>(null);
  const [cascadeConfirmed, setCascadeConfirmed] = useState(false);
  const [projectRecord, setProjectRecord] = useState<any>(null);
  const [allocateTask, setAllocateTask] = useState<Task | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  // Inline editing
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  // DateTime popover (planned & actual)
  const [datePopover, setDatePopover] = useState<DatePopover | null>(null);
  const [popoverSaving, setPopoverSaving] = useState(false);
  const ganttRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => { setShowArchived(viewMode === "archive"); }, [viewMode]);
  useEffect(() => { fetchTasks(); }, [refreshKey, projectId, showArchived]);
  useEffect(() => {
    if (projectId && projectId !== "ALL") {
      fetch(`/api/projects/${projectId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setProjectRecord(data); })
        .catch(() => {});
    }
  }, [projectId]);
  const assignDefaultKanbanLaneId = (task: Task): Task => {
    if (task.kanbanLaneId) return task;
    if (!kanbanBoard?.lanes?.length) return task;
    const matches = kanbanBoard.lanes.filter((l: any) => l.mappedStatus === task.status);
    return matches.length === 1 ? { ...task, kanbanLaneId: matches[0].id } : task;
  };

  const normalizeTasksWithKanban = (items: Task[]): Task[] => {
    return items.map(task => ({
      ...assignDefaultKanbanLaneId(task),
      subtasks: task.subtasks ? normalizeTasksWithKanban(task.subtasks) : undefined,
    }));
  };

  const loadKanban = () => {
    if (projectId !== "ALL" && !kanbanBoard && !kanbanLoading) {
      setKanbanLoading(true);
      Promise.all([
        fetch(`/api/kanban/${projectId}`).then(r => r.ok ? r.json() : null).catch(() => null),
        !projectMeta ? fetch(`/api/projects`).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve(null),
      ]).then(([board, projects]) => {
        setKanbanBoard(board);
        if (projects && Array.isArray(projects)) {
          const p = projects.find((x: any) => x.id === projectId);
          if (p) setProjectMeta({ createdBy: p.createdBy });
        }
      }).finally(() => setKanbanLoading(false));
    }
  };

  useEffect(() => {
    loadKanban();
  }, [projectId]);

  useEffect(() => {
    fetch("/api/users/members")
      .then(r => r.ok ? r.json() : { users: [], roles: [] })
      .then(setMembers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    (window as any).dispatchAddTask = (parent: Task) => { setParentForNewSubtask(parent); setIsAddingTask(true); };
    return () => { delete (window as any).dispatchAddTask; };
  }, []);

  useEffect(() => {
    if (kanbanBoard && tasks.length > 0) {
      const normalized = normalizeTasksWithKanban(tasks);
      setTasks(normalized);
      setDisplayTasks(prev => normalizeTasksWithKanban(prev));
    }
  }, [kanbanBoard]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?projectId=${projectId}&showArchived=${showArchived}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const normalized = kanbanBoard ? normalizeTasksWithKanban(data) : data;
        setTasks(normalized);
        setDisplayTasks(normalized);
      }
    } catch (err) { console.error("Failed to fetch tasks", err); }
    finally { setLoading(false); }
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(expandedTasks);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedTasks(next);
  };

  const flattenTasks = (taskList: Task[], depth = 0): any[] => {
    let flat: any[] = [];
    taskList.forEach(t => {
      flat.push({ ...t, depth });
      if (expandedTasks.has(t.id) && t.subtasks?.length) flat = [...flat, ...flattenTasks(t.subtasks, depth + 1)];
    });
    return flat;
  };

  const filteredTasks = useMemo(() => {
    return flattenTasks(displayTasks).filter(t => {
      const matchSearch = t.subject.toLowerCase().includes(searchTerm.toLowerCase()) || t.taskCode.toLowerCase().includes(searchTerm.toLowerCase());
      const matchRole = roleFilter === "ALL" || t.owner?.toUpperCase().includes(roleFilter);
      const matchStatus = statusFilter === "ALL" || t.status === statusFilter;
      const ts = t.plannedStart ? t.plannedStart.split("T")[0] : null;
      const te = t.plannedEnd ? t.plannedEnd.split("T")[0] : null;
      const matchFrom = !dateFrom || (te && te >= dateFrom);
      const matchTo = !dateTo || (ts && ts <= dateTo);
      return matchSearch && matchRole && matchStatus && matchFrom && matchTo;
    });
  }, [displayTasks, expandedTasks, searchTerm, roleFilter, statusFilter, dateFrom, dateTo]);

  const toDisplayDate = (iso: string | undefined | null) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
    catch { return "—"; }
  };
  const toDisplayTime = (iso: string | undefined | null) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    } catch { return ""; }
  };

  const cycleTeam = () => {
    const roles = ["ALL", ...members.roles.map(r => r.name), ...members.users.map(u => u.name || u.email)];
    const i = roles.indexOf(roleFilter);
    setRoleFilter(roles[(i + 1) % roles.length]);
  };
  const cycleStatus = () => { const i = STATUS_OPTIONS.indexOf(statusFilter); setStatusFilter(STATUS_OPTIONS[(i + 1) % STATUS_OPTIONS.length]); };

  // ── Inline field save ──
  const saveField = async (taskId: string, field: string, value: string | number) => {
    try {
      const payload: any = { id: taskId, [field]: value };
      // When budget changes, recalculate plannedEnd = plannedStart + newDuration (only if time is set)
      if (field === "durationHours" && typeof value === "number" && value > 0) {
        const task = flattenTasks(tasks).find((t: any) => t.id === taskId);
        if (task?.plannedStart) {
          const [sd, st] = parseDT(task.plannedStart, today, "09:00");
          if (st !== "00:00") {
            const [sh, sm] = st.split(":").map(Number);
            const endFloat = Math.min(sh + sm / 60 + value, 22);
            const endH = Math.floor(endFloat);
            const endM = Math.round((endFloat - endH) * 60);
            payload.plannedEnd = `${sd}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00.000Z`;
          }
        }
      }
      await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setRefreshKey(p => p + 1);
    } catch { showToast("Save failed", "error"); }
    setEditingCell(null);
  };

  // ── DateTime popover ──
  const openPlannedPopover = (task: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const [sd, st] = parseDT(task.plannedStart, today, "09:00");
    const [ed, etRaw] = parseDT(task.plannedEnd, today, "17:00");
    // Detect timeNA: stored time is midnight (previously saved as N/A), or parent with subtasks and no duration
    const storedTimeIsNA = st === "00:00";
    const timeNA = storedTimeIsNA || (task.subtasks?.length > 0 && !task.durationHours);
    // Align end time with budget when budget > 0 and time is applicable
    let et = etRaw;
    if (!timeNA && task.durationHours != null && task.durationHours > 0) {
      const [sh, sm] = st.split(":").map(Number);
      const startFloat = sh + sm / 60;
      const endFloat = Math.min(startFloat + task.durationHours, 22);
      const endH = Math.floor(endFloat);
      const endM = Math.round((endFloat - endH) * 60);
      et = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    }
    setDatePopover({ taskId: task.id, mode: "planned", startDate: sd, startTime: timeNA ? "09:00" : st, endDate: ed, endTime: timeNA ? "17:00" : et, durationHours: task.durationHours ?? null, timeNA, pos: { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 296) }, task });
    setEditingCell(null);
  };

  const openActualPopover = (task: any, e: React.MouseEvent) => {
    e.stopPropagation();
    // Dependency check
    if (task.subtasks?.length > 0) {
      const incomplete = task.subtasks.filter((s: any) => s.status !== "completed");
      if (incomplete.length > 0) {
        showToast(`Cannot complete: ${incomplete.length} subtask${incomplete.length > 1 ? "s" : ""} still not done`, "error");
        // Expand subtasks so user can see which are incomplete
        setExpandedTasks(prev => { const n = new Set(prev); n.add(task.id); return n; });
        setEditingCell(null);
        return;
      }
    }
    // Auto-inherit actual dates from subtasks if available
    let sd = today, st = "09:00", ed = today, et = "17:00";
    if (task.subtasks?.length > 0) {
      const actuals = task.subtasks
        .filter((s: any) => s.actualStart && s.actualEnd)
        .map((s: any) => ({ start: new Date(String(s.actualStart).replace(" ", "T")), end: new Date(String(s.actualEnd).replace(" ", "T")) }))
        .filter((s: any) => !isNaN(s.start.getTime()) && !isNaN(s.end.getTime()));
      if (actuals.length > 0) {
        const minStart = new Date(Math.min(...actuals.map((s: any) => s.start.getTime())));
        const maxEnd = new Date(Math.max(...actuals.map((s: any) => s.end.getTime())));
        [sd, st] = [minStart.toISOString().split("T")[0], `${String(minStart.getUTCHours()).padStart(2, "0")}:${String(minStart.getUTCMinutes()).padStart(2, "0")}`];
        [ed, et] = [maxEnd.toISOString().split("T")[0], `${String(maxEnd.getUTCHours()).padStart(2, "0")}:${String(maxEnd.getUTCMinutes()).padStart(2, "0")}`];
      }
    } else if (task.actualStart) {
      [sd, st] = parseDT(task.actualStart);
      [ed, et] = parseDT(task.actualEnd || task.actualStart, today, "17:00");
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDatePopover({ taskId: task.id, mode: "actual", startDate: sd, startTime: st, endDate: ed, endTime: et, durationHours: task.durationHours ?? null, timeNA: false, pos: { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 296) }, task });
    setEditingCell(null);
  };

  const savePlannedPopover = async () => {
    if (!datePopover) return;
    setPopoverSaving(true);
    try {
      const startISO = datePopover.timeNA
        ? `${datePopover.startDate}T00:00:00.000Z`
        : `${datePopover.startDate}T${datePopover.startTime}:00.000Z`;
      const endISO = datePopover.timeNA
        ? `${datePopover.endDate}T00:00:00.000Z`
        : `${datePopover.endDate}T${datePopover.endTime}:00.000Z`;
      const payload: any = { id: datePopover.taskId, plannedStart: startISO, plannedEnd: endISO };
      // Persist updated durationHours if it changed from original task value
      if (!datePopover.timeNA && datePopover.durationHours != null && datePopover.durationHours !== datePopover.task.durationHours) {
        payload.durationHours = datePopover.durationHours;
      }
      await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      showToast("Schedule updated", "success");
      setRefreshKey(p => p + 1);
      setDatePopover(null);
    } catch { showToast("Save failed", "error"); }
    finally { setPopoverSaving(false); }
  };

  const saveActualPopover = async () => {
    if (!datePopover) return;
    setPopoverSaving(true);
    try {
      const task = flattenTasks(tasks).find(t => t.id === datePopover.taskId);
      const defaultLane = task && !task.kanbanLaneId && kanbanBoard?.lanes
        ? kanbanBoard.lanes.filter((l: any) => l.mappedStatus === "completed")
        : [];
      const payload: any = {
        id: datePopover.taskId,
        status: "completed",
        actualStart: `${datePopover.startDate}T${datePopover.startTime}:00.000Z`,
        actualEnd: `${datePopover.endDate}T${datePopover.endTime}:00.000Z`,
      };
      if (defaultLane.length === 1) payload.kanbanLaneId = defaultLane[0].id;
      await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      showToast("Task marked done", "success");
      setRefreshKey(p => p + 1);
      setDatePopover(null);
    } catch { showToast("Save failed", "error"); }
    finally { setPopoverSaving(false); }
  };

  // ── Row actions ──
  const handleArchive = async (taskId: string) => {
    try {
      await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: taskId, archived: true }) });
      showToast("Task archived", "success"); setRefreshKey(p => p + 1);
    } catch { showToast("Archive failed", "error"); }
    setOpenMenuId(null);
  };

  const handleRestore = async (taskId: string) => {
    try {
      await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: taskId, archived: false }) });
      showToast("Task restored", "success"); setRefreshKey(p => p + 1);
    } catch { showToast("Restore failed", "error"); }
    setOpenMenuId(null);
  };

  // ── Export ──
  const exportCSV = () => {
    const headers = ["Task Code", "Subject", "Assignee", "Status", "Planned Start", "Planned End", "Duration (hrs)"];
    const rows = filteredTasks.map((t: any) => [t.taskCode, `"${t.subject}"`, t.owner || "", t.status, t.plannedStart?.split("T")[0] || "", t.plannedEnd?.split("T")[0] || "", t.durationHours ?? ""]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "tasks.csv"; a.click();
    URL.revokeObjectURL(url);
    setShowExport(false);
  };

  const exportPhoto = async () => {
    if (!tableRef.current) return;
    try {
      const url = await toPng(tableRef.current, { backgroundColor: "#ffffff" });
      const a = document.createElement("a"); a.href = url; a.download = "tasks.png"; a.click();
    } catch { showToast("Export failed", "error"); }
    setShowExport(false);
  };

  // ── Gantt reschedule ──
  const handleReschedule = (id: string, start: string, end: string) => {
    const task = flattenTasks(tasks).find(t => t.id === id);
    if (task?.parentId) {
      const parent = flattenTasks(tasks).find(p => p.id === task.parentId);
      if (parent) {
        const nS = new Date(start), nE = new Date(end), pS = new Date(parent.plannedStart), pE = new Date(parent.plannedEnd);
        if (nS < pS || nE > pE) {
          setCascadeInfo({ parentId: parent.id, parentName: parent.subject, parentOldStart: parent.plannedStart, parentOldEnd: parent.plannedEnd, parentNewStart: nS < pS ? start : parent.plannedStart, parentNewEnd: nE > pE ? end : parent.plannedEnd });
          setRescheduleInfo({ id, newStart: start, newEnd: end }); return;
        }
      }
    }
    setRescheduleInfo({ id, newStart: start, newEnd: end });
  };

  const handleRescheduleConfirm = async (comment: string) => {
    if (!rescheduleInfo) return;
    try {
      const cr = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rescheduleInfo.id, plannedStart: rescheduleInfo.newStart, plannedEnd: rescheduleInfo.newEnd, comment }) });
      if (cascadeInfo && cascadeConfirmed) await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cascadeInfo.parentId, plannedStart: cascadeInfo.parentNewStart, plannedEnd: cascadeInfo.parentNewEnd, comment: `Auto-expanded — ${comment}` }) });
      if (cr.ok) { showToast("Timeline updated", "success"); setRefreshKey(p => p + 1); setRescheduleInfo(null); setCascadeInfo(null); setCascadeConfirmed(false); }
    } catch { showToast("Sync failed", "error"); }
  };

  const handleRescheduleCancel = () => {
    setDisplayTasks(tasks); setRescheduleInfo(null); setCascadeInfo(null); setCascadeConfirmed(false);
    showToast("Adjustment cancelled", "info");
  };

  const canEditKanban = (session?.user as any)?.role === "admin" || projectMeta?.createdBy === session?.user?.id;

  // Deep flatten that includes ALL tasks regardless of expand state (used for Kanban)
  const deepFlattenTasks = (taskList: Task[]): Task[] => {
    const flat: Task[] = [];
    const recurse = (items: Task[]) => {
      items.forEach(t => { flat.push(t); if (t.subtasks?.length) recurse(t.subtasks); });
    };
    recurse(taskList);
    return flat;
  };

  const handleKanbanMove = (taskId: string, laneId: string, mappedStatus: string) => {
    const task = deepFlattenTasks(tasks).find(t => t.id === taskId);
    if (!task) return;

    const lane = kanbanBoard?.lanes?.find((l: any) => l.id === laneId);
    const laneName = lane?.name ?? mappedStatus;

    const toStatus = mappedStatus;
    const fromStatus = task.status;
    const needsPlanned = toStatus === "in-progress" && fromStatus === "pending" && (!task.plannedStart || !task.plannedEnd);
    const needsActual = toStatus === "completed";
    const statusChanging = fromStatus !== toStatus;

    if (needsPlanned || needsActual || (statusChanging && toStatus !== "pending")) {
      setKanbanTransition({ task, laneId, laneName, mappedStatus });
      return;
    }

    // Same-status lane move or reverting to pending — no modal needed
    applyKanbanMove(taskId, laneId, mappedStatus, {});
  };

  const applyKanbanMove = async (taskId: string, laneId: string, mappedStatus: string, extra: Record<string, string>) => {
    const updateTree = (items: Task[]): Task[] => items.map(t =>
      t.id === taskId ? { ...t, kanbanLaneId: laneId, status: mappedStatus }
        : { ...t, subtasks: t.subtasks ? updateTree(t.subtasks) : undefined }
    );
    setTasks(prev => updateTree(prev));
    setDisplayTasks(prev => updateTree(prev));
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, kanbanLaneId: laneId, status: mappedStatus, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMessage = data.error || "Failed to move task";
        console.error("Kanban move failed", { taskId, laneId, mappedStatus, extra, errorMessage });
        showToast(errorMessage, "error");
        setRefreshKey(p => p + 1);
        return;
      }
      const responseData = await res.json().catch(() => null);
      console.log("Kanban move succeeded", { taskId, laneId, mappedStatus, responseData });
      setTasks(prev => {
        const applyResponse = (items: Task[]): Task[] => items.map(t => {
          if (t.id === taskId) {
            return { ...t, ...responseData };
          }
          return { ...t, subtasks: t.subtasks ? applyResponse(t.subtasks) : undefined };
        });
        return applyResponse(prev);
      });
      setDisplayTasks(prev => {
        const applyResponse = (items: Task[]): Task[] => items.map(t => {
          if (t.id === taskId) {
            return { ...t, ...responseData };
          }
          return { ...t, subtasks: t.subtasks ? applyResponse(t.subtasks) : undefined };
        });
        return applyResponse(prev);
      });
      showToast(`Moved task to ${mappedStatus}`, "success");
      setRefreshKey(p => p + 1);
    } catch (err: any) {
      console.error("Kanban move error", err);
      showToast(err.message || "Failed to move task", "error");
      setRefreshKey(p => p + 1);
    }
  };

  const closeAll = () => { setOpenMenuId(null); setShowExport(false); setEditingCell(null); setDatePopover(null); };

  return (
    <div className="flex flex-col h-full bg-white font-sans" onClick={closeAll}>

      {/* Tabs + Actions */}
      <div className="h-10 flex items-end border-b border-slate-100 shrink-0">
        <div className="flex items-end h-full">
          {(["list", "kanban", "calendar", "gantt", "archive", "summary", "settings"] as const).map(m => {
            if ((m === "summary" || m === "settings") && projectId === "ALL") return null;
            return (
              <button key={m} onClick={() => setViewMode(m)} className={`h-full px-4 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${viewMode === m ? "border-primary text-primary" : "border-transparent text-slate-400 hover:text-slate-600"}`}>{m}</button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 ml-auto px-4 pb-0.5" onClick={e => e.stopPropagation()}>
          {/* Export */}
          <div className="relative">
            <button onClick={() => { setShowExport(!showExport); setOpenMenuId(null); }} className="flex items-center gap-1 px-2.5 py-1 border border-slate-100 bg-white rounded-md text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all">
              <Download className="w-3 h-3" /> Export <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </button>
            {showExport && (
              <div className="absolute right-0 top-8 z-[200] w-40 bg-white border border-slate-100 rounded-lg shadow-xl py-1">
                <button onClick={exportPhoto} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                  <ImageIcon className="w-3 h-3 text-slate-400 shrink-0" /> Export Photo
                </button>
                <button onClick={exportCSV} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                  <FileText className="w-3 h-3 text-slate-400 shrink-0" /> Export CSV
                </button>
              </div>
            )}
          </div>
          {viewMode === "kanban" && canEditKanban && projectId !== "ALL" && (
            <button onClick={() => setShowKanbanSetup(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
              ⚙ Setup Board
            </button>
          )}
          {viewMode !== "archive" && viewMode !== "kanban" && (
            <button onClick={() => { if (projectId !== "ALL") { setParentForNewSubtask(null); setIsAddingTask(true); } }} disabled={projectId === "ALL"} title={projectId === "ALL" ? "Select a project first" : undefined}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${projectId === "ALL" ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-primary text-white hover:bg-primary-dark shadow-sm shadow-primary/20"}`}>
              <Plus className="w-3 h-3" /> Add Task
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-slate-100 shrink-0 bg-[#FCFCFC]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">From</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-6 px-2 bg-white border border-slate-100 rounded-md text-[10px] font-semibold text-slate-600 outline-none" />
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">To</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-6 px-2 bg-white border border-slate-100 rounded-md text-[10px] font-semibold text-slate-600 outline-none" />
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="h-5 w-5 flex items-center justify-center text-slate-300 hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>}
        </div>
        <div className="w-px h-4 bg-slate-200 shrink-0" />
        <div className="flex items-center gap-1.5 h-6 px-2 bg-white border border-slate-100 rounded-md focus-within:border-primary/40 transition-all">
          <Search className="w-3 h-3 text-slate-300 shrink-0" />
          <input className="w-24 bg-transparent border-none p-0 text-[10px] font-semibold text-slate-600 uppercase outline-none placeholder:text-slate-300" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          {searchTerm && <button onClick={() => setSearchTerm("")} className="text-slate-300 hover:text-slate-500"><X className="w-2.5 h-2.5" /></button>}
        </div>

        {viewMode === "gantt" && projectId === "ALL" && (
          <>
            <div className="w-px h-4 bg-slate-200 shrink-0" />
            <div className="flex items-center gap-3">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Gantt Mode</span>
               <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  <button 
                    onClick={() => setIsLevelZero(false)}
                    className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${!isLevelZero ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Breakdown
                  </button>
                  <button 
                    onClick={() => setIsLevelZero(true)}
                    className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${isLevelZero ? 'bg-white text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Summary (L0)
                  </button>
               </div>
            </div>
          </>
        )}

        {(() => { const a = roleFilter !== "ALL"; return (
          <button onClick={cycleTeam} className={`h-6 flex items-center rounded-md border text-[10px] font-bold uppercase tracking-widest transition-all ${a ? "bg-primary/5 border-primary/20 text-primary" : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"}`}>
            <span className="px-2">{a ? roleFilter : "Team"}</span>
            {a && (<><span className="w-px h-4 bg-primary/20" /><button onClick={e => { e.stopPropagation(); setRoleFilter("ALL"); }} className="px-1.5 text-primary/60 hover:text-red-500"><X className="w-2.5 h-2.5" /></button></>)}
          </button>
        ); })()}
        {(() => { const a = statusFilter !== "ALL"; return (
          <button onClick={cycleStatus} className={`h-6 flex items-center rounded-md border text-[10px] font-bold uppercase tracking-widest transition-all ${a ? "bg-primary/5 border-primary/20 text-primary" : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"}`}>
            <span className="px-2">{a ? (STATUS_LABEL[statusFilter] || statusFilter) : "Status"}</span>
            {a && (<><span className="w-px h-4 bg-primary/20" /><button onClick={e => { e.stopPropagation(); setStatusFilter("ALL"); }} className="px-1.5 text-primary/60 hover:text-red-500"><X className="w-2.5 h-2.5" /></button></>)}
          </button>
        ); })()}
        {viewMode === "gantt" && (
          <div className="ml-auto flex items-center gap-0.5 p-0.5 bg-white border border-slate-100 rounded-md">
            {(["day", "week", "month"] as const).map(s => (
              <button key={s} onClick={() => setGanttScale(s)} className={`px-2.5 py-0.5 rounded text-[9px] font-bold uppercase transition-all ${ganttScale === s ? "bg-slate-900 text-white shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>{s}</button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto thin-scrollbar p-6">

        {viewMode === "summary" && (
           <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white rounded-[2.5rem] border border-slate-100 p-12 shadow-sm flex flex-col items-center text-center">
                 <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] mb-12">Project Completion Tracking</h3>
                 <DonutChart 
                    completed={displayTasks.filter(t => t.status === 'completed').length}
                    inProgress={displayTasks.filter(t => t.status === 'in-progress').length}
                    pending={displayTasks.filter(t => t.status === 'pending').length}
                 />
                 <div className="grid grid-cols-3 gap-12 mt-12 w-full pt-12 border-t border-slate-50">
                    <div className="flex flex-col">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Items</span>
                       <span className="text-2xl font-black text-slate-800">{displayTasks.length}</span>
                    </div>
                    <div className="flex flex-col">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</span>
                       <span className="text-2xl font-black text-emerald-500 uppercase">Active</span>
                    </div>
                    <div className="flex flex-col">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Project Manager</span>
                       <span className="text-xl font-black text-slate-800 truncate">
                         {projectRecord?.internalInCharge ? formatOwner(projectRecord.internalInCharge) : formatOwner(session?.user?.name)}
                       </span>
                    </div>
                 </div>
              </div>
           </div>
        )}

        {viewMode === "settings" && (
           <div className="max-w-5xl mx-auto pb-20">
              <ProjectSettingsView
                project={projectRecord || { id: projectId, name: projectName, assignedIds: '', internalInCharge: null, archived: showArchived, shareToken: null }}
                onUpdate={() => { fetchTasks(); fetch(`/api/projects/${projectId}`).then(r=>r.ok?r.json():null).then(d=>{if(d)setProjectRecord(d);}); }}
              />
           </div>
        )}

        {/* LIST / ARCHIVE */}
        {(viewMode === "list" || viewMode === "archive") && (
          <table ref={tableRef} className="w-full border-collapse">
            <thead>
              <tr className="bg-[#FCFCFC] border-b border-slate-100">
                <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 h-10 align-middle font-normal">Task</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 h-10 align-middle font-normal w-[110px]">Assignee</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 h-10 align-middle font-normal w-[320px]">Schedule / Budget</th>
                <th className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400 px-3 h-10 align-middle font-normal w-[120px]">Status</th>
                <th className="h-10 w-[44px]" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-12 text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest animate-pulse">Loading tasks...</td></tr>
              ) : filteredTasks.length === 0 ? (
                <tr><td colSpan={5} className="py-16 text-center text-[11px] font-semibold text-slate-300 uppercase tracking-widest">No tasks found</td></tr>
              ) : filteredTasks.map((task: any) => {
                const useActual = task.status === "completed" && task.actualStart && task.actualEnd;
                const startISO = useActual ? task.actualStart : task.plannedStart;
                const endISO = useActual ? task.actualEnd : task.plannedEnd;
                const isMenuOpen = openMenuId === task.id;
                const isEditingSubject = editingCell?.taskId === task.id && editingCell?.field === "subject";
                const isEditingOwner = editingCell?.taskId === task.id && editingCell?.field === "owner";
                const isEditingStatus = editingCell?.taskId === task.id && editingCell?.field === "status";
                const isEditingBudget = editingCell?.taskId === task.id && editingCell?.field === "durationHours";
                return (
                  <tr key={task.id} className={`group border-b transition-colors ${task.depth > 0 ? "bg-slate-50/60 border-slate-100/70" : "bg-white border-slate-100"} hover:bg-blue-50/20`}>

                    {/* Col 1: Subject */}
                    <td className="py-2 min-h-12 align-middle" style={{ paddingLeft: `${16 + task.depth * 20}px`, paddingRight: "8px" }}>
                      <div className="flex items-center gap-1 min-w-0">
                        {task.subtasks?.length > 0 ? (
                          <button onClick={e => toggleExpand(task.id, e)} className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 shrink-0">
                            {expandedTasks.has(task.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                        ) : <div className="w-4 shrink-0" />}
                        
                        <div className="flex flex-col justify-center min-w-0">
                          <div className="flex items-center gap-1.5">
                            {isEditingSubject ? (
                              <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                                onBlur={() => editValue.trim() ? saveField(task.id, "subject", editValue.trim()) : setEditingCell(null)}
                                onKeyDown={e => { if (e.key === "Enter") editValue.trim() ? saveField(task.id, "subject", editValue.trim()) : setEditingCell(null); if (e.key === "Escape") setEditingCell(null); }}
                                onClick={e => e.stopPropagation()}
                                className="flex-1 text-[11px] font-semibold uppercase tracking-tight bg-white border border-primary/30 rounded px-1.5 py-0.5 outline-none text-slate-700 min-w-0" />
                            ) : (
                              <span onClick={e => { e.stopPropagation(); setEditingCell({ taskId: task.id, field: "subject" }); setEditValue(task.subject); }}
                                className="text-[11px] font-semibold text-slate-700 tracking-tight truncate cursor-text hover:text-primary transition-colors" title="Click to edit">{task.subject}</span>
                            )}
                            {(task as any).isRecurringTemplate && (
                              <span title="Recurring template" className="shrink-0 ml-0.5">
                                <RefreshCw size={10} className="text-blue-500" />
                              </span>
                            )}
                            {(task as any).recurringParentId && !(task as any).isRecurringTemplate && (
                              <span title="Recurring instance" className="shrink-0 ml-0.5">
                                <Repeat size={10} className="text-blue-400 opacity-70" />
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-medium text-slate-400 tracking-wide mt-0.5">{task.taskCode}</span>
                        </div>
                      </div>
                    </td>

                    {/* Col 2: Assignee */}
                    <td className="px-3 py-2 align-middle w-[110px] relative">
                      {isEditingOwner ? (
                        <div className="absolute top-0 left-0 z-[150]" onClick={e => e.stopPropagation()}>
                          <UserSelect
                            value={task.owner || "TBD"}
                            users={members.users}
                            roles={members.roles}
                            onChange={(val) => saveField(task.id, "owner", val)}
                            onClose={() => setEditingCell(null)}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 min-w-0">
                          <span 
                            onClick={e => { e.stopPropagation(); setEditingCell({ taskId: task.id, field: "owner" }); setEditValue(task.owner || ""); }}
                            className={`text-[9px] font-bold tracking-wide cursor-pointer transition-all px-2 py-0.5 rounded-full border shadow-sm truncate max-w-full ${getOwnerPillClass(task.owner || "UNASSIGNED")}`}
                            title={task.owner || "Click to edit"}
                          >
                            {formatOwner(task.owner)}
                          </span>
                          {(task as any).ownerOverloadLevel && (task as any).ownerOverloadLevel !== "ok" && (
                            <OverloadBadge level={(task as any).ownerOverloadLevel} />
                          )}
                        </div>
                      )}
                    </td>

                    {/* Col 3: Schedule + budget */}
                    <td className="px-3 py-2 align-middle w-[320px]">
                      <div className="flex items-center gap-3">
                        <div onClick={e => openPlannedPopover(task, e)} className="flex flex-col leading-tight cursor-pointer group/sched min-w-0" title="Click to edit schedule">
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            <span className={`text-[10px] font-bold border rounded px-1 uppercase tracking-tight whitespace-nowrap ${useActual ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-50 text-slate-500 border-slate-100"}`}>
                              {useActual ? "ACT" : "PLAN"}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-600 truncate group-hover/sched:text-primary transition-colors">
                              {toDisplayDate(startISO)} → {toDisplayDate(endISO)}
                            </span>
                          </div>
                          {toDisplayTime(startISO) !== "00:00" && (
                            <span className="flex items-center gap-1 text-[9px] font-medium text-slate-400 mt-0.5">
                              <Calendar className="w-2.5 h-2.5 opacity-40 shrink-0" />
                              {toDisplayTime(startISO)} – {toDisplayTime(endISO)}
                            </span>
                          )}
                        </div>
                        {/* Budget hours — inline editable */}
                        {isEditingBudget ? (
                          <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                            <input type="number" autoFocus min={0.25} step={0.25} value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => { const v = parseFloat(editValue); if (!isNaN(v) && v > 0) saveField(task.id, "durationHours", v); else setEditingCell(null); }}
                              onKeyDown={e => { if (e.key === "Enter") { const v = parseFloat(editValue); if (!isNaN(v) && v > 0) saveField(task.id, "durationHours", v); } if (e.key === "Escape") setEditingCell(null); }}
                              className="w-14 h-5 px-1.5 bg-white border border-primary/30 rounded text-[9px] font-bold text-blue-600 outline-none" />
                            <span className="text-[8px] text-slate-400 font-bold">h</span>
                          </div>
                        ) : (
                          <div className="flex flex-col shrink-0">
                            {task.durationHours != null && (
                              <span onClick={e => { e.stopPropagation(); setEditingCell({ taskId: task.id, field: "durationHours" }); setEditValue(String(task.durationHours)); }}
                                title="Click to edit budget hours"
                                className="px-1.5 py-0.5 bg-blue-50 border border-blue-100 rounded text-[9px] font-bold text-blue-500 cursor-pointer hover:bg-blue-100 transition-colors">
                                {task.durationHours}h
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Col 4: Status + allocate */}
                    <td className="px-3 py-2 align-middle w-[120px]">
                      <div className="flex items-center gap-1.5">
                        {isEditingStatus ? (
                          <select autoFocus value={editValue}
                            onChange={e => { const v = e.target.value; if (v === "completed") { openActualPopover(task, { currentTarget: e.currentTarget, stopPropagation: () => {} } as any); } else { saveField(task.id, "status", v); } }}
                            onBlur={() => setEditingCell(null)}
                            onKeyDown={e => e.key === "Escape" && setEditingCell(null)}
                            onClick={e => e.stopPropagation()}
                            className="text-[9px] font-bold uppercase bg-white border border-primary/30 rounded-md px-1.5 py-0.5 outline-none">
                            <option value="pending">Pending</option>
                            <option value="in-progress">In Progress</option>
                            <option value="completed">Completed</option>
                          </select>
                        ) : (
                          <span data-status-btn={task.id}
                            onClick={e => { e.stopPropagation(); setEditingCell({ taskId: task.id, field: "status" }); setEditValue(task.status); }}
                            title="Click to change status"
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide shrink-0 cursor-pointer hover:opacity-80 transition-opacity ${task.status === "completed" ? "bg-emerald-100 text-emerald-700" : task.status === "in-progress" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-400"}`}
                          >{task.status === "in-progress" ? "active" : task.status}</span>
                        )}
                        {!isEditingStatus && (
                          <button title="Allocate Hours" onClick={e => { e.stopPropagation(); setAllocateTask(task); }}
                            className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-slate-300 hover:text-amber-500 transition-all rounded shrink-0">
                            <Timer className="w-3 h-3" />
                          </button>
                        )}
                        {!isEditingStatus && task.status !== "completed" && (
                          <button title="Mark as Done" onClick={e => openActualPopover(task, e)}
                            className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-slate-300 hover:text-emerald-500 transition-all rounded shrink-0">
                            <CheckCircle2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Col 5: Actions */}
                    <td className="px-1 py-0 h-10 align-middle w-[44px] relative" onClick={e => e.stopPropagation()}>
                      <button onClick={e => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : task.id); setDatePopover(null); }}
                        className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded transition-all opacity-0 group-hover:opacity-100 mx-auto">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-1 top-9 z-[200] w-44 bg-white border border-slate-100 rounded-lg shadow-xl py-1">
                          <button onClick={() => { setSelectedTask(task); setOpenMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                            <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" /> Open Details
                          </button>
                          {viewMode !== "archive" && (<>
                            <button onClick={() => { setParentForNewSubtask(task); setIsAddingTask(true); setOpenMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                              <Layers className="w-3 h-3 text-slate-400 shrink-0" /> Add Subtask
                            </button>
                            <button onClick={() => { setAllocateTask(task); setOpenMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                              <Timer className="w-3 h-3 text-slate-400 shrink-0" /> Allocate Hours
                            </button>
                            <div className="h-px bg-slate-100 my-1" />
                            <button onClick={() => handleArchive(task.id)} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-red-500 hover:bg-red-50 transition-colors">
                              <Archive className="w-3 h-3 shrink-0" /> Archive
                            </button>
                          </>)}
                          {viewMode === "archive" && (
                            <button onClick={() => handleRestore(task.id)} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors">
                              <RotateCcw className="w-3 h-3 shrink-0" /> Restore
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* CALENDAR */}
        {viewMode === "calendar" && (
          <div className="p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <GlobalCalendar projectId={projectId} onTaskClick={t => { const full = flattenTasks(tasks).find((x: any) => x.id === t.id); if (full) setSelectedTask(full); }} filteredTasks={tasks} />
          </div>
        )}

        {/* KANBAN */}
        {viewMode === "kanban" && (
          <KanbanView
            tasks={displayTasks}
            lanes={kanbanBoard?.lanes ?? []}
            onTaskMove={handleKanbanMove}
            onTaskClick={task => { const full = flattenTasks(tasks).find(x => x.id === task.id); if (full) setSelectedTask(full as Task); }}
            canEdit={canEditKanban}
            onSetupClick={() => setShowKanbanSetup(true)}
          />
        )}

        {/* GANTT */}
        {viewMode === "gantt" && (
           <div className="h-full bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
              <InteractiveGantt
                events={(isLevelZero ? transformToLevelZero(displayTasks) : displayTasks).map((t: any) => ({
                  id: t.id,
                  taskCode: t.taskCode || "",
                  subject: t.subject || "",
                  startDate: (t.plannedStart || "").split("T")[0],
                  endDate: (t.plannedEnd || t.plannedStart || "").split("T")[0],
                  owner: t.owner || "",
                  status: t.status || "pending",
                  durationHours: t.durationHours,
                  paddingDays: t.paddingDays || 0,
                  externalPlannedEnd: t.externalPlannedEnd,
                  depth: t.depth || 0,
                  parentId: t.parentId,
                  expanded: expandedTasks.has(t.id),
                  isSummary: t.isSummary,
                  projectName: t.project?.name || t.projectName,
                }))}
                onUpdateEvents={() => {}}
                scale={ganttScale}
                ganttRef={ganttRef}
                onTaskClick={(id: string) => { const t = flattenTasks(tasks).find(x => x.id === id); if (t) setSelectedTask(t); }}
                onToggleExpand={id => { const n = new Set(expandedTasks); if (n.has(id)) n.delete(id); else n.add(id); setExpandedTasks(n); }}
                onUpdateBuffer={(id, padding) => setBufferTask({ id, padding })}
              />
           </div>
        )}
      </div>

      {/* ── DateTime Popover (planned & actual) ── */}
      {datePopover && (
        <div
          className="fixed z-[300] bg-white border border-slate-200 rounded-xl shadow-2xl p-3 w-[288px]"
          style={{ top: datePopover.pos.top, left: datePopover.pos.left }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              {datePopover.mode === "actual"
                ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                : <Calendar className="w-3 h-3 text-primary" />}
              <span className={`text-[9px] font-bold uppercase tracking-widest ${datePopover.mode === "actual" ? "text-emerald-600" : "text-primary"}`}>
                {datePopover.mode === "actual" ? "Actual Window — Mark Done" : "Planned Window"}
              </span>
            </div>
            <button onClick={() => setDatePopover(null)} className="text-slate-300 hover:text-slate-500 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-2">
            {/* Date row */}
            <div className="flex gap-2">
              <div className="flex-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Start Date</span>
                <input type="date" value={datePopover.startDate}
                  onChange={e => setDatePopover(p => p ? { ...p, startDate: e.target.value } : null)}
                  className="mt-0.5 w-full h-7 px-2 bg-slate-50 border border-slate-100 rounded-md text-[10px] font-semibold text-slate-700 outline-none focus:border-primary/40 transition-colors" />
              </div>
              <div className="flex-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">End Date</span>
                <input type="date" value={datePopover.endDate}
                  onChange={e => setDatePopover(p => p ? { ...p, endDate: e.target.value } : null)}
                  className="mt-0.5 w-full h-7 px-2 bg-slate-50 border border-slate-100 rounded-md text-[10px] font-semibold text-slate-700 outline-none focus:border-primary/40 transition-colors" />
              </div>
            </div>
            {/* Time N/A toggle — only for planned mode */}
            {datePopover.mode === "planned" && (
              <label className="flex items-center gap-2 cursor-pointer select-none" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={datePopover.timeNA}
                  onChange={e => setDatePopover(p => p ? { ...p, timeNA: e.target.checked } : null)}
                  className="w-3 h-3 rounded accent-primary" />
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Time not applicable</span>
                {datePopover.task.subtasks?.length > 0 && !datePopover.timeNA && (
                  <span className="text-[8px] text-amber-500 font-bold uppercase tracking-widest">— suggested for parent</span>
                )}
              </label>
            )}
            {/* Time row — drag-to-select slider, hidden when N/A */}
            {!datePopover.timeNA && (
              <div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Time Window</span>
                <div className="mt-0.5">
                  <StitchTimePicker
                    key={`${datePopover.taskId}-${datePopover.mode}`}
                    defaultValue={{ start: datePopover.startTime, end: datePopover.endTime }}
                    onSelect={(s, e) => {
                      const [sh, sm] = s.split(":").map(Number);
                      const [eh, em] = e.split(":").map(Number);
                      const newDuration = Math.round(((eh + em / 60) - (sh + sm / 60)) * 4) / 4;
                      setDatePopover(p => p ? { ...p, startTime: s, endTime: e, durationHours: newDuration > 0 ? newDuration : p.durationHours } : null);
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Conflict warning — only in planned mode */}
          {datePopover.mode === "planned" && (datePopover.task as any).conflictInfo && (
            <ConflictWarning
              conflicts={(datePopover.task as any).conflictInfo}
              taskOwner={datePopover.task.owner}
              taskDurationHours={datePopover.durationHours ?? 8}
              onAutoAdjust={(suggestedStart, suggestedEnd) => {
                const [sd] = suggestedStart.split("T");
                const [ed] = suggestedEnd.split("T");
                const st = suggestedStart.split("T")[1]?.substring(0, 5) ?? "09:00";
                const et = suggestedEnd.split("T")[1]?.substring(0, 5) ?? "17:00";
                setDatePopover(p => p ? { ...p, startDate: sd, endDate: ed, startTime: st, endTime: et } : null);
              }}
            />
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={datePopover.mode === "actual" ? saveActualPopover : savePlannedPopover}
              disabled={popoverSaving}
              className={`flex-1 py-1.5 text-white rounded-md text-[9px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 ${datePopover.mode === "actual" ? "bg-emerald-500 hover:bg-emerald-600" : "bg-primary hover:bg-primary-dark"}`}
            >
              {popoverSaving ? "Saving..." : datePopover.mode === "actual" ? "Mark Done" : "Save"}
            </button>
            <button onClick={() => { setDatePopover(null); setEditingCell(null); }}
              className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-md text-[9px] font-bold uppercase tracking-widest hover:bg-slate-200 transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {isAddingTask && (() => {
        const existing = parentForNewSubtask ? flattenTasks(tasks).filter((t: any) => t.parentId === parentForNewSubtask.id) : [];
        const allocated = existing.reduce((s: number, t: any) => s + (t.durationHours || 0), 0);
        return (
          <AddTaskModal projectId={projectId} parentId={parentForNewSubtask?.id} parentName={parentForNewSubtask?.subject}
            parentDates={parentForNewSubtask ? { start: parentForNewSubtask.plannedStart, end: parentForNewSubtask.plannedEnd } : undefined}
            parentDurationHours={parentForNewSubtask?.durationHours} allocatedHours={allocated}
            onClose={() => setIsAddingTask(false)} onSuccess={() => { setRefreshKey(p => p + 1); setIsAddingTask(false); }} />
        );
      })()}
      {allocateTask && (
        <AllocateHoursModal projectId={projectId}
          parentTask={{ id: allocateTask.id, subject: allocateTask.subject, durationHours: allocateTask.durationHours ?? 8, plannedStart: allocateTask.plannedStart, plannedEnd: allocateTask.plannedEnd }}
          onClose={() => setAllocateTask(null)} onSuccess={() => { setRefreshKey(p => p + 1); setAllocateTask(null); }} />
      )}
      {selectedTask && (
        <TaskDetailModal task={selectedTask} kanbanBoard={kanbanBoard} onClose={() => setSelectedTask(null)}
          onUpdated={() => { setRefreshKey(p => p + 1); setSelectedTask(null); }}
          onAllocateHours={t => { setAllocateTask(t); setSelectedTask(null); }} />
      )}
      {cascadeInfo && !cascadeConfirmed && <ParentAdjustmentModal {...cascadeInfo} onConfirm={() => setCascadeConfirmed(true)} onCancel={handleRescheduleCancel} />}
      {rescheduleInfo && (!cascadeInfo || cascadeConfirmed) && <ConfirmRescheduleModal {...rescheduleInfo} onClose={handleRescheduleCancel} onConfirm={handleRescheduleConfirm} />}
      {showKanbanSetup && (
        <KanbanSetupModal
          projectId={projectId}
          board={kanbanBoard}
          canEdit={canEditKanban}
          onClose={() => setShowKanbanSetup(false)}
          onSaved={board => { setKanbanBoard(board); setShowKanbanSetup(false); }}
        />
      )}
      {kanbanTransition && (
        <KanbanTransitionModal
          task={kanbanTransition.task}
          targetLane={{ id: kanbanTransition.laneId, name: kanbanTransition.laneName, mappedStatus: kanbanTransition.mappedStatus }}
          onCancel={() => setKanbanTransition(null)}
          onConfirm={async extra => {
            await applyKanbanMove(kanbanTransition.task.id, kanbanTransition.laneId, kanbanTransition.mappedStatus, extra);
            setKanbanTransition(null);
          }}
        />
      )}
      {bufferTask && (
        <BufferModal
          taskId={bufferTask.id}
          currentPadding={bufferTask.padding}
          onClose={() => setBufferTask(null)}
          onSuccess={(_newPadding) => {
            setBufferTask(null);
            fetchTasks();
          }}
        />
      )}
    </div>
  );
}

function transformToLevelZero(tasks: any[]): any[] {
  const projectGroups: Record<string, any[]> = {};
  tasks.forEach(t => {
    const pid = t.projectId || "UNKNOWN";
    if (!projectGroups[pid]) projectGroups[pid] = [];
    projectGroups[pid].push(t);
  });

  return Object.entries(projectGroups).map(([pid, pTasks]) => {
    const earliestStart = pTasks.reduce((min, t) => (t.plannedStart < min ? t.plannedStart : min), pTasks[0].plannedStart);
    const latestEnd = pTasks.reduce((max, t) => (t.plannedEnd > max ? t.plannedEnd : max), pTasks[0].plannedEnd);
    const projectName = pTasks[0].projectName || `Project: ${pid}`;
    
    return {
      id: `L0_${pid}`,
      projectId: pid,
      projectName,
      taskCode: "L0",
      subject: projectName.toUpperCase(),
      plannedStart: earliestStart,
      plannedEnd: latestEnd,
      status: pTasks.every(t => t.status === 'completed') ? 'completed' : 'in-progress',
      isSummary: true
    };
  });
}
