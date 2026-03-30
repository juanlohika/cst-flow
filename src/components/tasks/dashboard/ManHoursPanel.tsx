"use client";

import React, { useEffect, useState } from "react";
import { Layers, Users, TrendingUp, TrendingDown, Minus } from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────── */
interface ProjectRow {
  projectId: string;
  name: string;
  companyName: string;
  budget: number;
  allotted: number;
  eodActual: number;
  taskCount: number;
  completedCount: number;
}

interface OwnerRow {
  owner: string;
  budget: number;
  allotted: number;
  eodActual: number;
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

/* ─── Dual progress bar: budget vs allotted ──────────────────── */
function BudgetAllottedBar({
  budget,
  allotted,
  eodActual,
}: {
  budget: number;
  allotted: number;
  eodActual: number;
}) {
  const max = Math.max(budget, allotted, eodActual, 0.1);
  const budgetPct = Math.min((budget / max) * 100, 100);
  const allottedPct = Math.min((allotted / max) * 100, 100);
  const actualPct = Math.min((eodActual / max) * 100, 100);
  const overAllotted = allotted > budget;
  const overActual = eodActual > budget;

  return (
    <div className="space-y-1.5">
      {/* Budget track */}
      <div className="flex items-center gap-2">
        <span className="w-12 text-[9px] text-slate-400 text-right flex-shrink-0">Budget</span>
        <div className="relative flex-1 h-2 rounded-full bg-slate-100">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-slate-300"
            style={{ width: `${budgetPct}%` }}
          />
        </div>
        <span className="w-8 text-[10px] font-semibold text-slate-600 flex-shrink-0">{fmt(budget)}</span>
      </div>

      {/* Allotted track */}
      <div className="flex items-center gap-2">
        <span className="w-12 text-[9px] text-slate-400 text-right flex-shrink-0">Allotted</span>
        <div className="relative flex-1 h-2.5 rounded-full bg-slate-100">
          {/* Budget reference marker */}
          {budgetPct > 0 && budgetPct < 100 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-slate-400 z-10"
              style={{ left: `${budgetPct}%` }}
            />
          )}
          <div
            className={`absolute left-0 top-0 h-full rounded-full transition-all ${
              overAllotted ? "bg-amber-400" : "bg-blue-400"
            }`}
            style={{ width: `${allottedPct}%` }}
          />
        </div>
        <span
          className={`w-8 text-[10px] font-semibold flex-shrink-0 ${
            overAllotted ? "text-amber-600" : "text-blue-600"
          }`}
        >
          {fmt(allotted)}
        </span>
      </div>

      {/* EOD Actual track (only show if data exists) */}
      {eodActual > 0 && (
        <div className="flex items-center gap-2">
          <span className="w-12 text-[9px] text-slate-400 text-right flex-shrink-0">Logged</span>
          <div className="relative flex-1 h-2 rounded-full bg-slate-100">
            {budgetPct > 0 && budgetPct < 100 && (
              <div
                className="absolute top-0 bottom-0 w-px bg-slate-400 z-10"
                style={{ left: `${budgetPct}%` }}
              />
            )}
            <div
              className={`absolute left-0 top-0 h-full rounded-full ${
                overActual ? "bg-red-400" : "bg-emerald-400"
              }`}
              style={{ width: `${actualPct}%` }}
            />
          </div>
          <span
            className={`w-8 text-[10px] font-semibold flex-shrink-0 ${
              overActual ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {fmt(eodActual)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Variance indicator ─────────────────────────────────────── */
function AllottedVariance({ budget, allotted }: { budget: number; allotted: number }) {
  if (!allotted) return <span className="text-[10px] text-slate-300">No SOD data</span>;
  const diff = budget - allotted;
  const pct = budget > 0 ? Math.round(Math.abs(diff / budget) * 100) : 0;
  if (Math.abs(diff) < 0.1)
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-slate-400 font-medium">
        <Minus className="w-3 h-3" /> On budget
      </span>
    );
  if (diff > 0)
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-semibold">
        <TrendingDown className="w-3 h-3" /> {pct}% under
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-semibold">
      <TrendingUp className="w-3 h-3" /> {pct}% over
    </span>
  );
}

/* ─── Project card ───────────────────────────────────────────── */
function ProjectManHoursCard({ p }: { p: ProjectRow }) {
  return (
    <div className="border border-slate-100 rounded-lg p-3.5 space-y-3 bg-white hover:border-slate-200 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-slate-800 truncate">{p.name}</p>
          <p className="text-[10px] text-slate-400 truncate">{p.companyName}</p>
        </div>
        <AllottedVariance budget={p.budget} allotted={p.allotted} />
      </div>
      <BudgetAllottedBar budget={p.budget} allotted={p.allotted} eodActual={p.eodActual} />
      {/* Summary stats */}
      <div className="flex items-center gap-4 pt-1 border-t border-slate-50 text-[10px]">
        <span className="text-slate-400">
          <span className="font-semibold text-slate-600">{fmt(p.budget)}</span> budgeted
        </span>
        <span className="text-slate-400">
          <span className={`font-semibold ${p.allotted > p.budget ? "text-amber-600" : "text-blue-600"}`}>
            {fmt(p.allotted)}
          </span>{" "}
          allotted (SOD)
        </span>
        {p.eodActual > 0 && (
          <span className="text-slate-400">
            <span className={`font-semibold ${p.eodActual > p.budget ? "text-red-600" : "text-emerald-600"}`}>
              {fmt(p.eodActual)}
            </span>{" "}
            logged (EOD)
          </span>
        )}
        <span className="ml-auto text-slate-300">
          {p.completedCount}/{p.taskCount} tasks done
        </span>
      </div>
    </div>
  );
}

/* ─── Owner table ────────────────────────────────────────────── */
function OwnerManHoursTable({ rows }: { rows: OwnerRow[] }) {
  if (!rows.length)
    return <p className="text-[11px] text-slate-400 py-4 text-center">No data for this period</p>;

  const maxBudget = Math.max(...rows.map((r) => Math.max(r.budget, r.allotted)), 0.1);

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[80px_1fr_60px_60px_60px_90px] gap-2 px-2 pb-1 border-b border-slate-100">
        {["Person", "Budget vs Allotted", "Budget", "Allotted", "Logged", "Status"].map((h) => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
            {h}
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const budgetPct = (r.budget / maxBudget) * 100;
        const allottedPct = (r.allotted / maxBudget) * 100;
        const overAllotted = r.allotted > r.budget;
        return (
          <div
            key={r.owner}
            className="grid grid-cols-[80px_1fr_60px_60px_60px_90px] gap-2 items-center px-2 py-2 rounded-md hover:bg-slate-50 transition-colors"
          >
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-center w-fit ${ownerPill(r.owner)}`}>
              {r.owner}
            </span>

            {/* Dual mini bar */}
            <div className="space-y-0.5">
              <div className="relative h-2 rounded-full bg-slate-100">
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-slate-300"
                  style={{ width: `${Math.min(budgetPct, 100)}%` }}
                />
              </div>
              <div className="relative h-2 rounded-full bg-slate-100">
                {budgetPct > 0 && budgetPct < 100 && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-slate-400 z-10"
                    style={{ left: `${budgetPct}%` }}
                  />
                )}
                <div
                  className={`absolute left-0 top-0 h-full rounded-full ${overAllotted ? "bg-amber-400" : "bg-blue-400"}`}
                  style={{ width: `${Math.min(allottedPct, 100)}%` }}
                />
              </div>
            </div>

            <span className="text-[11px] font-medium text-slate-600">{fmt(r.budget)}</span>
            <span className={`text-[11px] font-medium ${overAllotted ? "text-amber-600" : "text-blue-600"}`}>
              {r.allotted ? fmt(r.allotted) : <span className="text-slate-300">—</span>}
            </span>
            <span className={`text-[11px] ${r.eodActual > r.budget ? "text-red-500 font-semibold" : "text-emerald-600"}`}>
              {r.eodActual ? fmt(r.eodActual) : <span className="text-slate-300">—</span>}
            </span>
            <AllottedVariance budget={r.budget} allotted={r.allotted} />
          </div>
        );
      })}
    </div>
  );
}

/* ─── Main panel ─────────────────────────────────────────────── */
export default function ManHoursPanel() {
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [view, setView] = useState<"project" | "person">("project");
  const [data, setData] = useState<EffortData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/dashboard/effort?period=${period}`)
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error || "Failed"))))
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Period toggle */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          {(["week", "month"] as const).map((p) => (
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

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400 border border-slate-100 rounded-lg px-3 py-2 bg-slate-50/60">
        <span>
          <span className="font-semibold text-slate-500">Budget</span> — estimated hours from task planning (durationHours)
        </span>
        <span>
          <span className="font-semibold text-blue-500">Allotted (SOD)</span> — hours scheduled each day via Start-of-Day planning
        </span>
        <span>
          <span className="font-semibold text-emerald-500">Logged (EOD)</span> — actual hours submitted at End-of-Day
        </span>
        <span>
          <span className="font-semibold text-amber-500">Amber bar</span> — allotted exceeds budget
        </span>
      </div>

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-10">
          <div className="w-4 h-4 border-2 border-slate-200 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {!loading && data && view === "project" && (
        <div className="space-y-2">
          {data.byProject.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-8">
              No active projects with tasks in this period
            </p>
          ) : (
            data.byProject.map((p) => <ProjectManHoursCard key={p.projectId} p={p} />)
          )}
        </div>
      )}

      {!loading && data && view === "person" && (
        <OwnerManHoursTable rows={data.byOwner} />
      )}
    </div>
  );
}
