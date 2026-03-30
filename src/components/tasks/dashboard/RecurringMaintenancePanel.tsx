"use client";

import { RefreshCw, CheckCircle2 } from "lucide-react";
import { useState } from "react";

interface RecurringMaintenancePanelProps {
  tasks: any[];
  onRefresh?: () => void;
}

const FREQ_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export default function RecurringMaintenancePanel({ tasks, onRefresh }: RecurringMaintenancePanelProps) {
  const [completing, setCompleting] = useState<string | null>(null);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-24 text-slate-300">
        <RefreshCw size={22} className="mb-1.5 opacity-40" />
        <p className="text-[11px]">No recurring tasks today</p>
      </div>
    );
  }

  async function handleComplete(task: any) {
    setCompleting(task.id);
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: "completed" }),
      });
      onRefresh?.();
    } catch { /* silent */ } finally {
      setCompleting(null);
    }
  }

  return (
    <div className="space-y-1.5">
      {tasks.map(task => (
        <div key={task.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-100 bg-white hover:border-blue-100 transition-all">
          <RefreshCw size={12} className="text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-slate-700 uppercase tracking-tight truncate">{task.subject}</p>
            {task.recurringFrequency && (
              <span className="text-[9px] font-bold text-blue-400">{FREQ_LABEL[task.recurringFrequency] ?? task.recurringFrequency}</span>
            )}
          </div>
          <button
            onClick={() => handleComplete(task)}
            disabled={completing === task.id}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold text-emerald-600 hover:bg-emerald-50 border border-emerald-200 transition-all disabled:opacity-50"
          >
            <CheckCircle2 size={10} />
            {completing === task.id ? "Saving…" : "Done"}
          </button>
        </div>
      ))}
    </div>
  );
}
