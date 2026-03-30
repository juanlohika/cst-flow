"use client";

import React, { useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";

interface Task {
  id: string;
  subject: string;
  status: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  subtasks?: Task[];
}

interface TargetLane {
  id: string;
  name: string;
  mappedStatus: string;
}

interface Props {
  task: Task;
  targetLane: TargetLane;
  onConfirm: (extraData: {
    plannedStart?: string;
    plannedEnd?: string;
    actualStart?: string;
    actualEnd?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

function parseDT(val?: string | null, fallbackDate = "", fallbackTime = "09:00"): [string, string] {
  if (!val) return [fallbackDate, fallbackTime];
  const d = new Date(String(val).replace(" ", "T"));
  if (isNaN(d.getTime())) return [fallbackDate, fallbackTime];
  return [
    d.toISOString().split("T")[0],
    `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
  ];
}

function getSubtaskActuals(task: Task): { minStart?: Date; maxEnd?: Date; hasActuals: boolean } {
  if (!task.subtasks?.length) return { hasActuals: false };
  const starts = task.subtasks.filter(s => s.actualStart).map(s => new Date(String(s.actualStart).replace(" ", "T"))).filter(d => !isNaN(d.getTime()));
  const ends = task.subtasks.filter(s => s.actualEnd).map(s => new Date(String(s.actualEnd).replace(" ", "T"))).filter(d => !isNaN(d.getTime()));
  if (!starts.length || !ends.length) return { hasActuals: false };
  return {
    minStart: new Date(Math.min(...starts.map(d => d.getTime()))),
    maxEnd: new Date(Math.max(...ends.map(d => d.getTime()))),
    hasActuals: true,
  };
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  "in-progress": "In Progress",
  completed: "Completed",
};

export default function KanbanTransitionModal({ task, targetLane, onConfirm, onCancel }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const toStatus = targetLane.mappedStatus;

  // Determine required fields
  const needsPlanned = toStatus === "in-progress" && task.status === "pending" && (!task.plannedStart || !task.plannedEnd);
  const needsActual = toStatus === "completed";

  // Incomplete subtask check (block completion)
  const incompleteSubs = (task.subtasks || []).filter(s => s.status !== "completed");
  const blockedBySubtasks = needsActual && incompleteSubs.length > 0;

  // Planned date state — pre-fill from existing task dates
  const [pStartDate, setPStartDate] = useState(() => parseDT(task.plannedStart, today)[0]);
  const [pStartTime, setPStartTime] = useState(() => parseDT(task.plannedStart, today, "09:00")[1]);
  const [pEndDate, setPEndDate] = useState(() => parseDT(task.plannedEnd, today)[0]);
  const [pEndTime, setPEndTime] = useState(() => parseDT(task.plannedEnd, today, "17:00")[1]);

  // Actual date state — auto-inherit from subtasks if available, else from task's own actuals
  const subtaskActuals = getSubtaskActuals(task);
  const [aStartDate, setAStartDate] = useState(() => {
    if (subtaskActuals.hasActuals && subtaskActuals.minStart) return subtaskActuals.minStart.toISOString().split("T")[0];
    return parseDT(task.actualStart, today)[0];
  });
  const [aStartTime, setAStartTime] = useState(() => {
    if (subtaskActuals.hasActuals && subtaskActuals.minStart) {
      const d = subtaskActuals.minStart;
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    }
    return parseDT(task.actualStart, today, "09:00")[1];
  });
  const [aEndDate, setAEndDate] = useState(() => {
    if (subtaskActuals.hasActuals && subtaskActuals.maxEnd) return subtaskActuals.maxEnd.toISOString().split("T")[0];
    return parseDT(task.actualEnd || task.actualStart, today)[0];
  });
  const [aEndTime, setAEndTime] = useState(() => {
    if (subtaskActuals.hasActuals && subtaskActuals.maxEnd) {
      const d = subtaskActuals.maxEnd;
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    }
    return parseDT(task.actualEnd || task.actualStart, today, "17:00")[1];
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Blocked by incomplete subtasks ──
  if (blockedBySubtasks) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-[13px] font-semibold text-text-primary">Cannot Complete Task</h3>
              <p className="text-[12px] text-text-secondary mt-1">
                {incompleteSubs.length} subtask{incompleteSubs.length > 1 ? "s" : ""} must be completed first:
              </p>
              <ul className="mt-2 space-y-1">
                {incompleteSubs.slice(0, 5).map(s => (
                  <li key={s.id} className="text-[11px] text-text-muted flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    {s.subject}
                  </li>
                ))}
                {incompleteSubs.length > 5 && (
                  <li className="text-[11px] text-text-muted">...and {incompleteSubs.length - 5} more</li>
                )}
              </ul>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={onCancel} className="px-4 py-2 text-[12px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors">
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleConfirm = async () => {
    setError("");
    const extraData: Record<string, string> = {};

    if (needsPlanned) {
      if (!pStartDate || !pEndDate) { setError("Planned start and end dates are required."); return; }
      if (new Date(`${pEndDate}T${pEndTime}`) < new Date(`${pStartDate}T${pStartTime}`)) {
        setError("Planned end must be after planned start."); return;
      }
      extraData.plannedStart = `${pStartDate}T${pStartTime}:00.000Z`;
      extraData.plannedEnd = `${pEndDate}T${pEndTime}:00.000Z`;
    }

    if (needsActual) {
      if (!aStartDate || !aEndDate) { setError("Actual start and end dates are required."); return; }
      if (new Date(`${aEndDate}T${aEndTime}`) < new Date(`${aStartDate}T${aStartTime}`)) {
        setError("Actual end must be after actual start."); return;
      }
      extraData.actualStart = `${aStartDate}T${aStartTime}:00.000Z`;
      extraData.actualEnd = `${aEndDate}T${aEndTime}:00.000Z`;
    }

    setSaving(true);
    try {
      await onConfirm(extraData);
    } catch (e: any) {
      setError(e.message || "Failed to update task");
      setSaving(false);
    }
  };

  const fromLabel = STATUS_LABEL[task.status] ?? task.status;
  const toLabel = STATUS_LABEL[toStatus] ?? toStatus;
  const statusChanging = task.status !== toStatus;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <div>
            <h3 className="text-[13px] font-semibold text-text-primary">Move to {targetLane.name}</h3>
            <p className="text-[11px] text-text-secondary mt-0.5 truncate max-w-[240px]">{task.subject}</p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded hover:bg-surface-muted text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Status change notice */}
          {statusChanging && (
            <div className="flex items-center gap-2 text-[11px] text-text-secondary bg-surface-subtle rounded-md px-3 py-2">
              <span className="font-medium">{fromLabel}</span>
              <span>→</span>
              <span className="font-medium text-text-primary">{toLabel}</span>
            </div>
          )}

          {/* Planned dates — only if missing and transitioning to in-progress */}
          {needsPlanned && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                Planned Schedule <span className="text-red-500">*</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">Start Date</label>
                  <input type="date" value={pStartDate} onChange={e => setPStartDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">Start Time</label>
                  <input type="time" value={pStartTime} onChange={e => setPStartTime(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">End Date</label>
                  <input type="date" value={pEndDate} onChange={e => setPEndDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">End Time</label>
                  <input type="time" value={pEndTime} onChange={e => setPEndTime(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
            </div>
          )}

          {/* Actual dates — required for completing a task */}
          {needsActual && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                Actual Dates <span className="text-red-500">*</span>
              </p>
              {subtaskActuals.hasActuals && (
                <p className="text-[10px] text-emerald-600 bg-emerald-50 rounded px-2 py-1">
                  Auto-filled from subtask actuals — adjust if needed
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">Actual Start</label>
                  <input type="date" value={aStartDate} onChange={e => setAStartDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">Start Time</label>
                  <input type="time" value={aStartTime} onChange={e => setAStartTime(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">Actual End</label>
                  <input type="date" value={aEndDate} onChange={e => setAEndDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-muted">End Time</label>
                  <input type="time" value={aEndTime} onChange={e => setAEndTime(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
            </div>
          )}

          {/* Simple confirmation when no extra fields are needed */}
          {!needsPlanned && !needsActual && (
            <p className="text-[12px] text-text-secondary">
              Move this task to <span className="font-medium text-text-primary">{targetLane.name}</span>
              {statusChanging && (
                <> — status will change from <span className="font-medium">{fromLabel}</span> to <span className="font-medium">{toLabel}</span></>
              )}?
            </p>
          )}

          {error && (
            <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1.5 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-default flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-[12px] font-medium border border-border-default rounded-md hover:bg-surface-subtle transition-colors">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-[12px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            Confirm Move
          </button>
        </div>
      </div>
    </div>
  );
}
