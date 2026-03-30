"use client";

import React, { useEffect, useState } from "react";
import { TrendingDown, TrendingUp, Minus, Users, Layers, ChevronRight, ChevronDown } from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────── */
interface KanbanLane { laneId: string; laneName: string; mappedStatus: string; color: string; count: number; }
interface ProjectRow {
  projectId: string; name: string; companyName: string;
  budget: number; logged: number; remaining: number; forecast: number; variance: number;
  taskCount: number; completedCount: number; kanban: KanbanLane[]; hasBoard: boolean;
}
interface OwnerRow {
  owner: string; budget: number; logged: number; remaining: number; forecast: number; variance: number;
  projects?: { projectId: string; projectName: string; budget: number; logged: number; remaining: number; forecast: number; variance: number; }[];
}
interface EffortData {
  period: { start: string; end: string; label: string };
  byProject: ProjectRow[];
  byOwner: OwnerRow[];
}

/* ─── Helpers ────────────────────────────────────────────────── */
const fmt = (h: number) => `${h}h`;

const OWNER_COLOR: Record<string, string> = {
  PM: "bg-indigo-100 text-indigo-700",
  BA: "bg-sky-100 text-sky-700",
  DEV: "bg-violet-100 text-violet-700",
  CLIENT: "bg-rose-100 text-rose-700",
  Unassigned: "bg-slate-100 text-slate-500",
};
const ownerPill = (o: string) => OWNER_COLOR[o] ?? "bg-slate-100 text-slate-600";

/* ─── Burn bar ───────────────────────────────────────────────── */
function BurnBar({ budget, logged, remaining, forecast }: { budget: number; logged: number; remaining: number; forecast: number }) {
  const max = Math.max(budget, forecast, 0.1);
  const loggedPct = (logged / max) * 100;
  const remainingPct = (remaining / max) * 100;
  const budgetMarkerPct = (budget / max) * 100;
  const overrun = forecast > budget;

  return (
    <div className="relative w-full">
      {/* Track */}
      <div className="relative h-3.5 rounded-full bg-slate-100 overflow-visible">
        {/* Logged (green) */}
        {loggedPct > 0 && (
          <div
            className="absolute left-0 top-0 h-full rounded-l-full bg-emerald-400 transition-all"
            style={{ width: `${Math.min(loggedPct, 100)}%` }}
          />
        )}
        {/* Remaining (blue), starts after logged */}
        {remainingPct > 0 && (
          <div
            className={`absolute top-0 h-full transition-all ${overrun ? "bg-amber-400" : "bg-blue-400"} ${loggedPct === 0 ? "rounded-l-full" : ""} ${!overrun ? "rounded-r-full" : ""}`}
            style={{ left: `${Math.min(loggedPct, 100)}%`, width: `${Math.min(remainingPct, 100 - loggedPct)}%` }}
          />
        )}
        {/* Overrun indicator (forecast > budget) */}
        {overrun && (
          <div
            className="absolute top-0 h-full bg-red-400 rounded-r-full"
            style={{ left: `${budgetMarkerPct}%`, width: `${Math.min((forecast - budget) / max * 100, 100 - budgetMarkerPct)}%` }}
          />
        )}
        {/* Budget marker line */}
        {budgetMarkerPct > 0 && budgetMarkerPct < 100 && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10" style={{ left: `${budgetMarkerPct}%` }} />
        )}
      </div>
      {/* Legend row */}
      <div className="flex items-center gap-3 mt-1.5">
        <span className="flex items-center gap-1 text-[9px] text-slate-400">
          <span className="w-2 h-2 rounded-sm bg-emerald-400 flex-shrink-0" /> Logged
        </span>
        <span className="flex items-center gap-1 text-[9px] text-slate-400">
          <span className={`w-2 h-2 rounded-sm ${overrun ? "bg-amber-400" : "bg-blue-400"} flex-shrink-0`} /> Remaining
        </span>
        {overrun && (
          <span className="flex items-center gap-1 text-[9px] text-red-400">
            <span className="w-2 h-2 rounded-sm bg-red-400 flex-shrink-0" /> Overrun
          </span>
        )}
        <span className="flex items-center gap-1 text-[9px] text-slate-400">
          <span className="w-0.5 h-3 bg-slate-400 flex-shrink-0" /> Budget
        </span>
      </div>
    </div>
  );
}

/* ─── Variance badge ─────────────────────────────────────────── */
function VarianceBadge({ v }: { v: number }) {
  if (Math.abs(v) < 0.1) return <span className="flex items-center gap-0.5 text-[10px] text-slate-400 font-medium"><Minus className="w-3 h-3" />On track</span>;
  if (v > 0) return <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-semibold"><TrendingDown className="w-3 h-3" />+{fmt(v)} saved</span>;
  return <span className="flex items-center gap-0.5 text-[10px] text-red-500 font-semibold"><TrendingUp className="w-3 h-3" />{fmt(Math.abs(v))} overrun</span>;
}

/* ─── Stat pill ──────────────────────────────────────────────── */
function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-[12px] font-semibold ${muted ? "text-slate-400" : "text-slate-700"}`}>{value}</span>
      <span className="text-[9px] text-slate-400 uppercase tracking-wide">{label}</span>
    </div>
  );
}

/* ─── Project card ───────────────────────────────────────────── */
function ProjectCard({ p }: { p: ProjectRow }) {
  const complPct = p.taskCount > 0 ? Math.round((p.completedCount / p.taskCount) * 100) : 0;

  return (
    <div className="border border-slate-100 rounded-lg p-3.5 space-y-3 bg-white hover:border-slate-200 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-slate-800 truncate">{p.name}</p>
          <p className="text-[10px] text-slate-400 truncate">{p.companyName}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-slate-400">{p.completedCount}/{p.taskCount} done</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            complPct >= 80 ? "bg-emerald-50 text-emerald-600" :
            complPct >= 40 ? "bg-amber-50 text-amber-600" :
            "bg-slate-50 text-slate-500"
          }`}>{complPct}%</span>
        </div>
      </div>

      {/* Kanban lane distribution */}
      {p.hasBoard && p.kanban.some(l => l.count > 0) ? (
        <div className="flex flex-wrap gap-1.5">
          {p.kanban.filter(l => l.count > 0).map(l => (
            <span key={l.laneId} className="flex items-center gap-1 text-[10px] text-slate-600 bg-slate-50 border border-slate-100 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: l.color }} />
              {l.laneName}
              <span className="font-semibold ml-0.5">{l.count}</span>
            </span>
          ))}
        </div>
      ) : p.hasBoard ? (
        <p className="text-[10px] text-slate-300">No tasks placed on board</p>
      ) : (
        <p className="text-[10px] text-slate-300 italic">No Kanban board — set one up in the Tasks view</p>
      )}

      {/* Burn bar */}
      <BurnBar budget={p.budget} logged={p.logged} remaining={p.remaining} forecast={p.forecast} />

      {/* Stats row */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-50">
        <div className="flex items-center gap-4">
          <Stat label="Budget" value={fmt(p.budget)} />
          <Stat label="Logged" value={fmt(p.logged)} />
          <Stat label="Remaining" value={fmt(p.remaining)} muted />
          <Stat label="Forecast" value={fmt(p.forecast)} />
        </div>
        <VarianceBadge v={p.variance} />
      </div>
    </div>
  );
}

/* ─── Owner table ────────────────────────────────────────────── */
function OwnerTable({ rows }: { rows: OwnerRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleRow = (owner: string) => {
    const next = new Set(expanded);
    if (next.has(owner)) next.delete(owner);
    else next.add(owner);
    setExpanded(next);
  };

  if (!rows.length) return <p className="text-[11px] text-slate-400 py-4 text-center">No data for this period</p>;

  const maxForecast = Math.max(...rows.map(r => Math.max(r.budget, r.forecast)), 0.1);

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[100px_1fr_60px_60px_60px_60px_80px] gap-2 px-2 pb-1 border-b border-slate-100">
        {["Person", "Burn", "Budget", "Logged", "Left", "Forecast", "Variance"].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{h}</span>
        ))}
      </div>
      {rows.map(r => {
        const loggedPct = (r.logged / maxForecast) * 100;
        const remainingPct = (r.remaining / maxForecast) * 100;
        const budgetPct = (r.budget / maxForecast) * 100;
        const overrun = r.forecast > r.budget;
        const isExpanded = expanded.has(r.owner);
        const hasProjects = r.projects && r.projects.length > 0;

        return (
          <React.Fragment key={r.owner}>
            <div 
              onClick={() => hasProjects && toggleRow(r.owner)}
              className={`grid grid-cols-[100px_1fr_60px_60px_60px_60px_80px] gap-2 items-center px-2 py-1.5 rounded-md transition-colors ${hasProjects ? 'cursor-pointer hover:bg-slate-50' : ''} ${isExpanded ? 'bg-slate-50 border border-slate-100 shadow-sm' : ''}`}>
              {/* Owner */}
              <div className="flex items-center min-w-0">
                {hasProjects ? (
                  isExpanded ? <ChevronDown className="w-3 h-3 text-slate-400 mr-1 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-400 mr-1 flex-shrink-0" />
                ) : (
                  <span className="w-4 flex-shrink-0" />
                )}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-center truncate ${ownerPill(r.owner)}`}>{r.owner}</span>
              </div>

            {/* Mini bar */}
            <div className="relative h-2.5 rounded-full bg-slate-100">
              {loggedPct > 0 && <div className="absolute left-0 top-0 h-full rounded-l-full bg-emerald-400" style={{ width: `${Math.min(loggedPct, 100)}%` }} />}
              {remainingPct > 0 && (
                <div
                  className={`absolute top-0 h-full ${overrun ? "bg-amber-400" : "bg-blue-400"} ${loggedPct === 0 ? "rounded-l-full" : ""} rounded-r-full`}
                  style={{ left: `${Math.min(loggedPct, 100)}%`, width: `${Math.min(remainingPct, 100 - loggedPct)}%` }}
                />
              )}
              {budgetPct > 0 && budgetPct < 100 && (
                <div className="absolute top-0 bottom-0 w-px bg-slate-400 z-10" style={{ left: `${budgetPct}%` }} />
              )}
            </div>

            {/* Numbers */}
            <span className="text-[11px] font-medium text-slate-600">{fmt(r.budget)}</span>
            <span className="text-[11px] font-medium text-emerald-600">{fmt(r.logged)}</span>
            <span className="text-[11px] text-slate-400">{fmt(r.remaining)}</span>
            <span className="text-[11px] font-semibold text-slate-700">{fmt(r.forecast)}</span>
            <VarianceBadge v={r.variance} />
            </div>

            {/* Expanded Project Details */}
            {isExpanded && hasProjects && (
              <div className="pl-[20px] pr-2 py-1.5 bg-slate-50 border-x border-b border-slate-100 rounded-b-md -mt-1 shadow-inner space-y-1.5 mb-2">
                {r.projects?.map(p => {
                  const pLoggedPct = (p.logged / maxForecast) * 100;
                  const pRemainingPct = (p.remaining / maxForecast) * 100;
                  const pBudgetPct = (p.budget / maxForecast) * 100;
                  const pOverrun = p.forecast > p.budget;

                  return (
                    <div key={p.projectId} className="grid grid-cols-[80px_1fr_60px_60px_60px_60px_80px] gap-2 items-center">
                      <span className="text-[10px] text-slate-500 font-medium truncate" title={p.projectName}>{p.projectName}</span>
                      
                      {/* Mini bar for project */}
                      <div className="relative h-1.5 rounded-full bg-slate-200/50">
                        {pLoggedPct > 0 && <div className="absolute left-0 top-0 h-full rounded-l-full bg-emerald-400/70" style={{ width: `${Math.min(pLoggedPct, 100)}%` }} />}
                        {pRemainingPct > 0 && (
                          <div
                            className={`absolute top-0 h-full ${pOverrun ? "bg-amber-400/70" : "bg-blue-400/70"} ${pLoggedPct === 0 ? "rounded-l-full" : ""} rounded-r-full`}
                            style={{ left: `${Math.min(pLoggedPct, 100)}%`, width: `${Math.min(pRemainingPct, 100 - pLoggedPct)}%` }}
                          />
                        )}
                        {pBudgetPct > 0 && pBudgetPct < 100 && (
                          <div className="absolute top-0 bottom-0 w-px bg-slate-400/50 z-10" style={{ left: `${pBudgetPct}%` }} />
                        )}
                      </div>

                      <span className="text-[10px] font-medium text-slate-500">{fmt(p.budget)}</span>
                      <span className="text-[10px] font-medium text-emerald-600/70">{fmt(p.logged)}</span>
                      <span className="text-[10px] text-slate-400/70">{fmt(p.remaining)}</span>
                      <span className="text-[10px] font-semibold text-slate-600">{fmt(p.forecast)}</span>
                      <div className="opacity-80 scale-90 origin-left"><VarianceBadge v={p.variance} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── Main panel ─────────────────────────────────────────────── */
export default function EffortBurnPanel() {
  const [period, setPeriod] = useState<"daily" | "week" | "month">("month");
  const [view, setView] = useState<"project" | "person">("project");
  const [data, setData] = useState<EffortData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/dashboard/effort?period=${period}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(d.error || "Failed")))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Period toggle */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          {(["daily", "week", "month"] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                period === p ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Period label */}
        {data && (
          <span className="text-[10px] text-slate-400 font-medium">{data.period.label}</span>
        )}

        {/* View toggle */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 ml-auto">
          <button
            onClick={() => setView("project")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
              view === "project" ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Layers className="w-3 h-3" /> Projects
          </button>
          <button
            onClick={() => setView("person")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
              view === "person" ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            <Users className="w-3 h-3" /> People
          </button>
        </div>
      </div>

      {/* Metric legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400 border border-slate-100 rounded-lg px-3 py-2 bg-slate-50/60">
        <span><span className="font-semibold text-slate-600">Budget</span> — total estimated hours for all tasks</span>
        <span><span className="font-semibold text-emerald-600">Logged</span> — hours spent on completed tasks</span>
        <span><span className="font-semibold text-blue-500">Remaining</span> — estimated hours left on open tasks</span>
        <span><span className="font-semibold text-slate-700">Forecast</span> — Logged + Remaining (projected total)</span>
        <span><span className="font-semibold text-slate-500">Variance</span> — Budget − Forecast (+ saved / − overrun)</span>
      </div>

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-10">
          <div className="w-4 h-4 border-2 border-slate-200 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {!loading && data && view === "project" && (
        <div className="space-y-2">
          {data.byProject.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-8">No active projects with tasks in this period</p>
          ) : (
            data.byProject.map(p => <ProjectCard key={p.projectId} p={p} />)
          )}
        </div>
      )}

      {!loading && data && view === "person" && (
        <OwnerTable rows={data.byOwner} />
      )}
    </div>
  );
}
