"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { User, Clock, Plus, Trash2, X, Calendar, GripVertical, Briefcase, Lock, CheckCircle2, ChevronRight, ChevronDown, Timer } from "lucide-react";
import { calculateClientEndDate } from "@/lib/utils/business-days";
import { calculateUserDailyLoad, formatToISODate } from "@/lib/utils/conflict-utils";
import { AlertTriangle } from "lucide-react";

interface TimelineEvent {
  id: string;
  taskCode: string;
  subject: string;
  startDate: string;
  endDate: string;
  durationHours: number;
  owner: string;
  description: string;
  projectName?: string;
  status?: string;
  depth?: number;
  expanded?: boolean;
  hasChildren?: boolean;
  paddingDays?: number;
  externalPlannedEnd?: string;
  isSummary?: boolean;
}

interface InteractiveGanttProps {
  events: TimelineEvent[];
  onUpdateEvents: (newEvents: TimelineEvent[]) => void;
  onTaskClick?: (id: string) => void;
  onReschedule?: (id: string, newStart: string, newEnd: string) => void;
  onToggleExpand?: (id: string) => void;
  onAllocateHours?: (taskId: string, taskSubject: string, durationHours: number) => void;
  onUpdateBuffer?: (taskId: string, currentPadding: number) => void;
  scale: "day" | "week" | "month";
  ganttRef?: React.RefObject<HTMLDivElement>;
  /** When true, rows show checkboxes for multi-select buffer mode */
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  smartMode?: boolean;
  allExternalEvents?: any[];
}

export default function InteractiveGantt({
  events,
  onUpdateEvents,
  onTaskClick,
  onReschedule,
  onToggleExpand,
  onAllocateHours,
  onUpdateBuffer,
  scale,
  ganttRef,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  smartMode = false,
  allExternalEvents = [],
}: InteractiveGanttProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [loadModalDate, setLoadModalDate] = useState<Date | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const startRename = (e: React.MouseEvent, event: TimelineEvent) => {
    e.stopPropagation();
    setEditingId(event.id);
    setEditingValue(event.subject);
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = editingValue.trim();
    if (trimmed) {
      const updated = events.map(ev => ev.id === editingId ? { ...ev, subject: trimmed } : ev);
      onUpdateEvents(updated);
    }
    setEditingId(null);
  };

  const [dragInfo, setDragInfo] = useState<{
    index: number;
    startX: number;
    type: "move" | "left" | "right";
    initialStart: string;
    initialEnd: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragOccurredRef = useRef(false);

  // Constants for Compact Design
  const ROW_HEIGHT = 40; 
  const colWidth = scale === "day" ? 48 : scale === "week" ? 120 : 240;
  const dayStep = scale === "day" ? 1 : scale === "week" ? 7 : 30;

  const { minDate, maxDate } = useMemo(() => {
    if (events.length === 0) return { minDate: new Date(), maxDate: new Date() };
    const starts = events.map(e => new Date(e.startDate).getTime());
    const ends = events.map(e => new Date(e.endDate || e.startDate).getTime());
    const extEnds = events.map(e => e.externalPlannedEnd ? new Date(e.externalPlannedEnd).getTime() : 0);
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends, ...extEnds));
    
    const start = new Date(min);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 3); 
    
    const end = new Date(max);
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 3);
    
    return { minDate: start, maxDate: end };
  }, [events]);

  const dates = useMemo(() => {
    const list: Date[] = [];
    let curr = new Date(minDate);
    curr.setUTCHours(0, 0, 0, 0);
    while (curr <= maxDate) {
      list.push(new Date(curr));
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
    return list;
  }, [minDate, maxDate]);

  const monthGroups = useMemo(() => {
    const groups: { month: string; days: number }[] = [];
    dates.forEach(d => {
      const m = d.toLocaleString("default", { month: "long", year: "numeric" });
      const last = groups[groups.length - 1];
      if (last && last.month === m) { last.days++; } else { groups.push({ month: m, days: 1 }); }
    });
    return groups;
  }, [dates]);

  const isWeekend = (date: Date) => (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  const isToday = (date: Date) => {
    const today = new Date();
    return date.getUTCFullYear() === today.getFullYear() && 
           date.getUTCMonth() === today.getMonth() && 
           date.getUTCDate() === today.getDate();
  };

  const calculatePosition = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(0, 0, 0, 0);
    
    // Safety check for minDate being valid
    const minTime = minDate.getTime();
    const diffStart = Math.round((start.getTime() - minTime) / (1000 * 60 * 60 * 24));
    const diffEnd = Math.round((end.getTime() - minTime) / (1000 * 60 * 60 * 24)) + 1;
    const unitWidth = colWidth / dayStep;
    return { left: diffStart * unitWidth, width: Math.max(unitWidth, (diffEnd - diffStart) * unitWidth) };
  };

  const pixelToDays = (px: number) => px / (colWidth / dayStep);

  const addDays = (dateStr: string, days: number) => {
    const d = new Date(dateStr);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + Math.round(days));
    return d.toISOString().split("T")[0];
  };

  const handleDragStart = (index: number, type: "move" | "left" | "right", clientX: number) => {
    if (events[index].status === 'completed' || events[index].isSummary) return;
    setDragInfo({
      index,
      startX: clientX,
      type,
      initialStart: events[index].startDate,
      initialEnd: events[index].endDate,
    });
  };

  const eventsRef = useRef(events);
  useEffect(() => { eventsRef.current = events; }, [events]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragInfo) return;
      const deltaX = e.clientX - dragInfo.startX;
      if (Math.abs(deltaX) > 2) dragOccurredRef.current = true;
      const deltaDays = pixelToDays(deltaX);
      const newEvents = [...eventsRef.current];
      const ev = { ...newEvents[dragInfo.index] };
      if (dragInfo.type === "move") {
        ev.startDate = addDays(dragInfo.initialStart, deltaDays);
        ev.endDate = addDays(dragInfo.initialEnd, deltaDays);
      } else if (dragInfo.type === "left") {
        ev.startDate = addDays(dragInfo.initialStart, deltaDays);
      } else if (dragInfo.type === "right") {
        ev.endDate = addDays(dragInfo.initialEnd, deltaDays);
      }
      if (ev.paddingDays && ev.paddingDays > 0) {
        ev.externalPlannedEnd = calculateClientEndDate(ev.endDate, ev.paddingDays) || undefined;
      }
      newEvents[dragInfo.index] = ev;
      onUpdateEvents(newEvents);
    };

    const handleMouseUp = () => {
      if (dragInfo && onReschedule) {
        const ev = eventsRef.current[dragInfo.index];
        if (ev.startDate !== dragInfo.initialStart || ev.endDate !== dragInfo.initialEnd) {
           onReschedule(ev.id, ev.startDate, ev.endDate);
        }
      }
      setTimeout(() => { dragOccurredRef.current = false; }, 50);
      setDragInfo(null);
    };

    if (dragInfo) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragInfo]);

  const getProjectGradient = (projectName: string = "", id: string = "") => {
    const p = projectName.toUpperCase();
    if (p.includes("TAPA KING")) return "from-rose-500 to-rose-400";
    if (p.includes("MANPOWER")) return "from-emerald-500 to-emerald-400";
    if (p.includes("MIGRATION")) return "from-blue-600 to-blue-400";
    
    // Dynamic fallback based on project name hash
    const colors = [
      "from-indigo-500 to-indigo-400",
      "from-amber-500 to-amber-400",
      "from-violet-500 to-violet-400",
      "from-emerald-500 to-emerald-400",
      "from-sky-500 to-sky-400"
    ];
    let hash = 0;
    for (let i = 0; i < projectName.length; i++) hash += projectName.charCodeAt(i);
    return colors[hash % colors.length];
  };

  // Pre-calculate daily loads per owner for Smart Mode
  const loadMap = useMemo(() => {
    if (!smartMode) return new Map();
    const map = new Map<string, number>();
    
    // Get unique owners (Internal + External)
    const allEvents = [...events, ...allExternalEvents];
    const owners = Array.from(new Set(allEvents.map(e => e.owner)));
    
    owners.forEach(owner => {
       dates.forEach(date => {
          const dateStr = formatToISODate(date);
          const load = calculateUserDailyLoad(owner, date, events, allExternalEvents);
          if (load > 0) {
             map.set(`${owner}-${dateStr}`, load);
          }
       });
    });
    return map;
  }, [events, allExternalEvents, dates, smartMode]);

  // Aggregate daily totals for the bubbles
  const dailyTotals = useMemo(() => {
    if (!smartMode) return new Map();
    const map = new Map<string, number>();
    dates.forEach(date => {
      const dateStr = formatToISODate(date);
      let total = 0;
      const owners = Array.from(new Set([...events, ...allExternalEvents].map(e => e.owner)));
      owners.forEach(owner => {
        total += loadMap.get(`${owner}-${dateStr}`) || 0;
      });
      if (total > 0) map.set(dateStr, total);
    });
    return map;
  }, [loadMap, dates, smartMode, events, allExternalEvents]);

  const hasConflict = (event: TimelineEvent) => {
    if (!smartMode) return false;
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);
    while (current <= end) {
      const dateStr = formatToISODate(current);
      const load = loadMap.get(`${event.owner}-${dateStr}`) || 0;
      if (load > 8.01) return true;
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return false;
  };

  return (
    <div ref={ganttRef} className="flex flex-col h-full bg-white shadow-2xl rounded-[1.5rem] overflow-hidden border border-slate-200" style={{ "--col-width": `${colWidth}px` } as any}>
      <div className="flex-1 overflow-auto relative font-sans scroll-smooth thin-scrollbar" ref={containerRef}>
        <div style={{ width: (dates.length / dayStep) * colWidth + 400 }} className="min-h-full flex flex-col">
          
          <div className="sticky top-0 z-[60] flex flex-col bg-white border-b">
            <div className="flex h-[36px]">
              <div className="w-[320px] shrink-0 sticky left-0 z-[70] bg-slate-50 border-r flex items-center px-4">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Hierarchy / Timeline</span>
              </div>
              <div className="flex">
                {monthGroups.map((g, i) => (
                  <div key={i} style={{ width: (g.days / dayStep) * colWidth }} className="border-r h-full flex items-center px-4 text-[9px] font-bold uppercase text-slate-500 tracking-wider">
                    {g.month}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex h-[28px] bg-slate-50/50">
               <div className="w-[320px] shrink-0 sticky left-0 z-[70] bg-slate-50/80 border-r" />
               <div className="flex">
                 {dates.filter((_, idx) => idx % dayStep === 0).map((d, i) => {
                    const dateStr = formatToISODate(d);
                    const totalLoad = dailyTotals.get(dateStr) || 0;
                    return (
                      <div 
                        key={i} 
                        style={{ width: "var(--col-width)" }} 
                        className={`group/date border-r h-full flex flex-col items-center justify-center relative ${isToday(d) ? 'bg-primary/10 text-primary border-primary/20' : 'text-slate-400'} border-slate-100 cursor-pointer hover:bg-slate-100/80 transition-colors`}
                        onClick={() => setLoadModalDate(d)}
                        title="Click to view daily resource load details"
                      >
                        <span className="text-[9px] font-bold uppercase leading-none">
                          {scale === "day" ? d.getDate() : scale === "week" ? `Wk ${Math.ceil(d.getDate() / 7)}` : d.toLocaleDateString("en", { month: "short" })}
                        </span>

                        {smartMode && (
                          <div className="absolute inset-x-0 bottom-0 flex justify-center pb-0.5">
                            <div 
                              className={`w-3.5 h-1 md:w-5 md:h-1.5 rounded-full transition-all peer ${
                                totalLoad > 8.5 ? "bg-rose-500 animate-pulse" : totalLoad >= 8 ? "bg-amber-500" : totalLoad > 0 ? "bg-emerald-500" : "bg-transparent"
                              }`}
                            />
                            {totalLoad > 0 && (
                              <div className="absolute bottom-full mb-1 opacity-0 group-hover/date:opacity-100 transition-opacity bg-slate-800 text-white text-[8px] font-bold px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap z-[100] shadow-xl ring-1 ring-white/20">
                                {totalLoad.toFixed(1)}h Total Load
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                 })}
               </div>
            </div>
          </div>

          <div className="relative flex-1">
            <div className="absolute top-0 left-[320px] bottom-0 pointer-events-none z-0 flex">
              {dates.filter((_, idx) => idx % dayStep === 0).map((d, i) => (
                <div key={i} style={{ width: "var(--col-width)" }} className={`h-full border-r border-slate-50 ${isWeekend(d) && scale === "day" ? 'bg-slate-50/10' : ''}`}>
                   {isWeekend(d) && scale === "day" && <div className="w-full h-full bg-slate-100 opacity-[0.2]" />}
                </div>
              ))}
            </div>

            <div className="flex flex-col">
              {events.map((e, index) => {
                const pos = calculatePosition(e.startDate, e.endDate);
                const isCompleted = e.status === 'completed';
                const depth = e.depth || 0;

                return (
                  <div key={index} style={{ height: ROW_HEIGHT }} className={`flex border-b transition-colors group ${e.isSummary ? 'bg-slate-50/20' : (depth > 0 ? 'bg-slate-50/60 border-slate-100/80 hover:bg-slate-100/40' : 'bg-white border-slate-100 hover:bg-slate-50/40')}`}>
                    <div
                      className={`w-[320px] shrink-0 sticky left-0 z-50 border-r flex flex-col justify-center px-5 shadow-[4px_0_12px_rgba(0,0,0,0.01)] cursor-pointer ${depth > 0 ? 'bg-slate-50/80' : 'bg-white'} ${selectionMode && selectedIds?.has(e.id) ? 'bg-indigo-50/60' : ''}`}
                      onClick={() => {
                        if (selectionMode && !e.isSummary) { onToggleSelect?.(e.id); return; }
                        if (!dragOccurredRef.current && editingId !== e.id) onTaskClick?.(e.id);
                      }}
                    >
                      {/* Buffer Selection indicator deleted — using icons and highlights now */}
                      {depth > 0 && (
                        <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: `hsl(${(depth * 60 + 220) % 360}, 60%, 65%)`, marginLeft: depth * 20 - 4 }} />
                      )}
                      <div className="flex items-center gap-2 overflow-hidden" style={{ marginLeft: depth * 20 }}>
                        {e.hasChildren && !e.isSummary && (
                          <button onClick={(ev) => { ev.stopPropagation(); onToggleExpand?.(e.id); }} className="p-1 hover:bg-slate-100 rounded transition-all shrink-0">
                             {e.expanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                          </button>
                        )}
                        {depth > 0 && !e.hasChildren && <div className="w-5 shrink-0" />}
                        {editingId === e.id ? (
                          <input
                            ref={editInputRef}
                            value={editingValue}
                            onChange={(ev) => setEditingValue(ev.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(ev) => { if (ev.key === "Enter") commitRename(); if (ev.key === "Escape") setEditingId(null); }}
                            onClick={(ev) => ev.stopPropagation()}
                            className="text-[11px] font-bold uppercase tracking-tight flex-1 min-w-0 bg-primary/10 border border-primary/30 rounded px-1 py-0.5 text-primary outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span
                              className={`text-[11px] font-bold text-slate-700 uppercase tracking-tight truncate flex-1 ${isCompleted ? 'text-slate-400' : ''}`}
                              onDoubleClick={(ev) => startRename(ev, e)}
                              title="Double-click to rename"
                            >
                              {e.subject}
                            </span>
                            {onUpdateBuffer && !e.isSummary && (
                               <button 
                                 onClick={(ev) => { 
                                   ev.stopPropagation(); 
                                   if (onToggleSelect) onToggleSelect(e.id);
                                   else onUpdateBuffer(e.id, e.paddingDays || 0);
                                 }}
                                 className={`p-1 transition-all rounded hover:bg-primary/5 shadow-sm ${selectedIds?.has(e.id) ? 'opacity-100 text-primary bg-primary/10 ring-1 ring-primary/30' : 'opacity-0 group-hover:opacity-100 text-slate-300 hover:text-primary'}`}
                                 title="Set/Select for Client Buffer"
                               >
                                 <Timer className="w-2.5 h-2.5" strokeWidth={3} />
                               </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 mt-1" style={{ marginLeft: (depth * 20) + (e.isSummary ? 0 : 24) }}>
                         <span className="text-[8px] font-bold text-primary opacity-60">{e.taskCode}</span>
                         <span className="text-[8px] font-bold text-slate-300 uppercase">{e.owner}</span>
                         {!e.isSummary && (
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                const t = { id: e.id, subject: e.subject, plannedStart: e.startDate, plannedEnd: e.endDate };
                                (window as any).dispatchAddTask?.(t);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-primary/10 rounded transition-all text-primary"
                              title="Add Subtask"
                            >
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                         )}
                      </div>
                    </div>

                    <div className="flex-1 relative h-full flex items-center">
                         {/* MAIN INTERNAL BAR */}
                         <div 
                           style={{ 
                             left: `calc(${pos.left}px)`, 
                             width: `calc(${pos.width}px)`,
                             top: '6px',
                             bottom: '6px'
                           }}
                           onMouseDown={(ev) => !e.isSummary && handleDragStart(index, "move", ev.clientX)}
                           className={`absolute bg-gradient-to-r ${getProjectGradient(e.projectName, e.id)} rounded-md shadow-sm border border-black/5 flex flex-col justify-center px-4 text-white z-20 group/bar transition-all ${e.isSummary ? 'h-[28px] ring-2 ring-white/20' : (isCompleted ? 'opacity-100 shadow-md ring-1 ring-black/5' : 'opacity-80 cursor-move border-dashed hover:opacity-100')} ${hasConflict(e) ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-white animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5)]' : ''}`}
                        >
                           {hasConflict(e) && (
                             <div className="absolute -top-1 -left-1 z-50 bg-white rounded-full p-0.5 shadow-md border border-red-200">
                               <AlertTriangle className="w-3 h-3 text-red-500" />
                             </div>
                           )}
                           {!isCompleted && !e.isSummary && (
                             <>
                               <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 active:bg-white/50 z-30" onMouseDown={(ev) => { ev.stopPropagation(); handleDragStart(index, "left", ev.clientX); }} />
                               <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 active:bg-white/50 z-30" onMouseDown={(ev) => { ev.stopPropagation(); handleDragStart(index, "right", ev.clientX); }} />
                               
                               {/* TERMINAL BUFFER ICON */}
                               <button 
                                 onClick={(ev) => { 
                                   ev.stopPropagation(); 
                                   if (onToggleSelect) onToggleSelect(e.id);
                                   else onUpdateBuffer?.(e.id, e.paddingDays || 0);
                                 }}
                                 className={`absolute -right-5 top-1/2 -translate-y-1/2 w-5 h-5 shadow-lg rounded-full flex items-center justify-center transition-all z-40 border ${selectedIds?.has(e.id) ? 'opacity-100 bg-primary text-white border-primary scale-110' : 'opacity-0 group-hover/bar:opacity-100 bg-white text-primary border-slate-100 hover:scale-110'}`}
                                 title="Set/Select for Client Buffer"
                               >
                                 <Timer className="w-3 h-3" strokeWidth={2.5} />
                               </button>
                             </>
                           )}
                           {e.isSummary && (
                              <div className="flex items-center justify-between pointer-events-none">
                                 <span className="text-[10px] font-black uppercase tracking-widest truncate">{e.projectName}</span>
                                 <span className="text-[8px] font-black opacity-60">STRATEGIC VIEW</span>
                              </div>
                           )}
                        </div>

                        {Boolean(e.paddingDays && e.paddingDays > 0 && e.externalPlannedEnd) && (
                          (() => {
                            if (!e.externalPlannedEnd) return null;
                            const bufferStart = calculateClientEndDate(e.endDate, 1) || e.endDate;
                            const extPos = calculatePosition(bufferStart, e.externalPlannedEnd);
                            return (
                              <div 
                                onClick={(ev) => { ev.stopPropagation(); onUpdateBuffer?.(e.id, e.paddingDays || 0); }}
                                style={{ 
                                  left: extPos.left, 
                                  width: extPos.width,
                                  top: '6px',
                                  bottom: '6px'
                                }}
                                className="absolute bg-orange-400/30 border border-orange-400/50 rounded-r-md z-10 flex items-center justify-end px-2 cursor-pointer hover:bg-orange-400/50 transition-all group/buffer"
                                title={`Client Buffer until ${e.externalPlannedEnd}. Click to edit.`}
                              >
                                <span className="text-[7px] font-black text-orange-600/60 uppercase tracking-tighter opacity-0 group-hover/buffer:opacity-100 whitespace-nowrap">Client Buffer</span>
                              </div>
                            );
                          })()
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {loadModalDate && (
        <DailyLoadDetailModal
          date={loadModalDate}
          events={events}
          externalEvents={allExternalEvents}
          onClose={() => setLoadModalDate(null)}
        />
      )}
    </div>
  );
}

function DailyLoadDetailModal({ date, events, externalEvents, onClose }: { date: Date; events: any[]; externalEvents: any[]; onClose: () => void }) {
  const dateStr = formatToISODate(date);
  
  const relevantTasks = useMemo(() => {
    const all = [...events, ...externalEvents];
    return all.filter(ev => {
      if (ev.archived || ev.status === 'completed') return false;
      const s = formatToISODate(new Date(ev.startDate));
      const e = formatToISODate(new Date(ev.endDate));
      return dateStr >= s && dateStr <= e;
    }).sort((a, b) => (a.owner || "").localeCompare(b.owner || ""));
  }, [dateStr, events, externalEvents]);

  const loadByOwner = useMemo(() => {
    const map = new Map<string, number>();
    const owners = Array.from(new Set(relevantTasks.map(t => t.owner)));
    owners.forEach(owner => {
      const load = calculateUserDailyLoad(owner, date, events, externalEvents);
      map.set(owner, load);
    });
    return map;
  }, [relevantTasks, date, events, externalEvents]);

  const totalHours = Array.from(loadByOwner.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
        <div className="px-8 py-6 border-b flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" /> {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Resource Overload Monitoring</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-all text-slate-400 hover:text-rose-500 shadow-sm border border-transparent hover:border-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-8 max-h-[60vh] overflow-y-auto thin-scrollbar">
          {relevantTasks.length === 0 ? (
            <div className="text-center py-12">
               <Briefcase className="w-12 h-12 text-slate-200 mx-auto mb-4" />
               <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No tasks scheduled for this day</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(new Set(relevantTasks.map(t => t.owner))).map(owner => {
                const ownerTasks = relevantTasks.filter(t => t.owner === owner);
                const ownerLoad = loadByOwner.get(owner) || 0;
                return (
                  <div key={owner} className="bg-slate-50/50 rounded-2xl p-4 border border-slate-100">
                    <div className="flex items-center justify-between mb-3 border-b border-white pb-2">
                       <span className="text-xs font-black text-primary uppercase tracking-wider flex items-center gap-2">
                         <User className="w-3 h-3" /> {owner || "Unassigned"}
                       </span>
                       <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${ownerLoad > 8 ? "bg-rose-500 text-white" : "bg-indigo-100 text-indigo-600"}`}>
                         {ownerLoad.toFixed(1)}h Daily Total
                       </span>
                    </div>
                    <div className="space-y-2">
                      {ownerTasks.map((t, idx) => (
                        <div key={idx} className="flex items-start justify-between gap-4">
                           <div className="min-w-0">
                             <p className="text-[11px] font-bold text-slate-700 truncate">{t.subject}</p>
                             <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{t.projectName || "Current Project"}</p>
                           </div>
                           <span className="text-[10px] font-mono text-slate-500 shrink-0">
                             {(t.durationHours / Math.max(1, countDays(t.startDate, t.endDate))).toFixed(1)}h
                           </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-8 py-6 bg-slate-50 border-t flex items-center justify-between">
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Daily Aggregated Load</span>
           <span className="text-xl font-black text-slate-800">{totalHours.toFixed(1)}h</span>
        </div>
      </div>
    </div>
  );
}

function countDays(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86400000) + 1);
}
