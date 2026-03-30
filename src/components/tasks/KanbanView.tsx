"use client";

import React, { useState } from "react";
import { Settings } from "lucide-react";

interface Lane {
  id: string;
  name: string;
  mappedStatus: string;
  color: string | null;
  position: number;
}

interface Task {
  id: string;
  subject: string;
  status: string;
  owner?: string;
  plannedEnd?: string;
  kanbanLaneId?: string | null;
  subtasks?: Task[];
}

interface Props {
  tasks: Task[];
  lanes: Lane[];
  onTaskMove: (taskId: string, laneId: string, mappedStatus: string) => void;
  onTaskClick: (task: Task) => void;
  canEdit: boolean;
  onSetupClick: () => void;
}

const STATUS_DOT: Record<string, string> = {
  "pending": "bg-slate-400",
  "in-progress": "bg-amber-400",
  "completed": "bg-emerald-400",
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
  
  // Simple check for default roles first
  if (owner === "PM") return colors[0];
  if (owner === "BA") return colors[1];
  if (owner === "DEV") return colors[2];
  if (owner === "CLIENT") return colors[3];
  
  // Hash character codes for consistent color assignment
  let hash = 0;
  for (let i = 0; i < owner.length; i++) {
    hash = owner.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function isOverdue(plannedEnd?: string) {
  if (!plannedEnd) return false;
  return new Date(plannedEnd) < new Date();
}

function getTasksForLane(tasks: Task[], lane: Lane, allLanes: Lane[]): { task: Task; placed: boolean }[] {
  const result: { task: Task; placed: boolean }[] = [];

  // Flatten all tasks (no subtask nesting in Kanban view)
  const flat: Task[] = [];
  const flatten = (items: Task[]) => { items.forEach(t => { flat.push(t); if (t.subtasks) flatten(t.subtasks); }); };
  flatten(tasks);

  for (const task of flat) {
    if (task.kanbanLaneId === lane.id) {
      result.push({ task, placed: true });
    } else if (!task.kanbanLaneId) {
      // Place in first lane whose mappedStatus matches task status
      const firstMatch = allLanes.find(l => l.mappedStatus === task.status);
      if (firstMatch?.id === lane.id) {
        result.push({ task, placed: false });
      }
    }
  }
  return result;
}

export default function KanbanView({ tasks, lanes, onTaskMove, onTaskClick, canEdit, onSetupClick }: Props) {
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null);

  if (lanes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-text-muted p-6">
        <Settings className="w-8 h-8 opacity-30" />
        <p className="text-[13px]">No Kanban board set up for this project.</p>
        {canEdit && (
          <button onClick={onSetupClick}
            className="px-4 py-2 bg-primary text-white rounded-md text-[12px] font-medium hover:bg-primary/90 transition-colors">
            Set Up Board
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 px-4 pt-2 min-h-[400px]">
      {lanes.map(lane => {
        const laneItems = getTasksForLane(tasks, lane, lanes);
        const accentColor = lane.color || "#64748b";
        const isOver = dragOverLaneId === lane.id;

        return (
          <div
            key={lane.id}
            className={`flex-shrink-0 w-[270px] flex flex-col rounded-lg border transition-colors ${isOver ? "border-primary/40 bg-primary/5" : "border-border-default bg-surface-subtle/40"}`}
            onDragEnter={e => { e.preventDefault(); setDragOverLaneId(lane.id); }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverLaneId(lane.id); }}
            onDragLeave={() => setDragOverLaneId(null)}
            onDrop={e => {
              e.preventDefault();
              setDragOverLaneId(null);
              const draggedId = e.dataTransfer.getData("text/plain") || dragTaskId;
              console.log("Kanban drop event", { laneId: lane.id, draggedId, mappedStatus: lane.mappedStatus });
              if (draggedId) onTaskMove(draggedId, lane.id, lane.mappedStatus);
              setDragTaskId(null);
            }}
          >
            {/* Lane header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-default flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: accentColor }} />
              <span className="text-[11px] font-bold uppercase tracking-widest text-text-primary flex-1 truncate">{lane.name}</span>
              <span className="text-[10px] text-text-muted bg-surface-muted px-1.5 py-0.5 rounded-full">{laneItems.length}</span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto styled-scroll p-2 space-y-2">
              {laneItems.length === 0 ? (
                <div className="flex items-center justify-center py-6 text-[11px] text-text-muted opacity-50">
                  Drop tasks here
                </div>
              ) : laneItems.map(({ task, placed }) => {
                const overdue = isOverdue(task.plannedEnd);
                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", task.id);
                      setDragTaskId(task.id);
                      console.log("Kanban drag start", { taskId: task.id, laneId: lane.id, status: task.status });
                    }}
                    onDragEnd={() => setDragTaskId(null)}
                    onClick={() => onTaskClick(task)}
                    className={`bg-white rounded-md p-2.5 cursor-pointer shadow-sm border transition-all hover:shadow-md ${
                      placed ? "border-border-default" : "border-dashed border-slate-300"
                    } ${dragTaskId === task.id ? "opacity-40" : ""}`}
                  >
                    <p className="text-[12px] font-medium text-text-primary leading-snug line-clamp-2 mb-2">
                      {task.subject}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[task.status] || "bg-slate-300"}`} />
                        {task.owner && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${getOwnerPillClass(task.owner)}`}>
                            {task.owner}
                          </span>
                        )}
                      </div>
                      {task.plannedEnd && (
                        <span className={`text-[10px] flex-shrink-0 ${overdue ? "text-red-500 font-medium" : "text-text-muted"}`}>
                          {new Date(task.plannedEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
