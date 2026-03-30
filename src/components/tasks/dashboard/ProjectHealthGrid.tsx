"use client";

import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";

interface ProjectHealth {
  projectId: string;
  name: string;
  companyName: string;
  percentComplete: number;
  daysToDeadline: number | null;
  overdueCount: number;
  totalTasks: number;
}

interface ProjectHealthGridProps {
  projects: ProjectHealth[];
}

export default function ProjectHealthGrid({ projects }: ProjectHealthGridProps) {
  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-slate-300">
        <p className="text-[11px]">No active projects</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {projects.map(p => {
        const barColor = p.percentComplete >= 80 ? "bg-emerald-400"
          : p.percentComplete >= 40 ? "bg-blue-400" : "bg-amber-400";
        const deadlineLabel = p.daysToDeadline === null ? null
          : p.daysToDeadline < 0 ? `${Math.abs(p.daysToDeadline)}d past`
          : p.daysToDeadline === 0 ? "Due today"
          : `${p.daysToDeadline}d left`;
        const deadlineColor = p.daysToDeadline !== null && p.daysToDeadline <= 3 ? "text-red-500" : "text-slate-400";

        return (
          <div key={p.projectId} className="px-3 py-2.5 rounded-lg border border-slate-100 bg-white hover:border-slate-200 transition-all">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-700 uppercase tracking-tight truncate">{p.name}</p>
                <p className="text-[9px] text-slate-400 truncate">{p.companyName}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.overdueCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-500">
                    <AlertTriangle size={9} />{p.overdueCount} overdue
                  </span>
                )}
                {deadlineLabel && (
                  <span className={`text-[9px] font-bold ${deadlineColor}`}>
                    {deadlineLabel}
                  </span>
                )}
              </div>
            </div>
            {/* Progress bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${p.percentComplete}%` }} />
              </div>
              <span className="text-[9px] font-bold text-slate-500 shrink-0">{p.percentComplete}%</span>
              <span className="text-[9px] text-slate-300">({p.totalTasks} tasks)</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
