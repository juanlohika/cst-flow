"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Clock,
  User,
  Calendar,
  CheckCircle2,
  Trash2,
  MessageSquare,
  History,
  Layers,
  ArrowRight,
  Plus,
  PlayCircle,
  Save,
  Pencil,
  Timer,
  RefreshCw,
  Tag,
  Loader2,
  CheckCheck,
  RotateCcw,
} from "lucide-react";
import StitchTimePicker from "@/components/ui/StitchTimePicker";
import { useToast } from "@/components/ui/ToastContext";
import RecurringConfig from "@/components/tasks/RecurringConfig";
import { addDaysSkippingWeekends } from "@/lib/date-utils";

interface TaskDetailModalProps {
  task: any;
  kanbanBoard?: any | null;
  onClose: () => void;
  onUpdated: () => void;
  onAllocateHours?: (task: any) => void;
  onLocalUpdate?: (updatedFields: any) => void;
  isLocal?: boolean;
}

export default function TaskDetailModal({
  task,
  kanbanBoard,
  onClose,
  onUpdated,
  onAllocateHours,
  onLocalUpdate,
  isLocal = false,
}: TaskDetailModalProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<"details" | "history" | "subtasks" | "recurring">("details");

  const getLaneName = (laneId?: string | null, status?: string) => {
    const assigned = laneId ? kanbanBoard?.lanes?.find((l: any) => l.id === laneId)?.name : undefined;
    if (assigned) return assigned;
    if (!status) return "Not mapped";
    const matchingLanes = kanbanBoard?.lanes?.filter((l: any) => l.mappedStatus === status) || [];
    return matchingLanes.length === 1 ? matchingLanes[0].name : "Not mapped";
  };

  const getDefaultLaneIdForStatus = (status: string) => {
    if (!kanbanBoard?.lanes) return undefined;
    const matchingLanes = kanbanBoard.lanes.filter((l: any) => l.mappedStatus === status);
    return matchingLanes.length === 1 ? matchingLanes[0].id : undefined;
  };

  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>(task.history || []);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (activeTab === "history" && !isLocal) {
      setHistoryLoading(true);
      fetch(`/api/tasks/${task.id}`)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setHistory(data); })
        .catch(() => {})
        .finally(() => setHistoryLoading(false));
    }
  }, [activeTab, task.id]);

  // Editable fields
  const [editSubject, setEditSubject] = useState(task.subject || "");
  const [editOwner, setEditOwner] = useState(task.owner || "");
  const [editAssignedTo, setEditAssignedTo] = useState(task.assignedTo || "");
  const [editAssignedIds, setEditAssignedIds] = useState<string[]>(
    task.assignments ? task.assignments.map((a: any) => a.userId) : []
  );
  const [editDescription, setEditDescription] = useState(task.description || "");
  const [editBudgetHours, setEditBudgetHours] = useState<number>(task.durationHours ?? 8);
  const [editPaddingDays, setEditPaddingDays] = useState<number>(task.paddingDays ?? 0);
  const [editExternalEnd, setEditExternalEnd] = useState<string>(task.externalPlannedEnd || "");

  const [members, setMembers] = useState<{ users: { id: string; name: string; email: string }[]; roles: { id: string; name: string }[] }>({ users: [], roles: [] });
  const [assignType, setAssignType] = useState<"role" | "user">(task.assignedTo ? "user" : "role");

  useEffect(() => {
    fetch("/api/users/members")
      .then(r => r.ok ? r.json() : { users: [], roles: [] })
      .then(setMembers)
      .catch(() => {});
  }, []);

  // Recurring state
  const [recurringPatch, setRecurringPatch] = useState({
    isRecurringTemplate: task.isRecurringTemplate ?? false,
    recurringFrequency: task.recurringFrequency ?? null,
    recurringUntil: task.recurringUntil ?? null,
  });
  const [recurringSaving, setRecurringSaving] = useState(false);

  const handleSaveRecurring = async () => {
    setRecurringSaving(true);
    try {
      await patchTask(recurringPatch);
      showToast("Recurring settings saved", "success");
      onUpdated();
    } catch (err: any) {
      showToast(err.message || "Save failed", "error");
    } finally {
      setRecurringSaving(false);
    }
  };

  // Derived allocation summary when task has subtasks
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const subtaskDates = hasSubtasks
    ? task.subtasks.map((s: any) => ({
        start: s.plannedStart ? new Date(String(s.plannedStart).replace(" ", "T")) : null,
        end: s.plannedEnd ? new Date(String(s.plannedEnd).replace(" ", "T")) : null,
        hours: s.durationHours || 0,
      })).filter((s: any) => s.start && s.end)
    : [];
  const allocRange = subtaskDates.length > 0
    ? {
        start: new Date(Math.min(...subtaskDates.map((s: any) => s.start!.getTime()))),
        end: new Date(Math.max(...subtaskDates.map((s: any) => s.end!.getTime()))),
        totalHours: subtaskDates.reduce((sum: number, s: any) => sum + s.hours, 0),
      }
    : null;

  // Normalize SQLite space-separated datetimes to ISO T-format
  const normalizeDT = (dt: string) => dt.replace(" ", "T");
  const toDatePart = (dt: string | null | undefined) => {
    if (!dt) return new Date().toISOString().split("T")[0];
    const d = new Date(normalizeDT(dt));
    return isNaN(d.getTime()) ? new Date().toISOString().split("T")[0] : d.toISOString().split("T")[0];
  };
  const toTimePart = (dt: string | null | undefined, fallback: string) => {
    if (!dt) return fallback;
    const d = new Date(normalizeDT(dt));
    if (isNaN(d.getTime())) return fallback;
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };

  const [pStart, setPStart] = useState(() => toDatePart(task.plannedStart));
  const [pEnd, setPEnd] = useState(() => toDatePart(task.plannedEnd));
  const [pStartTime, setPStartTime] = useState(() => toTimePart(task.plannedStart, "09:00"));
  const [pEndTime, setPEndTime] = useState(() => toTimePart(task.plannedEnd, "17:00"));

  const [aStart, setAStart] = useState(() => toDatePart(task.actualStart));
  const [aEnd, setAEnd] = useState(() => toDatePart(task.actualEnd));
  const [aStartTime, setAStartTime] = useState(() => toTimePart(task.actualStart, "09:00"));
  const [aEndTime, setAEndTime] = useState(() => toTimePart(task.actualStart, "11:00"));

  // AUTO-CALCULATE EXTERNAL DEADLINE
  useEffect(() => {
    if (!pEnd) return;
    const newEnd = addDaysSkippingWeekends(pEnd, editPaddingDays || 0);
    setEditExternalEnd(newEnd);
  }, [pEnd, editPaddingDays]);

  const [confirmingStatus, setConfirmingStatus] = useState<"in-progress" | "completed" | null>(null);

  const patchTask = async (fields: Record<string, any>) => {
    if (isLocal && onLocalUpdate) {
      onLocalUpdate(fields);
      return;
    }
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, ...fields }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Save failed");
    }
    fetch(`/api/tasks/${task.id}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setHistory(data); })
      .catch(() => {});
    return res.json();
  };

  const handleSaveDetails = async () => {
    if (!editSubject.trim()) { showToast("Task name cannot be empty", "error"); return; }
    setLoading(true);
    try {
      const pStartISO = `${pStart}T${pStartTime}:00.000Z`;
      const pEndISO = `${pEnd}T${pEndTime}:00.000Z`;
      await patchTask({
        subject: editSubject.trim(),
        owner: editOwner.trim() || null,
        assignedTo: editAssignedTo || null,
        assignedIds: editAssignedIds,
        description: editDescription.trim() || null,
        plannedStart: pStartISO,
        plannedEnd: pEndISO,
        durationHours: editBudgetHours,
        paddingDays: editPaddingDays,
        externalPlannedEnd: editExternalEnd,
        comment: comment.trim() || undefined,
      });
      showToast("Task updated", "success");
      onUpdated();
    } catch (err: any) {
      showToast(err.message || "Save failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    if (newStatus === "pending" && task.status !== "pending" && !comment.trim()) {
      showToast("A remark is required when reverting to Pending", "error");
      return;
    }
    if (newStatus === "in-progress" && confirmingStatus !== "in-progress") {
      setConfirmingStatus("in-progress");
      return;
    }
    if (newStatus === "completed" && confirmingStatus !== "completed") {
      if (task.subtasks && task.subtasks.length > 0) {
        const incomplete = task.subtasks.filter((s: any) => s.status !== "completed");
        if (incomplete.length > 0) {
          showToast(`Cannot complete: ${incomplete.length} subtask${incomplete.length > 1 ? "s" : ""} still not done`, "error");
          setActiveTab("subtasks");
          return;
        }
        const actuals = task.subtasks
          .filter((s: any) => s.actualStart && s.actualEnd)
          .map((s: any) => ({
            start: new Date(String(s.actualStart).replace(" ", "T")),
            end: new Date(String(s.actualEnd).replace(" ", "T")),
          }))
          .filter((s: any) => !isNaN(s.start.getTime()) && !isNaN(s.end.getTime()));
        if (actuals.length > 0) {
          const minStart = new Date(Math.min(...actuals.map((s: any) => s.start.getTime())));
          const maxEnd = new Date(Math.max(...actuals.map((s: any) => s.end.getTime())));
          setAStart(minStart.toISOString().split("T")[0]);
          setAEnd(maxEnd.toISOString().split("T")[0]);
          setAStartTime(`${String(minStart.getUTCHours()).padStart(2, "0")}:${String(minStart.getUTCMinutes()).padStart(2, "0")}`);
          setAEndTime(`${String(maxEnd.getUTCHours()).padStart(2, "0")}:${String(maxEnd.getUTCMinutes()).padStart(2, "0")}`);
        }
      }
      setConfirmingStatus("completed");
      return;
    }

    setLoading(true);
    try {
      const pStartISO = `${pStart}T${pStartTime}:00.000Z`;
      const pEndISO = `${pEnd}T${pEndTime}:00.000Z`;
      const aStartISO = `${aStart}T${aStartTime}:00.000Z`;
      const aEndISO = `${aEnd}T${aEndTime}:00.000Z`;
      const defaultLaneId = !task.kanbanLaneId ? getDefaultLaneIdForStatus(newStatus) : task.kanbanLaneId;

      await patchTask({
        subject: editSubject.trim(),
        owner: editOwner.trim() || null,
        assignedTo: editAssignedTo || null,
        description: editDescription.trim() || null,
        status: newStatus,
        comment: comment.trim() || undefined,
        plannedStart: pStartISO,
        plannedEnd: pEndISO,
        assignedIds: editAssignedIds,
        actualStart: (newStatus === "in-progress" || newStatus === "completed") ? aStartISO : undefined,
        actualEnd: newStatus === "completed" ? aEndISO : undefined,
        ...(defaultLaneId ? { kanbanLaneId: defaultLaneId } : {}),
      });

      setConfirmingStatus(null);
      showToast(`Status updated to ${newStatus}`, "success");
      onUpdated();
    } catch (err: any) {
      showToast(err.message || "Update failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Archive this task?")) return;
    setLoading(true);
    try {
      await patchTask({ archived: true });
      showToast("Task removed", "success");
      onUpdated();
    } catch {
      showToast("Archive failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const statusConfig = {
    completed:   { label: "Completed",   bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
    "in-progress": { label: "In Progress", bg: "bg-amber-100",   text: "text-amber-700",  border: "border-amber-200",  dot: "bg-amber-500" },
    pending:     { label: "Pending",     bg: "bg-slate-100",   text: "text-slate-500",  border: "border-slate-200",  dot: "bg-slate-400" },
  } as const;
  const currentStatus = (task.status as keyof typeof statusConfig) in statusConfig
    ? (task.status as keyof typeof statusConfig)
    : "pending";
  const statusCfg = statusConfig[currentStatus];

  const iconBg =
    currentStatus === "completed" ? "bg-emerald-500" :
    currentStatus === "in-progress" ? "bg-amber-500" :
    "bg-slate-300";

  const tabs = [
    { id: "details",   label: "Overview",  icon: <Clock className="w-3 h-3" /> },
    { id: "subtasks",  label: "Subtasks",  icon: <Layers className="w-3 h-3" /> },
    { id: "recurring", label: "Recurring", icon: <RefreshCw className="w-3 h-3" /> },
    { id: "history",   label: "History",   icon: <History className="w-3 h-3" /> },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl max-h-[88vh] rounded-lg shadow-2xl border border-border overflow-hidden flex flex-col">

        {/* ── HEADER ── */}
        <div className="px-5 py-4 border-b border-border bg-white flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Status icon tile */}
            <div className={`w-9 h-9 rounded-md flex items-center justify-center text-white shadow-sm shrink-0 mt-0.5 ${iconBg}`}>
              {currentStatus === "completed"
                ? <CheckCheck className="w-4 h-4" />
                : currentStatus === "in-progress"
                ? <PlayCircle className="w-4 h-4" />
                : <Clock className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wider opacity-80">{task.taskCode}</span>
                <span className={`inline-flex items-center gap-1.5 px-2 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                  {statusCfg.label}
                </span>
              </div>
              <input
                value={editSubject}
                onChange={e => setEditSubject(e.target.value)}
                className="w-full text-lg font-semibold text-text-primary bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none transition-colors px-0.5"
                placeholder="Task name..."
              />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onAllocateHours && !task.archived && (
              <button
                onClick={() => { onAllocateHours(task); onClose(); }}
                className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 hover:bg-amber-50 rounded-md transition-all border border-amber-200"
              >
                <Timer className="w-3.5 h-3.5" /> Allocate
              </button>
            )}
            {!task.archived && (
              <button onClick={handleDelete} disabled={loading} className="p-1.5 text-slate-300 hover:text-destructive transition-all rounded-md hover:bg-rose-50">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-text-primary transition-all rounded-md hover:bg-surface-subtle">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── TABS ── */}
        <div className="flex px-5 border-b border-border bg-white shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3 py-3 text-xs font-medium transition-all relative ${
                activeTab === tab.id ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.icon} {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-800 rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* ── CONTENT ── */}
        <div className="flex-1 overflow-auto p-5 space-y-4 thin-scrollbar bg-surface-subtle">

          {/* ══ DETAILS TAB ══ */}
          {activeTab === "details" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">

                {/* LEFT col — 3/5 */}
                <div className="md:col-span-3 space-y-3">

                  {/* Assignee card */}
                  <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-7 h-7 bg-primary-bg rounded-md flex items-center justify-center text-primary border border-primary-bg">
                        <User className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">Assignee</span>
                    </div>

                    {/* Type toggle */}
                    <div className="flex gap-1 bg-surface-muted rounded-md p-0.5 w-fit">
                      {(["role", "user"] as const).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setAssignType(t);
                            if (t === "role") { setEditAssignedTo(""); setEditOwner(members.roles[0]?.name || "PM"); }
                            else { setEditOwner(""); setEditAssignedTo(members.users[0]?.id || ""); }
                          }}
                          className={`flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
                            assignType === t ? "bg-white text-text-primary shadow-sm" : "text-text-secondary"
                          }`}
                        >
                          {t === "role" ? <Tag className="w-3 h-3" /> : <User className="w-3 h-3" />}
                          {t === "role" ? "Role" : "User"}
                        </button>
                      ))}
                    </div>

                    {assignType === "role" ? (
                      <select
                        className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-[11px] font-bold text-text-muted outline-none appearance-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        value={editOwner}
                        onChange={e => { setEditOwner(e.target.value); setEditAssignedTo(""); }}
                      >
                        {members.roles.map(r => <option key={r.id} value={r.name}>{r.name.toUpperCase()}</option>)}
                        {members.roles.length === 0 && <option value="TBD">NO ROLES FOUND</option>}
                      </select>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-surface-subtle border border-border rounded-md">
                          {editAssignedIds.length === 0 && (
                            <span className="text-[10px] text-text-secondary opacity-40 font-medium italic">No users assigned</span>
                          )}
                          {editAssignedIds.map(id => {
                            const u = members.users.find(m => m.id === id);
                            return (
                              <div key={id} className="inline-flex items-center gap-1.5 bg-primary-bg border border-primary/20 px-2 py-0.5 rounded-md">
                                <span className="text-[10px] font-semibold text-primary uppercase tracking-tight">{u?.name || "User"}</span>
                                <button type="button" onClick={() => setEditAssignedIds(prev => prev.filter(aid => aid !== id))} className="text-primary/40 hover:text-destructive transition-colors">
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <select
                          className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-[11px] font-bold text-text-muted outline-none appearance-none cursor-pointer hover:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                          value=""
                          onChange={e => {
                            const val = e.target.value;
                            if (!val || editAssignedIds.includes(val)) return;
                            setEditAssignedIds(prev => [...prev, val]);
                          }}
                        >
                          <option value="">+ Add team member</option>
                          {members.users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Meta card — Project + Kanban */}
                  <div className="bg-white rounded-lg border border-border shadow-sm p-4 grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Project</span>
                      <p className="text-sm font-semibold text-text-primary uppercase">{task.project?.name || "—"}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Kanban Lane</span>
                      <p className="text-sm font-semibold text-text-primary uppercase">{getLaneName(task.kanbanLaneId, task.status)}</p>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-7 h-7 bg-surface-subtle rounded-md flex items-center justify-center text-text-secondary border border-border">
                        <Pencil className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">Description</span>
                    </div>
                    <textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      placeholder="Add context or notes..."
                      rows={2}
                      className="w-full text-sm text-text-primary bg-surface-subtle border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                    />
                  </div>

                  {/* Budget hours + planned window */}
                  <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-7 h-7 bg-primary-bg rounded-md flex items-center justify-center text-primary border border-primary-bg">
                        <Timer className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">Schedule</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={0.25}
                        step={0.25}
                        value={editBudgetHours}
                        onChange={e => setEditBudgetHours(parseFloat(e.target.value) || 0)}
                        className="w-20 text-sm font-semibold text-text-primary bg-surface-subtle border border-border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-center"
                      />
                      <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Hours Planned</span>
                    </div>

                    <div className={`p-3 border rounded-md space-y-2 transition-all ${
                      confirmingStatus === "in-progress"
                        ? "bg-amber-50 border-amber-300 ring-2 ring-amber-200"
                        : "bg-surface-subtle border-border"
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${confirmingStatus === "in-progress" ? "text-amber-600" : "text-text-secondary"}`}>
                          Planned Window {confirmingStatus === "in-progress" && <span className="normal-case font-normal ml-1">— confirm before starting</span>}
                        </span>
                      </div>
                      {hasSubtasks && allocRange ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-tight">Driven by subtask allocations</p>
                          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                            <Calendar className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>{allocRange.start.toISOString().split("T")[0]}</span>
                            <ArrowRight className="w-4 h-4 text-text-secondary shrink-0" />
                            <span>{allocRange.end.toISOString().split("T")[0]}</span>
                          </div>
                          <p className="text-xs font-medium text-amber-700">{allocRange.totalHours}h across {task.subtasks.length} subtask{task.subtasks.length !== 1 ? "s" : ""}</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                            <input type="date" value={pStart} onChange={e => setPStart(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px]" />
                            <ArrowRight className="w-4 h-4 text-text-secondary shrink-0" />
                            <input type="date" value={pEnd} onChange={e => setPEnd(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px]" />
                          </div>
                          <StitchTimePicker
                            defaultValue={{ start: pStartTime, end: pEndTime }}
                            onSelect={(s, e) => { setPStartTime(s); setPEndTime(e); }}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* RIGHT col — 2/5 */}
                <div className="md:col-span-2 space-y-3">

                  {/* Client Leg Room */}
                  <div className="bg-white rounded-lg border border-orange-200 shadow-sm p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-7 h-7 bg-orange-50 rounded-md flex items-center justify-center text-orange-500 border border-orange-200">
                        <Timer className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">Client Leg Room</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Buffer Days</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            value={editPaddingDays}
                            onChange={e => setEditPaddingDays(parseInt(e.target.value) || 0)}
                            className="w-14 h-7 text-sm font-semibold text-center bg-orange-50 border border-orange-200 rounded-md text-orange-700 outline-none focus:ring-2 focus:ring-orange-400/20 transition-all"
                          />
                          <span className="text-[10px] font-semibold text-text-secondary uppercase">Days</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-orange-100">
                        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Client Deadline</span>
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-orange-600">
                          <Calendar className="w-4 h-4 opacity-70" />
                          <input
                            type="date"
                            value={editExternalEnd}
                            onChange={e => setEditExternalEnd(e.target.value)}
                            className="bg-transparent border-none p-0 outline-none w-[100px] text-right text-orange-600 font-semibold"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status + Subtask shortcut */}
                  <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-2">
                    <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Current Status</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium border ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                        {statusCfg.label}
                      </span>
                      <button
                        onClick={() => { onClose(); (window as any).dispatchAddTask?.(task); }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-primary-bg text-primary hover:bg-primary/10 border border-primary/20 transition-all"
                      >
                        <Layers className="w-3.5 h-3.5" /> Add Subtask
                      </button>
                    </div>
                  </div>

                  {/* Actual Window */}
                  <div className={`bg-white rounded-lg border shadow-sm p-4 space-y-2 transition-all ${
                    confirmingStatus === "completed"
                      ? "border-emerald-400 ring-2 ring-emerald-200"
                      : task.status === "pending" && !confirmingStatus
                      ? "opacity-40 grayscale pointer-events-none border-dashed border-border"
                      : "border-emerald-100"
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-emerald-50 rounded-md flex items-center justify-center text-emerald-600 border border-emerald-100">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <span className={`text-xs font-semibold uppercase tracking-wide ${confirmingStatus === "completed" ? "text-emerald-700" : "text-text-primary"}`}>
                          Actual Window
                          {confirmingStatus === "completed" && <span className="normal-case font-normal text-emerald-600 ml-1">— confirm to complete</span>}
                        </span>
                      </div>
                      {!task.actualStart && task.status !== "pending" && !confirmingStatus && (
                        <PlayCircle className="w-4 h-4 text-emerald-500 animate-pulse" />
                      )}
                    </div>
                    <div className={`p-2.5 rounded-md space-y-1.5 ${confirmingStatus === "completed" ? "bg-emerald-50 border border-emerald-100" : "bg-surface-subtle border border-border"}`}>
                      <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <input type="date" value={aStart} onChange={e => setAStart(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px]" />
                        <ArrowRight className="w-4 h-4 text-text-secondary shrink-0" />
                        <input type="date" value={aEnd} onChange={e => setAEnd(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px]" />
                      </div>
                      <StitchTimePicker
                        defaultValue={{ start: aStartTime, end: aEndTime }}
                        onSelect={(s, e) => { setAStartTime(s); setAEndTime(e); }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── ACTION FOOTER ── */}
              {!task.archived && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
                  {/* Remarks */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">
                      Remarks <span className="normal-case font-normal opacity-60">(required only when reverting to Pending)</span>
                    </label>
                    <textarea
                      className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all min-h-[44px] resize-none"
                      placeholder="Add context for this change (optional)..."
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                    />
                  </div>

                  {/* Status buttons */}
                  {confirmingStatus ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdateStatus(confirmingStatus)}
                        disabled={loading}
                        className={`flex-1 py-2.5 text-white rounded-md text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 ${
                          confirmingStatus === "completed"
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : "bg-amber-500 hover:bg-amber-600"
                        }`}
                      >
                        {loading
                          ? <Loader2 size={13} className="animate-spin" />
                          : confirmingStatus === "completed"
                          ? <><CheckCheck size={14} /> Confirm &amp; Mark Done</>
                          : <><PlayCircle size={14} /> Confirm &amp; Start</>}
                      </button>
                      <button
                        onClick={() => setConfirmingStatus(null)}
                        disabled={loading}
                        className="px-4 py-2.5 bg-surface-muted text-text-secondary rounded-md text-xs font-semibold uppercase tracking-wider hover:bg-surface-subtle transition-all disabled:opacity-50 border border-border"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdateStatus("completed")}
                        disabled={loading}
                        className="flex-1 py-2.5 bg-emerald-600 text-white rounded-md text-xs font-semibold uppercase tracking-wider hover:bg-emerald-700 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <CheckCheck size={14} /> Mark Done
                      </button>
                      <button
                        onClick={() => handleUpdateStatus("in-progress")}
                        disabled={loading}
                        className="flex-1 py-2.5 bg-amber-500 text-white rounded-md text-xs font-semibold uppercase tracking-wider hover:bg-amber-600 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <PlayCircle size={14} /> Start
                      </button>
                      <button
                        onClick={() => handleUpdateStatus("pending")}
                        disabled={loading}
                        className="flex-1 py-2.5 bg-surface-muted text-text-secondary rounded-md text-xs font-semibold uppercase tracking-wider hover:bg-surface-subtle border border-border transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw size={14} /> Pending
                      </button>
                    </div>
                  )}

                  {/* Save details */}
                  <button
                    onClick={handleSaveDetails}
                    disabled={loading}
                    className="w-full py-2.5 bg-primary hover:bg-primary-hover text-white rounded-md text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-primary/20 disabled:opacity-50"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save Details
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ══ SUBTASKS TAB ══ */}
          {activeTab === "subtasks" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Subtasks</h3>
                <button
                  onClick={() => { onClose(); (window as any).dispatchAddTask?.(task); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-[11px] font-semibold uppercase tracking-wider hover:bg-primary-hover transition-all shadow-sm shadow-primary/10"
                >
                  <Plus className="w-3.5 h-3.5" /> New Subtask
                </button>
              </div>
              {task.subtasks && task.subtasks.length > 0 ? (
                <div className="space-y-2">
                  {task.subtasks.map((sub: any) => (
                    <div key={sub.id} className="px-4 py-3 bg-white border border-border rounded-lg flex items-center justify-between hover:border-primary/30 transition-all shadow-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold text-primary uppercase tracking-wider opacity-70 shrink-0">{sub.taskCode}</span>
                        <span className="text-sm font-semibold text-text-primary uppercase truncate">{sub.subject}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-medium text-text-secondary">{sub.owner}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${
                          sub.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          sub.status === "in-progress" ? "bg-amber-50 text-amber-700 border-amber-200" :
                          "bg-surface-muted text-text-secondary border-border"
                        }`}>{sub.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-16 flex flex-col items-center justify-center text-text-secondary opacity-40 text-center">
                  <Layers className="w-12 h-12 mb-3 stroke-1" />
                  <p className="text-xs font-semibold uppercase tracking-widest">No Subtasks Defined</p>
                </div>
              )}
            </div>
          )}

          {/* ══ RECURRING TAB ══ */}
          {activeTab === "recurring" && (
            <div className="bg-white rounded-lg border border-border shadow-sm p-6 animate-in fade-in duration-200">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-5">Recurring Schedule</p>
              <RecurringConfig
                isRecurringTemplate={recurringPatch.isRecurringTemplate}
                recurringFrequency={recurringPatch.recurringFrequency}
                recurringUntil={recurringPatch.recurringUntil}
                onChange={patch => setRecurringPatch(prev => ({ ...prev, ...patch }))}
              />
              <div className="mt-6 pt-6 border-t border-border">
                <button
                  onClick={handleSaveRecurring}
                  disabled={recurringSaving}
                  className="flex items-center gap-1.5 px-6 py-2.5 rounded-md bg-primary text-white text-[11px] font-semibold uppercase tracking-wider hover:bg-primary-hover transition-all shadow-sm shadow-primary/10 disabled:opacity-50"
                >
                  {recurringSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {recurringSaving ? "Saving…" : "Save Recurring Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ══ HISTORY TAB ══ */}
          {activeTab === "history" && (
            <div className="animate-in fade-in duration-200">
              {historyLoading ? (
                <div className="py-20 flex items-center justify-center text-text-secondary opacity-30">
                  <Loader2 className="w-8 h-8 animate-spin stroke-1" />
                </div>
              ) : history.length > 0 ? (
                <div className="space-y-0">
                  {history.map((entry: any, i: number) => (
                    <div key={i} className="relative pl-8 pb-5 border-l-2 border-border last:border-transparent">
                      <div className="absolute left-[-6px] top-1.5 w-2.5 h-2.5 rounded-full bg-border border-2 border-white" />
                      <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-2">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(entry.createdAt).toLocaleString()}
                          <span className="ml-auto opacity-70">by {entry.changedBy}</span>
                        </div>
                        <p className="text-sm font-semibold text-text-primary uppercase tracking-tight">
                          {entry.type === "status_change" && `Status: ${entry.oldValue} → ${entry.newValue}`}
                          {entry.type === "reschedule" && `Rescheduled: ${entry.oldValue} → ${entry.newValue}`}
                          {entry.type === "remark" && "Remark added"}
                          {!["status_change", "reschedule", "remark"].includes(entry.type) && entry.type.replace(/_/g, " ")}
                        </p>
                        {entry.comment && (
                          <div className="flex gap-2.5 p-3 bg-surface-subtle border border-border rounded-md">
                            <MessageSquare className="w-4 h-4 text-text-secondary opacity-40 shrink-0 mt-0.5" />
                            <p className="text-sm text-text-primary leading-relaxed italic">{entry.comment}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-20 flex flex-col items-center justify-center text-text-secondary opacity-40 text-center">
                  <History className="w-16 h-16 mb-4 stroke-1" />
                  <p className="text-xs font-semibold uppercase tracking-widest">No History Found</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
