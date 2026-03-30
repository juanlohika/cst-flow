"use client";

import { History } from "lucide-react";

interface ActivityFeedPanelProps {
  entries: any[];
}

const TYPE_COLOR: Record<string, string> = {
  status_change: "text-blue-500",
  reschedule: "text-amber-500",
  remark: "text-slate-400",
  default: "text-slate-400",
};

const TYPE_LABEL: Record<string, string> = {
  status_change: "Status",
  reschedule: "Rescheduled",
  remark: "Note",
};

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ActivityFeedPanel({ entries }: ActivityFeedPanelProps) {
  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-24 text-slate-300">
        <History size={22} className="mb-1.5 opacity-40" />
        <p className="text-[11px]">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-72 overflow-y-auto thin-scrollbar">
      {entries.map(entry => (
        <div key={entry.id} className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[9px] font-bold uppercase tracking-widest ${TYPE_COLOR[entry.type] ?? TYPE_COLOR.default}`}>
                {TYPE_LABEL[entry.type] ?? entry.type}
              </span>
              {entry.timelineItem?.taskCode && (
                <span className="text-[9px] text-slate-400 font-bold">{entry.timelineItem.taskCode}</span>
              )}
            </div>
            {entry.timelineItem?.subject && (
              <p className="text-[10px] font-semibold text-slate-600 truncate">{entry.timelineItem.subject}</p>
            )}
            {(entry.oldValue || entry.newValue) && (
              <p className="text-[9px] text-slate-400">
                {entry.oldValue && <span className="line-through mr-1">{entry.oldValue}</span>}
                {entry.newValue && <span className="font-medium">{entry.newValue}</span>}
              </p>
            )}
            {entry.comment && (
              <p className="text-[9px] text-slate-400 italic">"{entry.comment}"</p>
            )}
            <p className="text-[8px] text-slate-300 mt-0.5">{entry.changedBy} · {timeAgo(entry.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
