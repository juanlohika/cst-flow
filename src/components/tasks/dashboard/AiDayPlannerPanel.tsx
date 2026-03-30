"use client";

import { useState, useEffect } from "react";
import { Wand2, Clock, AlertTriangle, Coffee } from "lucide-react";

const PRIORITY_COLOR: Record<string, string> = {
  critical: "border-l-red-500 bg-red-50/40",
  high: "border-l-amber-400 bg-amber-50/30",
  normal: "border-l-blue-300 bg-blue-50/20",
};
const BLOCK_ICON: Record<string, React.ReactNode> = {
  break: <Coffee size={11} className="text-slate-400" />,
  focus: <Clock size={11} className="text-blue-500" />,
  admin: <AlertTriangle size={11} className="text-amber-500" />,
};

export default function AiDayPlannerPanel() {
  const [owner, setOwner] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<{ roles: any[]; users: any[] }>({ roles: [], users: [] });

  // On mount, fetch the real team members
  useEffect(() => {
    fetch("/api/users/members")
      .then(res => res.json())
      .then(data => setMembers(data))
      .catch(console.error);
  }, []);

  const teamOptions = [
    { label: "All Owners", value: "ALL" },
    ...(members.roles || []).map(r => ({ label: r.name, value: r.name })),
    ...(members.users || []).map(u => ({ label: u.name || u.email, value: u.name || u.email }))
  ];

  async function planDay() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ai/day-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerLabel: owner === "ALL" ? null : owner }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI failed");
      setResult(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <select
          value={owner}
          onChange={e => setOwner(e.target.value)}
          className="h-7 px-2 text-[10px] font-bold rounded-md border border-slate-200 bg-white text-slate-700 uppercase outline-none focus:border-blue-400"
        >
          {teamOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={planDay}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-r from-blue-600 to-violet-600 text-white text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-60 shadow-sm"
        >
          <Wand2 size={11} />
          {loading ? "Planning…" : "Plan My Day"}
        </button>
      </div>

      {error && (
        <p className="text-[10px] text-red-500 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</p>
      )}

      {result && (
        <div className="space-y-3">
          {/* Summary */}
          {result.summary && (
            <div className="px-3 py-2.5 rounded-lg bg-violet-50 border border-violet-100">
              <p className="text-[10px] font-bold text-violet-700 uppercase tracking-widest mb-1">AI Coach</p>
              <p className="text-[11px] text-violet-700 leading-relaxed">{result.summary}</p>
            </div>
          )}

          {/* Time blocks */}
          {result.schedule && result.schedule.length > 0 && (
            <div className="space-y-1">
              {result.schedule.map((block: any, i: number) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 px-3 py-2 rounded-lg border-l-4 border border-slate-100 ${PRIORITY_COLOR[block.priority] ?? ""}`}
                >
                  <div className="shrink-0 mt-0.5">{BLOCK_ICON[block.blockType] ?? BLOCK_ICON.focus}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-slate-500">{block.startTime} – {block.endTime}</span>
                      {block.taskCode && <span className="text-[9px] text-slate-300 font-bold">{block.taskCode}</span>}
                    </div>
                    <p className="text-[11px] font-semibold text-slate-700 truncate">{block.subject ?? (block.blockType === "break" ? "Lunch break" : "—")}</p>
                    {block.action && <p className="text-[10px] text-slate-500 mt-0.5">{block.action}</p>}
                  </div>
                  {block.priority === "critical" && (
                    <span className="shrink-0 text-[8px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full uppercase mt-0.5">Critical</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Deferred */}
          {result.deferredTasks && result.deferredTasks.length > 0 && (
            <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-100">
              <p className="text-[9px] font-bold text-orange-600 uppercase tracking-widest mb-1">Deferred (doesn't fit today)</p>
              <p className="text-[10px] text-orange-600">{result.deferredTasks.join(", ")}</p>
            </div>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <p className="text-[10px] text-slate-400 text-center py-4">
          Click "Plan My Day" and AI will build a structured schedule from your tasks.
        </p>
      )}
    </div>
  );
}
