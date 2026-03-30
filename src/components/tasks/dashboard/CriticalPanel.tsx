"use client";

import { AlertTriangle, Clock, Link2 } from "lucide-react";

interface CriticalPanelProps {
  overdue: any[];
  approachingDeadline: any[];
  onTaskClick?: (task: any) => void;
}

function DaysChip({ task }: { task: any }) {
  if (!task.plannedEnd) return null;
  const diff = Math.round((new Date(task.plannedEnd).getTime() - Date.now()) / 86400000);
  if (diff < 0) return <span className="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">{Math.abs(diff)}d overdue</span>;
  if (diff === 0) return <span className="text-[9px] font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">Due today</span>;
  return <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">Due in {diff}d</span>;
}

function TaskRow({ task, variant, onTaskClick }: { task: any; variant: "overdue" | "approaching"; onTaskClick?: (t: any) => void }) {
  const border = variant === "overdue" ? "border-red-100 hover:border-red-300 hover:bg-red-50/30" : "border-amber-100 hover:border-amber-300 hover:bg-amber-50/30";
  return (
    <div
      onClick={() => onTaskClick?.(task)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${border} bg-white cursor-pointer transition-all group`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-slate-700 uppercase tracking-tight truncate">{task.subject}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[9px] text-slate-400 font-bold">{task.taskCode}</span>
          {task.project?.name && <span className="text-[9px] text-slate-400">· {task.project.name}</span>}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <DaysChip task={task} />
        {task.owner && <span className="text-[9px] text-slate-400 font-bold uppercase">{task.owner}</span>}
      </div>
    </div>
  );
}

export default function CriticalPanel({ overdue, approachingDeadline, onTaskClick }: CriticalPanelProps) {
  const isEmpty = overdue.length === 0 && approachingDeadline.length === 0;
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-slate-300">
        <Link2 size={28} className="mb-2 opacity-40" />
        <p className="text-[11px] font-medium">No critical items — all clear!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} className="text-red-500" />
            <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest">Overdue ({overdue.length})</span>
          </div>
          <div className="space-y-1">
            {overdue.slice(0, 5).map(t => <TaskRow key={t.id} task={t} variant="overdue" onTaskClick={onTaskClick} />)}
            {overdue.length > 5 && <p className="text-[9px] text-slate-400 pl-2">+{overdue.length - 5} more overdue</p>}
          </div>
        </div>
      )}
      {approachingDeadline.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Clock size={11} className="text-amber-500" />
            <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">Due within 3 days ({approachingDeadline.length})</span>
          </div>
          <div className="space-y-1">
            {approachingDeadline.slice(0, 5).map(t => <TaskRow key={t.id} task={t} variant="approaching" onTaskClick={onTaskClick} />)}
            {approachingDeadline.length > 5 && <p className="text-[9px] text-slate-400 pl-2">+{approachingDeadline.length - 5} more</p>}
          </div>
        </div>
      )}
    </div>
  );
}
