"use client";

import React, { useState, useEffect } from "react";
import { X, Timer, CheckCircle2, Loader2 } from "lucide-react";
import { addDaysSkippingWeekends } from "@/lib/date-utils";
import { useToast } from "@/components/ui/ToastContext";

interface BufferModalProps {
  taskId: string;
  currentPadding: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BufferModal({
  taskId,
  currentPadding,
  onClose,
  onSuccess
}: BufferModalProps) {
  const [padding, setPadding] = useState(currentPadding);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    setPadding(currentPadding);
  }, [currentPadding]);

  const handleSave = async () => {
    setLoading(true);
    try {
      // 1. Fetch current task to get plannedEnd
      const taskRes = await fetch(`/api/tasks`);
      // Since it's a flat list, we have to find it
      const tasks = await taskRes.json();
      
      const findTask = (list: any[]): any => {
        for (const t of list) {
          if (t.id === taskId) return t;
          if (t.subtasks) {
            const found = findTask(t.subtasks);
            if (found) return found;
          }
        }
        return null;
      };

      const task = findTask(tasks);
      if (!task) throw new Error("Task not found");

      const externalPlannedEnd = addDaysSkippingWeekends(task.plannedEnd, padding);

      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          id: taskId, 
          paddingDays: padding,
          externalPlannedEnd
        }),
      });

      if (res.ok) {
        showToast("Client buffer updated", "success");
        onSuccess();
      } else {
        throw new Error("Failed to save");
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-[360px] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-xl flex items-center justify-center text-white shadow-sm">
              <Timer className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-black text-slate-800 uppercase tracking-[0.1em]">Client Leg Room</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-slate-200 rounded-xl transition-colors text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-8">
           <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 text-center">Buffer Days (Business Days)</label>
                <div className="flex items-center justify-center gap-4">
                   <input 
                    type="number"
                    min="0"
                    max="30"
                    value={padding}
                    onChange={(e) => setPadding(parseInt(e.target.value) || 0)}
                    className="w-20 h-14 bg-slate-50 border-2 border-slate-100 rounded-2xl text-xl font-black text-slate-800 focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all text-center"
                   />
                   <span className="text-xs font-black text-slate-400 uppercase">Days</span>
                </div>
              </div>

              <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl">
                 <p className="text-[10px] text-amber-700 leading-relaxed font-bold italic text-center">
                   Weekends are automatically skipped. This padding affects only the Client-facing deadline.
                 </p>
              </div>
           </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-6 bg-slate-50/50 border-t flex gap-3">
           <button 
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-black text-slate-400 hover:bg-slate-100 transition-all uppercase tracking-widest"
           >
             Cancel
           </button>
           <button 
            onClick={handleSave}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-primary text-white rounded-2xl text-[10px] font-black shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 uppercase tracking-widest disabled:opacity-50"
           >
             {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} strokeWidth={3} />}
             Save Buffer
           </button>
        </div>
      </div>
    </div>
  );
}
