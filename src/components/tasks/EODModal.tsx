"use client";

import React, { useState } from "react";
import { X, CheckCircle2, Award, Calendar, Clock } from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";
import StitchDatePicker from "@/components/ui/StitchDatePicker";
import StitchTimePicker from "@/components/ui/StitchTimePicker";

interface EODModalProps {
  task: {
    id: string;
    title: string;
    allottedHours: number;
  };
  onClose: () => void;
  onSuccess: (actualHours: number) => void;
}

export default function EODModal({ task, onClose, onSuccess }: EODModalProps) {
  const { showToast } = useToast();
  const [actualDate, setActualDate] = useState(new Date());
  const [actualTime, setActualTime] = useState({ start: "09:00", end: "11:00" });
  const [loading, setLoading] = useState(false);

  const calculateHours = () => {
     const start = parseFloat(actualTime.start.split(":")[0]) + (parseFloat(actualTime.start.split(":")[1]) / 60);
     const end = parseFloat(actualTime.end.split(":")[0]) + (parseFloat(actualTime.end.split(":")[1]) / 60);
     return Math.max(0.5, end - start);
  };

  const handleComplete = async () => {
    setLoading(true);
    const hours = calculateHours();
    try {
      const res = await fetch("/api/daily-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: task.id,
          status: "done",
          actualHours: hours,
          completedAt: `${actualDate.toISOString().split('T')[0]}T${actualTime.end}:00Z`
        }),
      });

      if (res.ok) {
        showToast("Task Accomplished!", "success");
        onSuccess(hours);
        onClose();
      } else {
        showToast("Failed to record performance.", "error");
      }
    } catch (err) {
      showToast("Network error.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200 text-slate-900">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-100 flex flex-col max-h-[95vh]">
        
        {/* Header */}
        <div className="p-8 bg-emerald-600 text-white relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center border border-white/30 backdrop-blur-sm">
              <Award className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-black tracking-widest uppercase text-white/60 mb-1">EOD PERFORMANCE REPORT</p>
              <h1 className="text-xl font-black tracking-tight truncate max-w-[350px]">{task.title}</h1>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-all">
            <X className="w-5 h-5 text-white/50" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-8 space-y-8">
           <p className="text-sm font-medium text-slate-500 mb-2">Confirm the actual time and date of completion for accurate analytics.</p>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Date Selection */}
              <div className="space-y-3">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Calendar className="w-3 h-3 text-emerald-500" /> Completion Date
                 </label>
                 <div className="p-4 bg-slate-50 border border-slate-100 rounded-3xl flex items-center justify-center">
                    <StitchDatePicker 
                       selectedDate={actualDate}
                       onSelect={setActualDate} 
                    />
                 </div>
              </div>

              {/* Time Selection */}
              <div className="space-y-3">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Clock className="w-3 h-3 text-emerald-500" /> Actual Time Span
                 </label>
                 <div className="p-4 bg-slate-50 border border-slate-100 rounded-3xl flex flex-col items-center justify-center min-h-[300px]">
                    <StitchTimePicker 
                       defaultValue={actualTime}
                       onSelect={(start, end) => setActualTime({ start, end })} 
                    />
                    <div className="mt-6 p-4 bg-white border border-emerald-100 rounded-2xl text-center shadow-sm w-full">
                       <p className="text-[9px] font-black text-emerald-600 uppercase mb-1">Total Effort</p>
                       <p className="text-2xl font-black text-slate-900">{calculateHours()} <span className="text-xs">HRS</span></p>
                    </div>
                 </div>
              </div>
           </div>
        </div>

        {/* Footer */}
        <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end">
          <button 
            onClick={handleComplete}
            disabled={loading}
            className="flex items-center gap-2 px-10 py-4 bg-emerald-600 rounded-[2rem] text-white hover:bg-slate-900 transition-all shadow-xl shadow-emerald-200 active:scale-95 disabled:opacity-50 text-[10px] font-black uppercase tracking-widest"
          >
             <CheckCircle2 className="w-4 h-4 text-emerald-400" />
             Complete Task
          </button>
        </div>
      </div>
    </div>
  );
}
