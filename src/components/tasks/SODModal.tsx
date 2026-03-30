"use client";

import React, { useState } from "react";
import { X, Zap, Calendar, Clock, Edit3 } from "lucide-react";
import StitchTimePicker from "@/components/ui/StitchTimePicker";
import StitchDatePicker from "@/components/ui/StitchDatePicker";
import { useToast } from "@/components/ui/ToastContext";

interface SODModalProps {
  task: {
    id: string;
    taskCode: string;
    subject: string;
    owner: string;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export default function SODModal({ task, onClose, onSuccess }: SODModalProps) {
  const { showToast } = useToast();
  const [taskTitle, setTaskTitle] = useState(task.subject);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [timeSlot, setTimeSlot] = useState({ start: "09:00", end: "11:00" });
  const [loading, setLoading] = useState(false);

  const handleDeploy = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/daily-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timelineItemId: task.id,
          title: taskTitle,
          date: selectedDate.toISOString(),
          startTime: `${selectedDate.toISOString().split('T')[0]}T${timeSlot.start.padStart(5, '0')}:00Z`,
          endTime: `${selectedDate.toISOString().split('T')[0]}T${timeSlot.end.padStart(5, '0')}:00Z`,
          allottedHours: parseFloat(timeSlot.end) - parseFloat(timeSlot.start) || 2
        }),
      });

      if (res.ok) {
        showToast("Task Deployed Successfully!", "success");
        onSuccess();
        onClose();
      } else {
        showToast("Failed to submit DAR.", "error");
      }
    } catch (err) {
      showToast("Network error.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-100 flex flex-col max-h-[90vh]">
        
        {/* Glassmorphism Header */}
        <div className="p-8 border-b border-slate-100 bg-white/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-black tracking-widest uppercase text-slate-400 mb-1">DAR TASK PLANNING</p>
              <h1 className="text-xl font-black tracking-tight text-slate-900 truncate max-w-[400px]">
                {task.subject}
              </h1>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-xl transition-all border border-slate-100 shadow-sm text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-8 space-y-8">
          {/* Sub-Task Input */}
          <div className="space-y-3">
             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Edit3 className="w-3 h-3 text-primary" /> What specifically are you working on today?
             </label>
             <input 
                type="text" 
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Enter sub-task name (optional)"
                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-slate-300"
             />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             {/* Integrated Date Picker */}
             <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <Calendar className="w-3 h-3 text-primary" /> Target Date
                </label>
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-3xl flex items-center justify-center">
                   <StitchDatePicker 
                      selectedDate={selectedDate}
                      onSelect={setSelectedDate}
                   />
                </div>
             </div>

             {/* Integrated Time Selection */}
             <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <Clock className="w-3 h-3 text-primary" /> Task Window
                </label>
                <StitchTimePicker
                   defaultValue={timeSlot}
                   onSelect={(start, end) => setTimeSlot({ start, end })}
                />
             </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex justify-end">
           <button 
             onClick={handleDeploy}
             disabled={loading}
             className="px-10 py-4 bg-slate-900 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-widest shadow-2xl hover:bg-primary transition-all active:scale-95 disabled:opacity-30"
           >
             {loading ? "Deploying..." : "Initialize Task"}
           </button>
        </div>
      </div>
    </div>
  );
}
