"use client";

import React, { useState, useEffect } from "react";
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Filter,
  User,
  Clock,
  CheckCircle2,
  Folder
} from "lucide-react";
import StitchDatePicker from "@/components/ui/StitchDatePicker";
import { useToast } from "@/components/ui/ToastContext";
import EODModal from "@/components/tasks/EODModal";

interface DailyTask {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  allottedHours: number;
  status: string;
  timelineItem?: {
    project: { name: string }
  };
}

export default function CalendarPage() {
  const { showToast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTaskForEOD, setSelectedTaskForEOD] = useState<DailyTask | null>(null);

  useEffect(() => {
    fetchTasks();
  }, [currentDate]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/daily-tasks?date=${currentDate.toISOString()}`);
      const data = await res.json();
      if (Array.isArray(data)) setTasks(data);
    } catch (err) {
      showToast("Failed to sync calendar.", "error");
    } finally {
      setLoading(false);
    }
  };

  const nextDay = () => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate() + 1)));
  const prevDay = () => setCurrentDate(new Date(currentDate.setDate(currentDate.getDate() - 1)));

  const toggleTaskStatus = async (task: DailyTask) => {
    if (task.status === 'in-progress') {
        setSelectedTaskForEOD(task);
        return;
    }

    const statusMap: Record<string, string> = {
      'todo': 'in-progress',
      'done': 'todo'
    };
    const nextStatus = statusMap[task.status] || 'todo';
    
    try {
      const res = await fetch("/api/daily-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: nextStatus }),
      });
      if (res.ok) {
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: nextStatus } : t));
        showToast(`Task status updated to ${nextStatus.toUpperCase()}`, "success");
      }
    } catch (err) {
      showToast("Failed to update task status.", "error");
    }
  };

  return (
    <div className="flex h-screen bg-surface-subtle font-sans overflow-hidden">
      
      {/* EOD Modal Overlay */}
      {selectedTaskForEOD && (
        <EODModal 
          task={selectedTaskForEOD} 
          onClose={() => setSelectedTaskForEOD(null)} 
          onSuccess={() => {
            setTasks(prev => prev.map(t => t.id === selectedTaskForEOD.id ? { ...t, status: 'done' } : t));
          }} 
        />
      )}

      {/* Calendar Sidebar (Mini) */}
      <div className="w-[340px] border-r bg-surface-default p-8 flex flex-col gap-8 shadow-xl z-20 overflow-auto">
        <div>
           <h1 className="text-2xl font-black text-text-primary tracking-tighter uppercase mb-1">Ecosystem</h1>
           <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Unified Resource Calendar</p>
        </div>

        <StitchDatePicker 
           selectedDate={currentDate}
           onSelect={setCurrentDate}
        />

        <div className="flex-1 space-y-6">
           <div>
              <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-3">Resource Filters</p>
              <div className="space-y-2">
                 {['MY TASKS', 'TEAM OVERVIEW', 'CLIENT PARTNERS'].map((f) => (
                   <button key={f} className="w-full flex items-center justify-between px-4 py-3 bg-surface-muted border border-border-default rounded-2xl hover:bg-primary/5 transition-all text-[10px] font-black text-text-secondary hover:text-primary">
                     {f}
                     <Filter className="w-3 h-3" />
                   </button>
                 ))}
              </div>
           </div>

           <div>
              <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest mb-3">Project Legends</p>
              <div className="grid grid-cols-2 gap-2">
                 <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[9px] font-black text-emerald-700 uppercase">ACTIVE</span>
                 </div>
                 <div className="flex items-center gap-2 p-2 bg-rose-50 rounded-lg">
                    <div className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-[9px] font-black text-rose-700 uppercase">URGENT</span>
                 </div>
              </div>
           </div>
        </div>
      </div>

      {/* Main Day View */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* Day Header */}
        <div className="p-8 border-b bg-surface-default flex items-center justify-between">
           <div className="flex items-center gap-6">
              <div className="flex gap-2">
                 <button onClick={prevDay} className="p-2 hover:bg-surface-subtle rounded-xl border border-border-default text-text-secondary">
                    <ChevronLeft className="w-5 h-5" />
                 </button>
                 <button onClick={nextDay} className="p-2 hover:bg-surface-subtle rounded-xl border border-border-default text-text-secondary">
                    <ChevronRight className="w-5 h-5" />
                 </button>
              </div>
              <div>
                 <h2 className="text-3xl font-black text-text-primary tracking-tighter">
                    {currentDate.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
                 </h2>
                 <p className="text-xs font-bold text-primary uppercase tracking-[0.2em]">Today&apos;s Targeted Tasks</p>
              </div>
           </div>

           <button className="flex items-center gap-3 px-6 py-3 bg-text-primary rounded-[2rem] text-surface-default hover:bg-primary transition-all shadow-2xl active:scale-95">
              <Plus className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Add Activity</span>
           </button>
        </div>

        {/* Hour Grid (Scrollable) */}
        <div className="flex-1 overflow-auto bg-surface-default/40 p-10 relative">
           
           {/* Timeline Lines */}
           <div className="absolute inset-0 pt-10 px-10 pointer-events-none opacity-20">
              {Array.from({ length: 13 }).map((_, i) => (
                <div key={i} className="h-20 border-t border-border-default flex justify-end pr-4">
                  <span className="text-[9px] font-black text-text-secondary">{(i + 8) % 12 || 12} {i + 8 >= 12 ? 'PM' : 'AM'}</span>
                </div>
              ))}
           </div>

           {/* Task Blocks Container */}
           <div className="relative pt-10 min-h-[1040px] flex flex-col">
              {tasks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30 mt-20">
                    <CalendarIcon className="w-20 h-20 text-border-default mb-6" />
                    <p className="text-sm font-black text-text-secondary uppercase tracking-widest">No Tasks Scheduled for this day</p>
                </div>
              ) : tasks.map((t) => {
                const start = new Date(t.startTime).getHours();
                const end = new Date(t.endTime).getHours();
                const top = (start - 8) * 80;
                const height = (end - start) * 80;

                return (
                  <div 
                    key={t.id}
                    onClick={() => toggleTaskStatus(t)}
                    className="absolute left-0 right-0 p-4 bg-surface-default border border-border-default rounded-[2rem] shadow-xl hover:shadow-2xl hover:scale-[1.01] transition-all cursor-pointer z-10 group active:scale-95"
                    style={{ top: `${top}px`, height: `${height}px`, minHeight: '80px' }}
                  >
                    <div className="h-full flex flex-col justify-between">
                       <div className="flex items-start justify-between">
                          <div className="flex-1">
                             <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] font-black text-primary uppercase tracking-widest">
                                  {t.timelineItem?.project?.name || "STANDALONE"}
                                </span>
                                <span className="text-white/20">•</span>
                                <p className="text-[9px] font-bold text-text-secondary uppercase tracking-widest">{new Date(t.startTime).toTimeString().substring(0, 5)} - {new Date(t.endTime).toTimeString().substring(0, 5)}</p>
                             </div>
                             <h4 className="text-lg font-black text-text-primary tracking-tight leading-none truncate group-hover:text-primary transition-colors">{t.title}</h4>
                          </div>
                          
                          <div className={`p-2 rounded-xl border ${t.status === 'done' ? 'bg-emerald-50 text-emerald-500 border-emerald-100' : 'bg-surface-muted text-text-secondary border-border-default'}`}>
                             {t.status === 'done' ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                          </div>
                       </div>

                       <div className="flex items-center justify-between">
                          <div className="flex -space-x-2">
                             {[1, 2].map(i => (
                               <div key={i} className="w-6 h-6 rounded-lg bg-surface-muted border-2 border-surface-default flex items-center justify-center text-[8px] font-black text-text-secondary uppercase">
                                  <User className="w-2.5 h-2.5" />
                               </div>
                             ))}
                          </div>
                          <button className="p-2 hover:bg-surface-subtle rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                             <Folder className="w-4 h-4 text-border-default" />
                          </button>
                       </div>
                    </div>
                  </div>
                );
              })}
           </div>

        </div>
      </div>
    </div>
  );
}
