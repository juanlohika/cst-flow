"use client";

import { Clock, ArrowRight } from "lucide-react";

interface TodayFocusPanelProps {
  tasks: any[];
  onTaskClick?: (task: any) => void;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STATUS_COLOR: Record<string, string> = {
  "pending": "bg-slate-200 text-slate-500",
  "in-progress": "bg-blue-100 text-blue-600",
  "completed": "bg-emerald-100 text-emerald-600",
};

export default function TodayFocusPanel({ tasks, onTaskClick }: TodayFocusPanelProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-slate-300">
        <Clock size={28} className="mb-2 opacity-40" />
        <p className="text-[11px] font-medium">No tasks scheduled for today</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {tasks.map(task => (
        <div
          key={task.id}
          onClick={() => onTaskClick?.(task)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-100 bg-white hover:border-blue-200 hover:bg-blue-50/30 cursor-pointer transition-all group"
        >
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-slate-700 uppercase tracking-tight truncate group-hover:text-blue-700 transition-colors">
              {task.subject}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[9px] font-bold text-slate-400">{task.taskCode}</span>
              {task.project?.name && (
                <span className="text-[9px] text-slate-400">· {task.project.name}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {task.owner && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">
                {task.owner}
              </span>
            )}
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLOR[task.status] ?? "bg-slate-100 text-slate-400"}`}>
              {task.status === "in-progress" ? "ACTIVE" : task.status?.toUpperCase()}
            </span>
            {task.durationHours && (
              <span className="text-[9px] text-slate-400 font-medium">{task.durationHours}h</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
