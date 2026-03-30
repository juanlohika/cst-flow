"use client";

import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Target } from "lucide-react";

interface CalendarTask {
  id: string;
  title: string;
  date: Date;
  status: "pending" | "in-progress" | "completed" | "done" | "todo";
  project?: string;
  client?: string;
  isDailyTask: boolean;
  isMeeting?: boolean;
}

interface GlobalCalendarProps {
  projectId?: string;
  onTaskClick?: (task: any) => void;
  filteredTasks?: any[];
}

export default function GlobalCalendar({ projectId, onTaskClick, filteredTasks }: GlobalCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);

  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const startDate = new Date(monthStart);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  useEffect(() => {
    fetchUnifiedTasks();
  }, [currentDate, projectId, filteredTasks]);

  const fetchUnifiedTasks = async () => {
    setLoading(true);
    try {
      const month = currentDate.getMonth() + 1;
      const year = currentDate.getFullYear();
      const pId = projectId || "ALL";

      const dailyRes = await fetch(`/api/daily-tasks?month=${month}&year=${year}&projectId=${pId}`);
      const dailyData = await dailyRes.json();

      const merged: CalendarTask[] = [];
      let roadmapData = filteredTasks;
      
      if (!roadmapData) {
        const roadmapRes = await fetch(`/api/tasks?month=${month}&year=${year}&projectId=${pId}`);
        roadmapData = await roadmapRes.json();
      }

      if (Array.isArray(roadmapData)) {
        roadmapData.forEach((t: any) => {
          merged.push({
            id: t.id,
            title: t.subject,
            date: new Date(t.plannedStart),
            status: t.status,
            project: t.project?.name || "PROJECT",
            client: t.project?.clientName || "CLIENT",
            isDailyTask: false,
            isMeeting: t.isMeeting
          });
        });
      }

      if (Array.isArray(dailyData)) {
        dailyData.forEach((t: any) => {
          merged.push({
            id: t.id,
            title: t.title,
            date: new Date(t.date),
            status: t.status,
            project: t.timelineItem?.project?.name || "PROJECT",
            client: t.timelineItem?.project?.clientName || "CLIENT",
            isDailyTask: true
          });
        });
      }

      setTasks(merged);
    } catch (err) {
      console.error("Failed to fetch unified tasks", err);
    } finally {
      setLoading(false);
    }
  };

  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

  const days = [];
  let dayPtr = new Date(startDate);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(dayPtr));
    dayPtr.setDate(dayPtr.getDate() + 1);
  }

  const getStatusStyle = (task: CalendarTask) => {
    if (task.isMeeting) return "bg-violet-600 border-violet-700 shadow-md text-white";
    if (task.status === "done" || task.status === "completed") return "bg-emerald-500 border-emerald-600 text-white";
    if (task.status === "in-progress") return "bg-primary border-primary-dark shadow-md text-white";
    if (task.isDailyTask) return "bg-slate-700 border-slate-900 text-white";
    return "bg-slate-100 text-slate-400 border-slate-200";
  };

  return (
    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden mb-6 font-sans flex flex-col shrink-0 min-w-0">
      <style jsx global>{`
        .day-cell-scroll::-webkit-scrollbar { width: 3px; }
        .day-cell-scroll::-webkit-scrollbar-track { background: transparent; }
        .day-cell-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>
      
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary border border-primary/10 shadow-inner">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tighter leading-none uppercase">
              {currentDate.toLocaleDateString("en", { month: "long", year: "numeric" })}
            </h2>
            <p className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mt-1.5 flex items-center gap-2">
               <Target className="w-2.5 h-2.5" /> Calendar Matrix
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={prevMonth} className="p-2 hover:bg-slate-50 rounded-xl border border-slate-100 text-slate-400 transition-all shadow-sm">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button 
             onClick={() => setCurrentDate(new Date())}
             className="px-4 py-2 bg-slate-900 text-white border border-slate-800 rounded-xl text-[9px] font-black hover:bg-primary transition-all uppercase tracking-widest shadow-xl mx-1"
          >
            Today
          </button>
          <button onClick={nextMonth} className="p-2 hover:bg-slate-50 rounded-xl border border-slate-100 text-slate-400 transition-all shadow-sm">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-50 bg-slate-50/50">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="px-4 py-3 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 border-r border-b border-slate-50 shadow-inner">
        {days.map((d, i) => {
          const isCurrentMonth = d.getMonth() === currentDate.getMonth();
          const isToday = d.toDateString() === new Date().toDateString();
          const dayTasks = tasks.filter(t => t.date.toDateString() === d.toDateString());

          return (
            <div 
              key={i} 
              className={`min-h-[160px] border-l border-t border-slate-100 p-0 transition-all group flex flex-col ${!isCurrentMonth ? "bg-slate-50/30" : "bg-white"}`}
            >
              <div className="p-2 flex items-center justify-between sticky top-0 bg-inherit z-10">
                <span className={`text-[11px] font-black transition-all ${isToday ? "bg-primary text-white w-7 h-7 rounded-lg flex items-center justify-center shadow-lg shadow-primary/30 scale-110" : isCurrentMonth ? "text-slate-900" : "text-slate-200"}`}>
                  {d.getDate()}
                </span>
                {dayTasks.length > 0 && (
                   <span className="text-[8px] font-black text-slate-300 uppercase bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-100">{dayTasks.length}</span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto day-cell-scroll px-1.5 pb-3 space-y-1 max-h-[120px]">
                {dayTasks.map((task, idx) => (
                  <div 
                    key={`${task.id}-${idx}`}
                    onClick={() => onTaskClick?.(task)}
                    className={`p-2 rounded-xl text-[9px] font-black truncate cursor-pointer hover:border-primary/50 transition-all shadow-sm flex flex-col gap-0.5 border-l-[4px] border ${getStatusStyle(task)} ${task.status === 'pending' && !task.isDailyTask ? 'bg-white text-slate-600' : 'text-white'}`}
                  >
                    <div className="flex items-center justify-between opacity-70">
                       <span className="truncate tracking-tighter uppercase text-[8px]">{task.project}</span>
                       <span className="text-[7px] shrink-0">
                         {task.isMeeting ? "MEETING" : task.isDailyTask ? "TASK" : "PLAN"}
                       </span>
                    </div>
                    <span className="truncate uppercase tracking-tight leading-none text-[10px]">{task.title}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
