"use client";

import React, { useState, useEffect, useCallback } from "react";
import { X, Clock, Calendar, CheckCircle, Loader2, ChevronDown, ChevronRight, Plus, Trash2, Users, Shield } from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";
import MultiUserSelect from "@/components/ui/MultiUserSelect";

interface AllocateHoursModalProps {
  projectId: string;
  parentTask: { id: string; subject: string; durationHours: number; plannedStart?: string; plannedEnd?: string };
  onClose: () => void;
  onSuccess: () => void;
}

interface DayRow {
  date: string; // YYYY-MM-DD
  title: string;
  hours: number;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  assignedIds: string[];
  role: string;
}

interface ExistingSubtask {
  id: string;
  subject: string;
  plannedStart: string;
  plannedEnd: string;
  durationHours: number;
  owner: string;
}

// Timezone-safe date iteration using local Date constructor
function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Build ISO for planned start/end from a date + specific time string
function buildTimeISO(dateStr: string, timeStr: string): string {
  if (!timeStr) return `${dateStr}T09:00:00.000Z`;
  const [h, m] = timeStr.split(":").map(s => s.padStart(2, "0"));
  return `${dateStr}T${h}:${m}:00.000Z`;
}

function flattenAll(tasks: any[]): any[] {
  return tasks.flatMap(t => [t, ...(t.subtasks ? flattenAll(t.subtasks) : [])]);
}

function normDate(s: string): string {
  return String(s).replace(" ", "T");
}

function toLocalDateStr(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(normDate(isoStr));
  if (isNaN(d.getTime())) return "";
  // Use UTC date to avoid local-timezone drift from noon-UTC storage
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function AllocateHoursModal({ projectId, parentTask, onClose, onSuccess }: AllocateHoursModalProps) {
  const { showToast } = useToast();
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [rows, setRows] = useState<DayRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [existingSubtasks, setExistingSubtasks] = useState<ExistingSubtask[]>([]);
  const [existingAllocated, setExistingAllocated] = useState(0);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [showExisting, setShowExisting] = useState(true);

  // Assignee options
  const [users, setUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    setLoadingExisting(true);
    Promise.all([
      fetch(`/api/tasks?projectId=${projectId}`).then(r => r.json()).catch(() => []),
      fetch("/api/users").then(r => r.json()).catch(() => []),
      fetch("/api/settings/roles").then(r => r.json()).catch(() => []),
    ]).then(([tasks, usersData, rolesData]) => {
      if (Array.isArray(tasks)) {
        const allTasks = flattenAll(tasks);
        const subs: ExistingSubtask[] = allTasks
          .filter((t: any) => t.parentId === parentTask.id)
          .map((t: any) => ({
            id: t.id,
            subject: t.subject,
            plannedStart: t.plannedStart,
            plannedEnd: t.plannedEnd,
            durationHours: t.durationHours || 0,
            owner: t.owner || "",
          }));
        setExistingSubtasks(subs);
        setExistingAllocated(subs.reduce((s, t) => s + t.durationHours, 0));
      }
      if (Array.isArray(usersData)) setUsers(usersData);
      if (Array.isArray(rolesData)) setRoles(rolesData);
    }).finally(() => setLoadingExisting(false));
  }, [parentTask.id, projectId]);

  const timeToFloat = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h + (m || 0) / 60;
  };

  const floatToTime = (f: number) => {
    const h = Math.floor(f);
    const m = Math.round((f - h) * 60);
    return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  // Rebuild new rows when date range changes
  useEffect(() => {
    if (!dateRange.start || !dateRange.end || dateRange.start > dateRange.end) { setRows([]); return; }
    const dates = datesBetween(dateRange.start, dateRange.end);
    const remaining = Math.max(0, parentTask.durationHours - existingAllocated);
    const evenHours = dates.length > 0 ? Math.round((remaining / dates.length) * 4) / 4 : 1;
    
    // Default start at 9:00 AM
    const startT = "09:00";
    const endT = floatToTime(timeToFloat(startT) + evenHours);

    setRows(dates.map(date => ({ 
      date, 
      title: "", 
      hours: evenHours, 
      startTime: startT, 
      endTime: endT,
      assignedIds: [],
      role: ""
    })));
  }, [dateRange.start, dateRange.end, parentTask.durationHours, existingAllocated]);

  const budget = parentTask.durationHours;
  const newlyAllocated = rows.reduce((sum, r) => sum + (r.hours || 0), 0);
  const totalUsed = existingAllocated + newlyAllocated;
  const remaining = Math.max(0, budget - existingAllocated);
  const overBudget = totalUsed > budget;
  const [showExceedWarning, setShowExceedWarning] = useState(false);

  const updateRow = (idx: number, field: keyof DayRow, value: any) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      let next = { ...r, [field]: value };

      // Sync logic
      if (field === "hours") {
        // Sync EndTime: End = Start + Hours
        const startF = timeToFloat(next.startTime);
        next.endTime = floatToTime(startF + Number(value));
      } else if (field === "startTime" || field === "endTime") {
        // Sync Hours: Hours = End - Start
        const s = timeToFloat(next.startTime);
        const e = timeToFloat(next.endTime);
        next.hours = Math.max(0, Math.round((e - s) * 100) / 100);
      }

      return next;
    }));
    setShowExceedWarning(false);
  };

  const addRow = () => {
    const lastDate = rows.length > 0 ? rows[rows.length - 1].date : (dateRange.end || dateRange.start || today);
    setRows(prev => [...prev, { 
      date: lastDate, 
      title: "", 
      hours: 1, 
      startTime: "09:00", 
      endTime: "10:00",
      assignedIds: [],
      role: ""
    }]);
  };

  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const today = new Date().toISOString().split("T")[0];

  const handleConfirm = async () => {
    if (rows.length === 0) { showToast("Select a date range first", "error"); return; }
    const emptyTitles = rows.filter(r => !r.title.trim());
    if (emptyTitles.length > 0) { showToast("Fill in all task titles", "error"); return; }

    if (overBudget && !showExceedWarning) {
      setShowExceedWarning(true);
      return;
    }

    setSaving(true);
    try {
      // 1. If budget exceeded and confirmed, update parent budget first
      if (overBudget) {
        await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: parentTask.id, durationHours: totalUsed }),
        });
      }

      // 2. Create subtasks
      for (const row of rows) {
        const startISO = buildTimeISO(row.date, row.startTime);
        const endISO = buildTimeISO(row.date, row.endTime);
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            parentId: parentTask.id,
            subject: row.title.trim(),
            owner: row.role || (row.assignedIds.length > 0 ? "" : "TBD"),
            assignedIds: row.assignedIds,
            plannedStart: startISO,
            plannedEnd: endISO,
            durationHours: row.hours,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create subtask");
        }
      }
      showToast(`${rows.length} subtask${rows.length > 1 ? "s" : ""} allocated`, "success");
      onSuccess();
    } catch (err: any) {
      showToast(err.message || "Failed to allocate hours", "error");
    } finally {
      setSaving(false);
    }
  };

  const AssigneeSelect = ({ row, onChange }: { row: DayRow; onChange: (ids: string[], role: string) => void }) => {
    const [open, setOpen] = useState(false);
    
    // Display labels
    let label = "— Unassigned —";
    if (row.role) label = row.role;
    else if (row.assignedIds.length > 0) {
      if (row.assignedIds.length === 1) {
        const u = users.find(u => u.id === row.assignedIds[0]);
        label = u?.name || u?.email || "1 User";
      } else {
        label = `${row.assignedIds.length} Users`;
      }
    }

    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`w-full flex items-center justify-between border rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none transition-all h-7 ${
            open ? "ring-2 ring-primary border-primary bg-white" : "border-slate-100 bg-white text-slate-600 hover:border-slate-200"
          }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            {row.role ? <Shield className="w-2.5 h-2.5 text-primary opacity-60" /> : row.assignedIds.length > 0 ? <Users className="w-2.5 h-2.5 text-primary opacity-60" /> : null}
            <span className="truncate uppercase tracking-tight">{label}</span>
          </div>
          <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-200 ${open ? "rotate-180 opacity-100" : "opacity-30"}`} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-[210]">
              <MultiUserSelect
                assignedIds={row.assignedIds}
                role={row.role}
                users={users}
                roles={roles}
                onChange={(ids, r) => {
                  onChange(ids, r);
                }}
                onClose={() => setOpen(false)}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="p-4 border-b bg-slate-50/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white shadow">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tight">Allocate Hours as Sub-tasks</h2>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5 max-w-sm truncate">
                {parentTask.subject}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-slate-800 rounded-md hover:bg-slate-100 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Parent date range */}
        {(parentTask.plannedStart || parentTask.plannedEnd) && (
          <div className="px-4 py-2 border-b bg-slate-50/60 flex items-center gap-2 shrink-0">
            <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Parent Range:</span>
            <span className="text-[10px] font-bold text-slate-700">
              {parentTask.plannedStart ? toLocalDateStr(parentTask.plannedStart) : "—"}
            </span>
            <span className="text-slate-300 text-[10px]">→</span>
            <span className="text-[10px] font-bold text-slate-700">
              {parentTask.plannedEnd ? toLocalDateStr(parentTask.plannedEnd) : "—"}
            </span>
            <span className="text-[9px] text-slate-400 ml-auto italic">Subtasks outside range auto-extend parent</span>
          </div>
        )}

        {/* Budget summary */}
        <div className="px-4 py-2.5 border-b bg-blue-50/40 shrink-0">
          {loadingExisting ? (
            <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase tracking-wider">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                <span className="text-slate-500">Budget: <span className="text-slate-800">{budget}h</span></span>
                <span className="text-slate-500">Used: <span className="text-amber-600">{existingAllocated}h</span></span>
                <span className="text-slate-500">Left: <span className={remaining <= 0 ? "text-red-600" : "text-emerald-600"}>{remaining}h</span></span>
                {rows.length > 0 && <span className={`${overBudget ? "text-red-500" : "text-primary"}`}>+ {newlyAllocated}h</span>}
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden flex">
                <div className="h-full bg-amber-300 transition-all" style={{ width: `${Math.min((existingAllocated / budget) * 100, 100)}%` }} />
                <div className={`h-full transition-all ${overBudget ? "bg-red-400" : "bg-primary"}`}
                  style={{ width: `${Math.min((newlyAllocated / budget) * 100, Math.max(0, 100 - (existingAllocated / budget) * 100))}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y">

          {/* Existing allocations */}
          {!loadingExisting && existingSubtasks.length > 0 && (
            <div>
              <button
                onClick={() => setShowExisting(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2 bg-amber-50/60 text-[10px] font-bold uppercase tracking-widest text-amber-700 hover:bg-amber-50 transition-colors"
              >
                <span>Previously Allocated — {existingSubtasks.length} task{existingSubtasks.length > 1 ? "s" : ""} · {existingAllocated}h</span>
                {showExisting ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>

              {showExisting && (
                <div className="divide-y bg-amber-50/20">
                  <div className="grid grid-cols-[110px_1fr_48px_120px] gap-2 px-4 py-1 bg-slate-50 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    <span>Date</span><span>Title</span><span>Hrs</span><span>Assignee</span>
                  </div>
                  {existingSubtasks.map(sub => (
                    <div key={sub.id} className="grid grid-cols-[110px_1fr_48px_120px] gap-2 px-4 py-1.5 items-center opacity-70">
                      <span className="text-[10px] font-semibold text-slate-500">
                        {toLocalDateStr(sub.plannedStart) ? formatDay(toLocalDateStr(sub.plannedStart)) : "—"}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600 truncate">{sub.subject}</span>
                      <span className="text-[11px] font-semibold text-slate-600 text-center">{sub.durationHours}h</span>
                      <span className="text-[10px] font-semibold text-slate-500 truncate">{sub.owner || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* New allocation: date range + rows */}
          <div>
            <div className="px-4 py-2 bg-slate-50/30 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b flex items-center gap-2">
              <Calendar className="w-3 h-3 text-primary opacity-60" />
              Add New Allocation — Select Date Range
            </div>
            <div className="px-4 py-2 flex items-center gap-2 border-b bg-white">
              <input
                type="date"
                value={dateRange.start}
                onChange={e => setDateRange(r => ({ ...r, start: e.target.value }))}
                className="border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 bg-white outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-slate-300 text-xs">—</span>
              <input
                type="date"
                value={dateRange.end}
                min={dateRange.start}
                onChange={e => setDateRange(r => ({ ...r, end: e.target.value }))}
                className="border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 bg-white outline-none focus:ring-2 focus:ring-primary"
              />
              {rows.length > 0 && (
                <span className="text-[10px] text-slate-400 font-semibold">{rows.length} day{rows.length > 1 ? "s" : ""}</span>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-[11px]">Pick a date range above to generate rows</div>
            ) : (
              <div className="divide-y overflow-x-auto thin-scrollbar">
                <div className="min-w-[800px]">
                  <div className="grid grid-cols-[120px_1fr_160px_50px_150px_32px] gap-2 px-4 py-1.5 bg-slate-50 text-[9px] font-bold text-slate-400 uppercase tracking-widest border-b">
                    <span>Date</span><span>Task Title</span><span>Time Window</span><span>Hrs</span><span>Assignee</span><span />
                  </div>
                  {rows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[120px_1fr_160px_50px_150px_32px] gap-2 px-4 py-2 items-center hover:bg-slate-50/50 group border-b last:border-b-0">
                      <input
                        type="date"
                        value={row.date}
                        onChange={e => updateRow(idx, "date", e.target.value)}
                        className="w-full border border-slate-100 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-600 bg-white outline-none focus:ring-2 focus:ring-primary"
                      />
                      <input
                        type="text"
                        placeholder="Task title..."
                        value={row.title}
                        onChange={e => updateRow(idx, "title", e.target.value)}
                        className="w-full border border-slate-100 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                      
                      {/* Time Window */}
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          value={row.startTime}
                          onChange={e => updateRow(idx, "startTime", e.target.value)}
                          className="w-full border border-slate-100 rounded-md px-1.5 py-1 text-[10px] font-semibold text-slate-600 bg-white outline-none focus:ring-2 focus:ring-primary h-7"
                        />
                        <span className="text-slate-300">—</span>
                        <input
                          type="time"
                          value={row.endTime}
                          onChange={e => updateRow(idx, "endTime", e.target.value)}
                          className="w-full border border-slate-100 rounded-md px-1.5 py-1 text-[10px] font-semibold text-slate-600 bg-white outline-none focus:ring-2 focus:ring-primary h-7"
                        />
                      </div>

                      <input
                        type="number"
                        min={0.25}
                        step={0.25}
                        value={row.hours}
                        onChange={e => updateRow(idx, "hours", parseFloat(e.target.value) || 0)}
                        className="w-full border border-slate-100 rounded-md px-1 py-1 text-[11px] font-bold text-primary bg-white outline-none focus:ring-2 focus:ring-primary text-center h-7"
                      />
                      
                      <AssigneeSelect row={row} onChange={(ids, role) => {
                        updateRow(idx, "assignedIds", ids);
                        updateRow(idx, "role", role);
                      }} />

                      <button onClick={() => removeRow(idx)} title="Remove row"
                        className="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all rounded-md">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Add row button — always visible once date range is picked or manually */}
            <div className="px-4 py-2 border-t">
              <button onClick={addRow}
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary hover:text-primary/70 transition-colors">
                <Plus className="w-3 h-3" /> Add Row
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-slate-50/20 flex flex-col gap-3 shrink-0">
          {showExceedWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center animate-in slide-in-from-bottom-2 duration-300">
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-tight mb-2">
                ⚠️ Warning: Total allocation ({totalUsed}h) exceeds parent budget ({budget}h). 
                Proceeding will update the parent budget to match.
              </p>
              <div className="flex justify-center gap-4">
                <button onClick={() => setShowExceedWarning(false)} className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-600">Cancel</button>
                <button 
                  onClick={handleConfirm}
                  className="text-[10px] font-black uppercase text-amber-600 hover:text-amber-700"
                >
                  Confirm Anyway
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <button onClick={onClose} className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800 rounded-md hover:bg-slate-100 transition-all uppercase tracking-wider">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving || rows.length === 0}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all shadow-sm ${
                showExceedWarning 
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                  : "bg-primary text-white hover:bg-primary/90 shadow-primary/20"
              }`}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              {saving ? "Creating..." : `Allocate ${rows.length} Sub-task${rows.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
