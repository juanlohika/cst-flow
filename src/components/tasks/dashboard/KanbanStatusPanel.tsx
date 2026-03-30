"use client";

import React, { useEffect, useState } from "react";
import { KanbanSquare, Circle, CheckCircle2, Clock, AlertCircle } from "lucide-react";

interface KanbanLane {
  laneId: string;
  laneName: string;
  mappedStatus: string;
  color: string;
  count: number;
}

interface ProjectRow {
  projectId: string;
  name: string;
  companyName: string;
  taskCount: number;
  completedCount: number;
  kanban: KanbanLane[];
  hasBoard: boolean;
}

interface EffortData {
  period: { start: string; end: string; label: string };
  byProject: ProjectRow[];
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Circle className="w-3 h-3 text-slate-400" />,
  "in-progress": <Clock className="w-3 h-3 text-blue-400" />,
  completed: <CheckCircle2 className="w-3 h-3 text-emerald-500" />,
};

function LaneBar({ lanes, total }: { lanes: KanbanLane[]; total: number }) {
  if (!total) return null;
  return (
    <div className="flex w-full h-2 rounded-full overflow-hidden gap-px">
      {lanes.map((l) => {
        const pct = total > 0 ? (l.count / total) * 100 : 0;
        if (!pct) return null;
        return (
          <div
            key={l.laneId}
            className="h-full transition-all"
            style={{ width: `${pct}%`, background: l.color }}
            title={`${l.laneName}: ${l.count}`}
          />
        );
      })}
    </div>
  );
}

function ProjectKanbanCard({ p }: { p: ProjectRow }) {
  const complPct = p.taskCount > 0 ? Math.round((p.completedCount / p.taskCount) * 100) : 0;
  const hasActivity = p.kanban.some((l) => l.count > 0);

  return (
    <div className="border border-slate-100 rounded-lg p-3 space-y-2.5 bg-white hover:border-slate-200 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-slate-800 truncate">{p.name}</p>
          <p className="text-[10px] text-slate-400 truncate">{p.companyName}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-slate-400">{p.completedCount}/{p.taskCount}</span>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              complPct >= 80
                ? "bg-emerald-50 text-emerald-600"
                : complPct >= 40
                ? "bg-amber-50 text-amber-600"
                : "bg-slate-50 text-slate-500"
            }`}
          >
            {complPct}%
          </span>
        </div>
      </div>

      {/* Board state */}
      {!p.hasBoard ? (
        <div className="flex items-center gap-1.5 py-1">
          <AlertCircle className="w-3 h-3 text-slate-300 flex-shrink-0" />
          <p className="text-[10px] text-slate-300 italic">No Kanban board — set one up in the Tasks view</p>
        </div>
      ) : !hasActivity ? (
        <p className="text-[10px] text-slate-300 py-0.5">Board configured but no tasks placed yet</p>
      ) : (
        <>
          {/* Stacked bar */}
          <LaneBar lanes={p.kanban} total={p.taskCount} />
          {/* Lane pills */}
          <div className="flex flex-wrap gap-1.5">
            {p.kanban
              .filter((l) => l.count > 0)
              .map((l) => (
                <span
                  key={l.laneId}
                  className="flex items-center gap-1 text-[10px] text-slate-600 bg-slate-50 border border-slate-100 rounded-full px-2 py-0.5"
                >
                  {STATUS_ICON[l.mappedStatus] ?? <Circle className="w-3 h-3 text-slate-300" />}
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: l.color }}
                  />
                  {l.laneName}
                  <span className="font-semibold ml-0.5">{l.count}</span>
                </span>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function KanbanStatusPanel() {
  const [data, setData] = useState<EffortData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/effort?period=month")
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error || "Failed"))))
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-4 h-4 border-2 border-slate-200 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        {error}
      </p>
    );
  }

  if (!data?.byProject.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
        <KanbanSquare className="w-8 h-8 opacity-30" />
        <p className="text-[11px]">No active projects this month</p>
      </div>
    );
  }

  const withBoard = data.byProject.filter((p) => p.hasBoard);
  const withoutBoard = data.byProject.filter((p) => !p.hasBoard);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400 border border-slate-100 rounded-lg px-3 py-2 bg-slate-50/60">
        <span className="flex items-center gap-1">
          <Circle className="w-3 h-3 text-slate-400" /> Pending
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-blue-400" /> In Progress
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Completed
        </span>
        <span className="ml-auto text-slate-300 font-medium">{data.period.label}</span>
      </div>

      {/* Projects with boards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {withBoard.map((p) => (
          <ProjectKanbanCard key={p.projectId} p={p} />
        ))}
      </div>

      {/* Projects without boards */}
      {withoutBoard.length > 0 && (
        <div className="border border-dashed border-slate-200 rounded-lg p-3 space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300">
            No Kanban Board ({withoutBoard.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {withoutBoard.map((p) => (
              <span
                key={p.projectId}
                className="text-[10px] text-slate-400 bg-slate-50 border border-slate-100 rounded-full px-2 py-0.5"
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
