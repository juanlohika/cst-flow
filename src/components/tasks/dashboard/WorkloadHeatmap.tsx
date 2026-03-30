"use client";

interface HeatmapEntry {
  date: string;
  plannedHours: number;
  capacity: number;
  level: "ok" | "warning" | "critical";
  byOwner?: any[];
}

interface WorkloadHeatmapProps {
  data: HeatmapEntry[];
}

const LEVEL_COLOR: Record<string, string> = {
  ok: "bg-emerald-400",
  warning: "bg-amber-400",
  critical: "bg-red-500",
};
const LEVEL_TEXT: Record<string, string> = {
  ok: "text-emerald-600",
  warning: "text-amber-600",
  critical: "text-red-600",
};

function shortDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function dayLabel(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).slice(0, 2);
}

export default function WorkloadHeatmap({ data }: WorkloadHeatmapProps) {
  if (!data || data.length === 0) return null;

  const maxHours = Math.max(...data.map(d => Math.max(d.plannedHours, d.capacity)), 8);

  return (
    <div>
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" /><span className="text-[9px] text-slate-400">Normal</span></div>
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /><span className="text-[9px] text-slate-400">Near capacity</span></div>
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /><span className="text-[9px] text-slate-400">Overloaded</span></div>
        <div className="flex items-center gap-1"><span className="w-8 border-t-2 border-dashed border-slate-300 inline-block" /><span className="text-[9px] text-slate-400">8h cap</span></div>
      </div>

      {/* Bars */}
      <div className="flex items-end gap-1.5 h-24 px-1 relative">
        {/* Capacity reference line */}
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-slate-300 z-10 pointer-events-none"
          style={{ bottom: `${(8 / maxHours) * 96}px` }}
        />
        {data.map((d) => {
          const fillPct = Math.min((d.plannedHours / maxHours) * 100, 100);
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1.5 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                <div className="bg-slate-800 text-white text-[9px] font-bold px-2 py-1 rounded-md whitespace-nowrap shadow-lg">
                  {shortDate(d.date)}: {d.plannedHours}h / {d.capacity}h
                </div>
                <div className="w-1.5 h-1.5 bg-slate-800 rotate-45 -mt-0.5" />
              </div>
              {/* Bar */}
              <div className="w-full flex-1 flex items-end">
                <div
                  className={`w-full rounded-t transition-all ${LEVEL_COLOR[d.level]}`}
                  style={{ height: `${Math.max(fillPct, 4)}%` }}
                />
              </div>
              {/* Day label */}
              <span className={`text-[8px] font-bold ${LEVEL_TEXT[d.level]}`}>{dayLabel(d.date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
