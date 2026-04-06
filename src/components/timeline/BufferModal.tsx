"use client";

import React, { useState, useEffect } from "react";
import { X, Timer, CheckCircle2, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { addDaysSkippingWeekends } from "@/lib/date-utils";
import { useToast } from "@/components/ui/ToastContext";

interface BufferModalProps {
  taskId: string;
  currentPadding: number;
  /** Pass plannedEnd directly to avoid re-fetching the task */
  plannedEnd?: string;
  /** When set, shows "Apply to N tasks" label and skips DB write (caller handles bulk apply) */
  bulkCount?: number;
  onClose: () => void;
  /** Called after successful DB save — receives the new padding value */
  onSuccess: (newPadding: number) => void;
}

export default function BufferModal({
  taskId,
  currentPadding,
  plannedEnd,
  bulkCount,
  onClose,
  onSuccess,
}: BufferModalProps) {
  const [padding, setPadding] = useState(currentPadding);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    setPadding(currentPadding);
  }, [currentPadding]);

  const handleSave = async () => {
    // Bulk mode OR temporary tasks: caller updates local state first
    if ((bulkCount && bulkCount > 1) || taskId.startsWith("temp-")) {
      onSuccess(padding);
      return;
    }

    setLoading(true);
    try {
      let resolvedPlannedEnd = plannedEnd;
      if (!resolvedPlannedEnd) {
        const taskRes = await fetch(`/api/tasks/${taskId}`);
        if (!taskRes.ok) throw new Error("Task not found.");
        const task = await taskRes.json();
        resolvedPlannedEnd = task.plannedEnd;
      }

      if (!resolvedPlannedEnd) throw new Error("Task has no end date");

      const externalPlannedEnd = addDaysSkippingWeekends(resolvedPlannedEnd, padding);

      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, paddingDays: padding, externalPlannedEnd }),
      });

      if (res.ok) {
        showToast("Client buffer updated", "success");
        onSuccess(padding);
      } else {
        throw new Error("Failed to save");
      }
    } catch (err: any) {
      showToast(err.message || "Error saving buffer", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-end p-8 pointer-events-none animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] w-[240px] overflow-hidden border border-border animate-in slide-in-from-bottom-4 duration-300 pointer-events-auto ring-1 ring-black/5">
        
        {/* Compact Header */}
        <div className="px-4 py-3 border-b bg-surface-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-primary rounded-md flex items-center justify-center text-white shadow-sm ring-1 ring-primary/20">
              <Timer className="w-3 h-3" strokeWidth={3} />
            </div>
            <div>
              <span className="text-[10px] font-black text-text-primary uppercase tracking-wider">Client Buffer</span>
              {bulkCount && bulkCount > 1 && (
                <p className="text-[8px] font-bold text-primary uppercase tracking-widest leading-none mt-0.5">
                  {bulkCount} Tasks Selected
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-muted rounded-md transition-colors text-text-secondary opacity-50 hover:opacity-100">
            <X size={12} strokeWidth={3} />
          </button>
        </div>

        {/* Compact Content */}
        <div className="p-4 bg-white">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between bg-surface-subtle rounded-xl p-3 border border-border hover:border-primary/30 transition-all group">
              <span className="text-[9px] font-black text-text-secondary uppercase tracking-widest px-1">Days</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="30"
                  autoFocus
                  value={padding}
                  onChange={(e) => setPadding(parseInt(e.target.value) || 0)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="w-12 h-8 bg-white border border-border rounded-lg text-sm font-black text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col gap-0.5">
                   <button onClick={() => setPadding(p => Math.min(30, p + 1))} className="p-0.5 hover:bg-white rounded transition-colors text-text-secondary hover:text-primary border border-transparent hover:border-border"><ChevronUp className="w-2.5 h-2.5" strokeWidth={3}/></button>
                   <button onClick={() => setPadding(p => Math.max(0, p - 1))} className="p-0.5 hover:bg-white rounded transition-colors text-text-secondary hover:text-primary border border-transparent hover:border-border"><ChevronDown className="w-2.5 h-2.5" strokeWidth={3}/></button>
                </div>
              </div>
            </div>
            
            <p className="text-[8px] text-text-secondary font-bold italic opacity-40 text-center leading-tight">
              Instant apply to selection
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="px-3 pb-3">
          <button
            disabled={loading}
            onClick={handleSave}
            className="w-full py-2 bg-primary text-white rounded-xl text-[10px] font-black shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 uppercase tracking-widest disabled:opacity-50 ring-1 ring-primary/30"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} strokeWidth={3} />}
            {bulkCount && bulkCount > 1 ? "Apply to Selection" : "Save Buffer"}
          </button>
        </div>
      </div>
    </div>
  );
}
