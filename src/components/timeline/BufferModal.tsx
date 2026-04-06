"use client";

import React, { useState, useEffect } from "react";
import { X, Timer, CheckCircle2, Loader2 } from "lucide-react";
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
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/5 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-[260px] overflow-hidden border border-border animate-in zoom-in-95 duration-200 ring-4 ring-black/5">
        
        {/* Compact Header */}
        <div className="px-4 py-3 border-b bg-surface-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center text-white shadow-sm ring-1 ring-primary/20">
              <Timer className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider">Client Buffer</span>
              {bulkCount && bulkCount > 1 && (
                <p className="text-[8px] font-bold text-primary uppercase tracking-widest leading-none">
                  {bulkCount} Tasks Selected
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-muted rounded-md transition-colors text-text-secondary opacity-50 hover:opacity-100">
            <X size={14} />
          </button>
        </div>

        {/* Compact Content */}
        <div className="p-4 bg-white">
          <div className="flex flex-col items-center gap-3">
            <div className="w-full flex items-center justify-between bg-surface-subtle rounded-lg p-2 border border-border">
              <span className="text-[9px] font-bold text-text-secondary uppercase tracking-widest pl-1">Days</span>
              <input
                type="number"
                min="0"
                max="30"
                autoFocus
                value={padding}
                onChange={(e) => setPadding(parseInt(e.target.value) || 0)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                className="w-16 h-8 bg-white border border-border rounded-md text-sm font-bold text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-center"
              />
            </div>
            
            <p className="text-[8px] text-text-secondary font-medium italic opacity-60 text-center leading-tight">
              Saturdays & Sundays are automatically skipped.
            </p>
          </div>
        </div>

        {/* Compact Footer */}
        <div className="px-3 py-3 bg-surface-subtle border-t flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 bg-white border border-border rounded-md text-[9px] font-bold text-text-secondary hover:bg-surface-muted transition-all uppercase tracking-widest shadow-sm"
          >
            Cancel
          </button>
          <button
            disabled={loading}
            onClick={handleSave}
            className="flex-1 py-1.5 bg-primary text-white rounded-md text-[9px] font-bold shadow-md shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 uppercase tracking-widest disabled:opacity-50 ring-1 ring-primary/30"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} strokeWidth={3} />}
            {bulkCount && bulkCount > 1 ? "Apply" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
