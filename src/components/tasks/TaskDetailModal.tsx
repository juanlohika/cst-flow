"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Clock,
  User,
  Calendar,
  CheckCircle2,
  AlertCircle,
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
  Tag
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
  isLocal = false
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

  const [members, setMembers] = useState<{ users: {id:string;name:string;email:string}[]; roles: {id:string;name:string}[] }>({ users: [], roles: [] });
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
  const subtaskDates = hasSubtasks ? task.subtasks.map((s: any) => ({
    start: s.plannedStart ? new Date(String(s.plannedStart).replace(" ", "T")) : null,
    end:   s.plannedEnd   ? new Date(String(s.plannedEnd).replace(" ", "T"))   : null,
    hours: s.durationHours || 0,
  })).filter((s: any) => s.start && s.end) : [];
  const allocRange = subtaskDates.length > 0 ? {
    start: new Date(Math.min(...subtaskDates.map((s: any) => s.start!.getTime()))),
    end:   new Date(Math.max(...subtaskDates.map((s: any) => s.end!.getTime()))),
    totalHours: subtaskDates.reduce((sum: number, s: any) => sum + s.hours, 0),
  } : null;

  // Normalize SQLite space-separated datetimes ("2024-01-15 09:30:00") to ISO T-format
  const normalizeDT = (dt: string) => dt.replace(" ", "T");
  const toDatePart = (dt: string | null | undefined) => {
    if (!dt) return new Date().toISOString().split('T')[0];
    const d = new Date(normalizeDT(dt));
    return isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0];
  };
  const toTimePart = (dt: string | null | undefined, fallback: string) => {
    if (!dt) return fallback;
    const d = new Date(normalizeDT(dt));
    if (isNaN(d.getTime())) return fallback;
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  };
  const [pStart, setPStart] = useState(() => toDatePart(task.plannedStart));
  const [pEnd, setPEnd] = useState(() => toDatePart(task.plannedEnd));
  const [pStartTime, setPStartTime] = useState(() => toTimePart(task.plannedStart, "09:00"));
  const [pEndTime, setPEndTime] = useState(() => toTimePart(task.plannedEnd, "17:00"));

  // Actual Times
  const [aStart, setAStart] = useState(() => toDatePart(task.actualStart));
  const [aEnd, setAEnd] = useState(() => toDatePart(task.actualEnd));
  const [aStartTime, setAStartTime] = useState(() => toTimePart(task.actualStart, "09:00"));
  const [aEndTime, setAEndTime] = useState(() => toTimePart(task.actualStart, "11:00"));

  // AUTO-CALCULATE EXTERNAL DEADLINE (Leg Room)
  useEffect(() => {
    if (!pEnd) return;
    const newEnd = addDaysSkippingWeekends(pEnd, editPaddingDays || 0);
    setEditExternalEnd(newEnd);
  }, [pEnd, editPaddingDays]);

  // Confirmation step — which status action is pending confirmation
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
    // Refresh history in background
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
    // Remark required only when reverting to pending from a non-pending state
    if (newStatus === 'pending' && task.status !== 'pending' && !comment.trim()) {
      showToast("A remark is required when reverting to Pending", "error");
      return;
    }

    // For in-progress and completed, require a confirmation step first
    if (newStatus === 'in-progress' && confirmingStatus !== 'in-progress') {
      setConfirmingStatus('in-progress');
      return;
    }
    if (newStatus === 'completed' && confirmingStatus !== 'completed') {
      // Block completion if any subtask is still incomplete
      if (task.subtasks && task.subtasks.length > 0) {
        const incomplete = task.subtasks.filter((s: any) => s.status !== 'completed');
        if (incomplete.length > 0) {
          showToast(`Cannot complete: ${incomplete.length} subtask${incomplete.length > 1 ? 's' : ''} still not done`, "error");
          setActiveTab("subtasks");
          return;
        }
        // All subtasks complete — auto-inherit actual date range from them
        const actuals = task.subtasks
          .filter((s: any) => s.actualStart && s.actualEnd)
          .map((s: any) => ({
            start: new Date(String(s.actualStart).replace(' ', 'T')),
            end:   new Date(String(s.actualEnd).replace(' ', 'T')),
          }))
          .filter((s: any) => !isNaN(s.start.getTime()) && !isNaN(s.end.getTime()));
        if (actuals.length > 0) {
          const minStart = new Date(Math.min(...actuals.map((s: any) => s.start.getTime())));
          const maxEnd   = new Date(Math.max(...actuals.map((s: any) => s.end.getTime())));
          setAStart(minStart.toISOString().split('T')[0]);
          setAEnd(maxEnd.toISOString().split('T')[0]);
          setAStartTime(`${String(minStart.getUTCHours()).padStart(2,'0')}:${String(minStart.getUTCMinutes()).padStart(2,'0')}`);
          setAEndTime(`${String(maxEnd.getUTCHours()).padStart(2,'0')}:${String(maxEnd.getUTCMinutes()).padStart(2,'0')}`);
        }
      }
      setConfirmingStatus('completed');
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
        actualStart: (newStatus === 'in-progress' || newStatus === 'completed') ? aStartISO : undefined,
        actualEnd: newStatus === 'completed' ? aEndISO : undefined,
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
    } catch (err: any) {
      showToast("Archive failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-xl max-h-[85vh] rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">

        {/* Header */}
        <div className="p-4 border-b bg-slate-50/30 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white shadow shrink-0 mt-0.5 ${
              task.status === 'completed' ? 'bg-emerald-500' :
              task.status === 'in-progress' ? 'bg-slate-800' :
              'bg-slate-400'
            }`}>
              {task.status === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[9px] font-bold text-primary uppercase tracking-widest opacity-60">{task.taskCode}</span>
              <input
                value={editSubject}
                onChange={e => setEditSubject(e.target.value)}
                className="w-full text-sm font-bold text-slate-800 tracking-tight uppercase leading-tight bg-transparent border-b border-transparent hover:border-slate-200 focus:border-primary focus:outline-none transition-colors px-0.5 mt-0.5"
                placeholder="Task name..."
              />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onAllocateHours && !task.archived && (
              <button
                onClick={() => { onAllocateHours(task); onClose(); }}
                title="Allocate Hours as Sub-tasks"
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:bg-amber-50 rounded-md transition-all border border-amber-200"
              >
                <Timer className="w-3 h-3" /> Allocate
              </button>
            )}
            {!task.archived && (
              <button onClick={handleDelete} disabled={loading} className="p-1.5 text-slate-300 hover:text-rose-500 transition-all rounded-md hover:bg-rose-50">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-slate-900 transition-all rounded-md hover:bg-slate-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-4 border-b bg-white">
          {[
            { id: 'details', label: 'Overview', icon: <AlertCircle className="w-3 h-3" /> },
            { id: 'subtasks', label: 'Subtasks', icon: <Layers className="w-3 h-3" /> },
            { id: 'recurring', label: 'Recurring', icon: <RefreshCw className="w-3 h-3" /> },
            { id: 'history', label: 'History', icon: <History className="w-3 h-3" /> }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-all relative ${
                activeTab === tab.id ? 'text-primary' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {tab.icon} {tab.label}
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 thin-scrollbar">
          {activeTab === 'details' && (
            <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  {/* Assignee */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                      <User className="w-3 h-3" /> Assignee
                    </label>
                    <div className="flex gap-1 bg-slate-100 rounded-md p-0.5 w-fit mb-1.5">
                      <button type="button"
                        onClick={() => { setAssignType("role"); setEditAssignedTo(""); setEditOwner(members.roles[0]?.name || "PM"); }}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${assignType === "role" ? "bg-white text-slate-800 shadow-sm" : "text-slate-400"}`}>
                        <Tag className="w-2.5 h-2.5 inline mr-1 opacity-70" />Role
                      </button>
                      <button type="button"
                        onClick={() => { setAssignType("user"); setEditOwner(""); setEditAssignedTo(members.users[0]?.id || ""); }}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${assignType === "user" ? "bg-white text-slate-800 shadow-sm" : "text-slate-400"}`}>
                        <User className="w-2.5 h-2.5 inline mr-1 opacity-70" />User
                      </button>
                    </div>

                    {assignType === "role" ? (
                      <select
                        className="w-full bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 outline-none appearance-none"
                        value={editOwner}
                        onChange={(e) => { setEditOwner(e.target.value); setEditAssignedTo(""); }}
                      >
                        {members.roles.map(r => <option key={r.id} value={r.name}>{r.name.toUpperCase()}</option>)}
                        {members.roles.length === 0 && <option value="TBD">NO ROLES FOUND</option>}
                      </select>
                    ) : (
                      <div className="space-y-2">
                        {/* Selected Users Badges */}
                        <div className="flex flex-wrap gap-1.5 min-h-[32px] p-1.5 bg-slate-50 border border-slate-100 rounded-md">
                          {editAssignedIds.length === 0 && <span className="text-[10px] text-slate-300 font-medium italic">No users assigned</span>}
                          {editAssignedIds.map(id => {
                            const u = members.users.find(m => m.id === id);
                            return (
                              <div key={id} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-0.5 rounded-lg shadow-sm">
                                <span className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">{u?.name || "User"}</span>
                                <button
                                  type="button"
                                  onClick={() => setEditAssignedIds(prev => prev.filter(aid => aid !== id))}
                                  className="text-slate-300 hover:text-rose-500 transition-colors"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        
                        <select
                          className="w-full bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 outline-none appearance-none cursor-pointer hover:border-primary/30 transition-colors"
                          value=""
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val || editAssignedIds.includes(val)) return;
                            setEditAssignedIds(prev => [...prev, val]);
                          }}
                        >
                          <option value="">+ Add team member</option>
                          {members.users.map(u => (
                            <option key={u.id} value={u.id}>
                              {u.name || u.email}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Project */}
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Project</span>
                    <p className="text-[12px] font-bold text-slate-700 uppercase tracking-tight">{task.project?.name || "—"}</p>
                  </div>

                  {/* Kanban lane */}
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Kanban Lane</span>
                    <p className="text-[12px] font-bold text-slate-700 uppercase tracking-tight">
                      {getLaneName(task.kanbanLaneId, task.status)}
                    </p>
                  </div>

                  {/* Description */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                      <Pencil className="w-3 h-3" /> Description
                    </label>
                    <textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      placeholder="Add context or notes..."
                      rows={2}
                      className="w-full text-[12px] text-slate-600 bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all resize-none"
                    />
                  </div>

                  {/* Budget Hours */}
                  <div className="space-y-1 pt-2 border-t border-dashed border-slate-100">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                      <Timer className="w-3 h-3" /> Budget Hours
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0.25}
                        step={0.25}
                        value={editBudgetHours}
                        onChange={e => setEditBudgetHours(parseFloat(e.target.value) || 0)}
                        className="w-20 text-[12px] font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
                      />
                      <span className="text-[10px] text-slate-400 font-semibold">hours planned</span>
                    </div>
                  </div>

                  {/* Planned Window */}
                  <div className="space-y-1.5 pt-2 border-t border-dashed border-slate-100">
                    <span className={`text-[10px] font-bold uppercase tracking-widest block transition-colors ${confirmingStatus === 'in-progress' ? 'text-slate-800' : 'text-slate-400'}`}>
                      Planned Window {confirmingStatus === 'in-progress' && <span className="text-amber-500 normal-case font-normal ml-1">— confirm before starting</span>}
                    </span>
                    {hasSubtasks && allocRange ? (
                      <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-xl space-y-1">
                        <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">Driven by subtask allocations</p>
                        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                          <Calendar className="w-3.5 h-3.5 text-amber-500 opacity-60 shrink-0" />
                          <span>{allocRange.start.toISOString().split("T")[0]}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-200 shrink-0" />
                          <span>{allocRange.end.toISOString().split("T")[0]}</span>
                        </div>
                        <p className="text-[10px] font-bold text-amber-700">
                          {allocRange.totalHours}h across {task.subtasks.length} subtask{task.subtasks.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    ) : (
                      <div className={`p-2.5 border rounded-xl space-y-1.5 shadow-sm transition-all ${confirmingStatus === 'in-progress' ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                          <input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px] text-[11px]" />
                          <ArrowRight className="w-3.5 h-3.5 text-slate-200 shrink-0" />
                          <input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px] text-[11px]" />
                        </div>
                        <StitchTimePicker
                          defaultValue={{ start: pStartTime, end: pEndTime }}
                          onSelect={(s, e) => { setPStartTime(s); setPEndTime(e); }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Client Visibility (Leg Room) */}
                  <div className="space-y-1.5 p-2.5 bg-emerald-50/40 border border-emerald-100 rounded-xl shadow-sm">
                    <span className="text-[10px] font-bold uppercase tracking-widest block text-emerald-700 mb-1">
                      Client Visibility (Leg Room)
                    </span>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Client Buffer</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            value={editPaddingDays}
                            onChange={e => setEditPaddingDays(parseInt(e.target.value) || 0)}
                            className="w-12 h-6 text-[11px] font-bold text-center bg-white border border-emerald-200 rounded text-emerald-800 outline-none focus:ring-1 focus:ring-emerald-400 transition-all"
                          />
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Days</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1.5 border-t border-emerald-100/50">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Client Deadline</span>
                        <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-emerald-700">
                          <Calendar size={12} className="opacity-60" />
                          <input 
                            type="date"
                            value={editExternalEnd}
                            onChange={e => setEditExternalEnd(e.target.value)}
                            className="bg-transparent border-none p-0 outline-none w-[100px] text-right"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Current Status</span>
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        task.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                        task.status === 'in-progress' ? 'bg-slate-800 text-white' :
                        'bg-slate-100 text-slate-400'
                      }`}>{task.status}</span>
                      <button
                        onClick={() => { onClose(); (window as any).dispatchAddTask?.(task); }}
                        className="px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary hover:bg-primary/20 transition-all flex items-center gap-1"
                      >
                        <Layers className="w-3 h-3" /> Add Subtask
                      </button>
                    </div>
                  </div>

                  {/* Actual Window */}
                  <div className={`p-2.5 border rounded-xl space-y-1.5 transition-all shadow-sm ${
                    confirmingStatus === 'completed'
                      ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-200'
                      : task.status === 'pending' && !confirmingStatus
                        ? 'opacity-40 grayscale pointer-events-none border-dashed border-slate-200'
                        : 'bg-emerald-50/20 border-dashed border-emerald-100'
                  }`}>
                    <div className="flex items-center justify-between">
                      <p className={`text-[9px] font-bold uppercase tracking-widest leading-none ${confirmingStatus === 'completed' ? 'text-emerald-700' : 'text-emerald-600'}`}>
                        Actual Window {confirmingStatus === 'completed' && <span className="normal-case font-normal ml-1">— confirm before completing</span>}
                      </p>
                      {!task.actualStart && task.status !== 'pending' && !confirmingStatus && <PlayCircle className="w-3 h-3 text-emerald-500 animate-pulse" />}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-800">
                      <input type="date" value={aStart} onChange={(e) => setAStart(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px] text-[11px]" />
                      <ArrowRight className="w-3.5 h-3.5 text-emerald-200 shrink-0" />
                      <input type="date" value={aEnd} onChange={(e) => setAEnd(e.target.value)} className="bg-transparent border-none p-0 outline-none w-[110px] text-[11px]" />
                    </div>
                    <StitchTimePicker
                      defaultValue={{ start: aStartTime, end: aEndTime }}
                      onSelect={(s, e) => { setAStartTime(s); setAEndTime(e); }}
                    />
                  </div>
                </div>
              </div>

              {!task.archived && (
                <div className="pt-3 border-t space-y-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                      Remarks <span className="normal-case font-normal opacity-60">(required only when reverting to Pending)</span>
                    </label>
                    <textarea
                      className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-[12px] font-medium text-slate-600 outline-none focus:ring-2 focus:ring-primary/10 transition-all min-h-[50px] resize-none"
                      placeholder="Add context for this change (optional)..."
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </div>
                  {confirmingStatus ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdateStatus(confirmingStatus)}
                        disabled={loading}
                        className={`flex-1 py-2 text-white rounded-md text-[10px] font-bold uppercase tracking-widest transition-all shadow active:scale-95 disabled:opacity-50 ${
                          confirmingStatus === 'completed' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-slate-800 hover:bg-black'
                        }`}
                      >
                        {loading ? "Saving..." : confirmingStatus === 'completed' ? "Confirm & Mark Done" : "Confirm & Start"}
                      </button>
                      <button
                        onClick={() => setConfirmingStatus(null)}
                        disabled={loading}
                        className="px-4 py-2 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => handleUpdateStatus('completed')} disabled={loading} className="flex-1 py-2 bg-emerald-500 text-white rounded-md text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-all shadow active:scale-95 disabled:opacity-50">Mark Done</button>
                      <button onClick={() => handleUpdateStatus('in-progress')} disabled={loading} className="flex-1 py-2 bg-slate-800 text-white rounded-md text-[10px] font-bold uppercase tracking-widest hover:bg-black transition-all shadow active:scale-95 disabled:opacity-50">Start</button>
                      <button onClick={() => handleUpdateStatus('pending')} disabled={loading} className="flex-1 py-2 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50">Pending</button>
                    </div>
                  )}
                  <button onClick={handleSaveDetails} disabled={loading} className="w-full py-2 border border-primary/20 text-primary rounded-md text-[10px] font-bold uppercase tracking-widest hover:bg-primary/5 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50">
                    <Save className="w-3 h-3" /> Save Details
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'subtasks' && (
            <div className="space-y-2 animate-in fade-in duration-300">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Child Hierarchies</h3>
                <button
                  onClick={() => { onClose(); (window as any).dispatchAddTask?.(task); }}
                  className="px-3 py-1.5 bg-primary text-white rounded-md text-[9px] font-bold uppercase tracking-widest hover:bg-primary-dark transition-all flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3" /> New Subtask
                </button>
              </div>
              {task.subtasks && task.subtasks.length > 0 ? (
                task.subtasks.map((sub: any) => (
                  <div key={sub.id} className="px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-between hover:border-primary/20 transition-all">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[9px] font-bold text-primary uppercase opacity-60 shrink-0">{sub.taskCode}</span>
                      <span className="text-[12px] font-semibold text-slate-700 uppercase truncate">{sub.subject}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-semibold text-slate-400">{sub.owner}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                        sub.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                        sub.status === 'in-progress' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-400'
                      }`}>{sub.status}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-16 flex flex-col items-center justify-center opacity-30 text-slate-400">
                  <Layers className="w-10 h-10 mb-3" />
                  <p className="text-[10px] font-bold uppercase tracking-widest">No Subtasks Defined</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'recurring' && (
            <div className="animate-in fade-in duration-300">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Recurring Schedule</p>
              <RecurringConfig
                isRecurringTemplate={recurringPatch.isRecurringTemplate}
                recurringFrequency={recurringPatch.recurringFrequency}
                recurringUntil={recurringPatch.recurringUntil}
                onChange={patch => setRecurringPatch(prev => ({ ...prev, ...patch }))}
              />
              <div className="mt-4 pt-4 border-t border-slate-100">
                <button
                  onClick={handleSaveRecurring}
                  disabled={recurringSaving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-white text-[11px] font-bold uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50"
                >
                  <Save className="w-3 h-3" />
                  {recurringSaving ? "Saving…" : "Save Recurring Settings"}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {historyLoading ? (
                <div className="py-20 flex items-center justify-center opacity-40 text-slate-400">
                  <div className="w-5 h-5 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
                </div>
              ) : history.length > 0 ? (
                history.map((entry: any, i: number) => (
                  <div key={i} className="relative pl-8 pb-6 border-l border-slate-100 last:pb-0">
                    <div className="absolute left-[-5px] top-0 w-[9px] h-[9px] rounded-full bg-slate-200" />
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <Clock className="w-3 h-3" /> {new Date(entry.createdAt).toLocaleString()}
                      </div>
                      <p className="text-[11px] font-bold text-slate-700 uppercase opacity-60">
                        {entry.type === "status_change" && `Status: ${entry.oldValue} → ${entry.newValue}`}
                        {entry.type === "reschedule" && `Rescheduled: ${entry.oldValue} → ${entry.newValue}`}
                        {entry.type === "remark" && "Remark added"}
                        {!["status_change","reschedule","remark"].includes(entry.type) && entry.type.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">by {entry.changedBy}</p>
                      {entry.comment && (
                        <div className="mt-2 p-3 bg-slate-50 border border-slate-100 rounded-xl flex gap-3 italic">
                          <MessageSquare className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                          <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{entry.comment}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-20 flex flex-col items-center justify-center opacity-30 text-slate-400 text-center">
                  <History className="w-12 h-12 mb-4" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em]">No History Found</p>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
