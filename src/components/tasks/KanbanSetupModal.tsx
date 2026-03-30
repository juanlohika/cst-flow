"use client";

import React, { useState } from "react";
import { X, GripVertical, Plus, Trash2, Loader2 } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in-progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

const LANE_COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#64748b"];

const DEFAULT_LANES = [
  { name: "Backlog", mappedStatus: "pending", color: "#64748b" },
  { name: "In Progress", mappedStatus: "in-progress", color: "#0ea5e9" },
  { name: "Staging", mappedStatus: "in-progress", color: "#6366f1" },
  { name: "QA Testing", mappedStatus: "in-progress", color: "#f59e0b" },
  { name: "UAT", mappedStatus: "in-progress", color: "#8b5cf6" },
  { name: "Go Live", mappedStatus: "completed", color: "#10b981" },
];

interface Lane {
  id?: string;
  name: string;
  mappedStatus: string;
  color: string;
}

interface Props {
  projectId: string;
  board: any | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (board: any) => void;
}

export default function KanbanSetupModal({ projectId, board, canEdit, onClose, onSaved }: Props) {
  const [lanes, setLanes] = useState<Lane[]>(
    board?.lanes?.length
      ? board.lanes.map((l: any) => ({ id: l.id, name: l.name, mappedStatus: l.mappedStatus, color: l.color || "#64748b" }))
      : DEFAULT_LANES.map(l => ({ ...l }))
  );
  const [boardName, setBoardName] = useState(board?.name || "Kanban Board");
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const addLane = () => {
    setLanes(prev => [...prev, { name: "", mappedStatus: "in-progress", color: "#64748b" }]);
  };

  const removeLane = (i: number) => {
    setLanes(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateLane = (i: number, patch: Partial<Lane>) => {
    setLanes(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  };

  const handleDragStart = (i: number) => setDragIndex(i);
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setLanes(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(i);
  };
  const handleDragEnd = () => setDragIndex(null);

  const save = async () => {
    const valid = lanes.every(l => l.name.trim());
    if (!valid) { alert("All lanes must have a name."); return; }
    setSaving(true);
    try {
      const method = board ? "PATCH" : "POST";
      const res = await fetch(`/api/kanban/${projectId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: boardName, lanes }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      const data = await res.json();
      onSaved(data);
    } catch (err: any) {
      alert(err.message);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default flex-shrink-0">
          <div>
            <h2 className="text-[14px] font-semibold text-text-primary">Kanban Board Setup</h2>
            <p className="text-[11px] text-text-secondary mt-0.5">Define lanes and map each to a base status</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-muted text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!canEdit && board ? (
          <div className="p-5 space-y-3">
            <p className="text-[12px] text-text-secondary bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Only the project creator or an admin can edit this board.
            </p>
            <div className="space-y-1.5">
              {lanes.map((lane, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 border border-border-default rounded-md">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: lane.color }} />
                  <span className="text-[12px] font-medium text-text-primary flex-1">{lane.name}</span>
                  <span className="text-[10px] text-text-muted bg-surface-subtle px-2 py-0.5 rounded capitalize">{lane.mappedStatus}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Board name */}
            <div className="px-5 pt-4 flex-shrink-0">
              <label className="block text-[11px] font-medium text-text-secondary mb-1">Board Name</label>
              <input
                value={boardName}
                onChange={e => setBoardName(e.target.value)}
                className="w-full px-3 py-1.5 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Lanes */}
            <div className="flex-1 overflow-y-auto styled-scroll px-5 py-3 space-y-2">
              <p className="text-[11px] font-medium text-text-secondary mb-2">Lanes — drag to reorder</p>
              {lanes.map((lane, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={e => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 p-2 border rounded-md bg-white transition-shadow ${dragIndex === i ? "shadow-md border-primary/40" : "border-border-default"}`}
                >
                  <GripVertical className="w-3.5 h-3.5 text-text-muted cursor-grab flex-shrink-0" />

                  {/* Color picker */}
                  <div className="relative flex-shrink-0">
                    <div className="w-5 h-5 rounded-full border-2 border-white shadow cursor-pointer" style={{ background: lane.color }}
                      onClick={() => {
                        const next = LANE_COLORS[(LANE_COLORS.indexOf(lane.color) + 1) % LANE_COLORS.length];
                        updateLane(i, { color: next });
                      }}
                      title="Click to cycle color"
                    />
                  </div>

                  {/* Lane name */}
                  <input
                    value={lane.name}
                    onChange={e => updateLane(i, { name: e.target.value })}
                    placeholder="Lane name"
                    className="flex-1 px-2 py-1 border border-border-default rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-primary min-w-0"
                  />

                  {/* Status mapping */}
                  <select
                    value={lane.mappedStatus}
                    onChange={e => updateLane(i, { mappedStatus: e.target.value })}
                    className="text-[11px] border border-border-default rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary flex-shrink-0"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>

                  <button onClick={() => removeLane(i)} className="p-1 rounded hover:bg-red-50 text-text-muted hover:text-red-500 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              <button onClick={addLane}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border-default rounded-md text-[12px] text-text-secondary hover:border-primary hover:text-primary transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add Lane
              </button>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-border-default flex gap-3 justify-end flex-shrink-0">
              <button onClick={onClose} className="px-4 py-2 text-[12px] font-medium border border-border-default rounded-md hover:bg-surface-subtle transition-colors">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                Save Board
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
