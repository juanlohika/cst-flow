"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { User, Clock, Plus, Trash2, Calendar, GripVertical, Briefcase, Lock, CheckCircle2, ChevronRight, ChevronDown, Timer } from "lucide-react";
import { calculateClientEndDate } from "@/lib/utils/business-days";

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
}: InteractiveGanttProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
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
  const ROW_HEIGHT = 60; 
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
    start.setDate(start.getDate() - 3); 
    const end = new Date(max);
    end.setDate(end.getDate() + 3);
    return { minDate: start, maxDate: end };
  }, [events]);

  const dates = useMemo(() => {
    const list: Date[] = [];
    let curr = new Date(minDate);
    while (curr <= maxDate) {
      list.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
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

  const isWeekend = (date: Date) => (date.getDay() === 0 || date.getDay() === 6);
  const isToday = (date: Date) => date.toDateString() === new Date().toDateString();

  const calculatePosition = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffStart = (start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    const diffEnd = (end.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24) + 1;
    const unitWidth = colWidth / dayStep;
    return { left: diffStart * unitWidth, width: Math.max(unitWidth, (diffEnd - diffStart) * unitWidth) };
  };

  const pixelToDays = (px: number) => px / (colWidth / dayStep);

  const addDays = (dateStr: string, days: number) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + Math.round(days));
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
        ev.externalPlannedEnd = calculateClientEndDate(ev.endDate, ev.paddingDays);
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
                 {dates.filter((_, idx) => idx % dayStep === 0).map((d, i) => (
                    <div key={i} style={{ width: "var(--col-width)" }} className={`border-r h-full flex items-center justify-center text-[9px] font-bold uppercase ${isToday(d) ? 'bg-primary/10 text-primary border-primary/20' : 'text-slate-400'} border-slate-100`}>
                      {scale === "day" ? d.getDate() : scale === "week" ? `Wk ${Math.ceil(d.getDate() / 7)}` : d.toLocaleDateString("en", { month: "short" })}
                    </div>
                 ))}
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
                      {selectionMode && !e.isSummary && (
                        <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10">
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${selectedIds?.has(e.id) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'}`}>
                            {selectedIds?.has(e.id) && <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                        </div>
                      )}
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
                                 onClick={(ev) => { ev.stopPropagation(); onUpdateBuffer(e.id, e.paddingDays || 0); }}
                                 className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-primary transition-all rounded hover:bg-primary/5 shadow-sm"
                                 title="Add/Edit Client Buffer"
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
                             top: e.isSummary ? '6px' : '10px',
                             bottom: e.isSummary ? '6px' : '10px'
                           }}
                           onMouseDown={(ev) => !e.isSummary && handleDragStart(index, "move", ev.clientX)}
                           className={`absolute bg-gradient-to-r ${getProjectGradient(e.projectName, e.id)} rounded-lg shadow-sm border border-black/5 flex flex-col justify-center px-4 text-white z-20 group/bar transition-all ${e.isSummary ? 'ring-2 ring-white/20' : (isCompleted ? 'opacity-100 shadow-md ring-1 ring-black/5' : 'opacity-80 cursor-move border-dashed hover:opacity-100')}`}
                        >
                           {!isCompleted && !e.isSummary && (
                             <>
                               <div className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize hover:bg-white/30 active:bg-white/50 z-30" onMouseDown={(ev) => { ev.stopPropagation(); handleDragStart(index, "left", ev.clientX); }} />
                               <div className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize hover:bg-white/30 active:bg-white/50 z-30" onMouseDown={(ev) => { ev.stopPropagation(); handleDragStart(index, "right", ev.clientX); }} />
                               
                               {/* TERMINAL BUFFER ICON */}
                               <button 
                                 onClick={(ev) => { ev.stopPropagation(); onUpdateBuffer?.(e.id, e.paddingDays || 0); }}
                                 className="absolute -right-5 top-1/2 -translate-y-1/2 w-5 h-5 bg-white shadow-lg rounded-full flex items-center justify-center opacity-0 group-hover/bar:opacity-100 hover:scale-110 transition-all z-40 text-primary border border-slate-100"
                                 title="Add Client Buffer"
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

                        {/* EXTERNAL PADDING BAR (ORANGE) - ONLY SHOW IF PADDING > 0 */}
                        {Boolean(e.paddingDays && e.paddingDays > 0 && e.externalPlannedEnd) && (
                          (() => {
                            const extPos = calculatePosition(e.endDate, e.externalPlannedEnd);
                            return (
                              <div 
                                onClick={(ev) => { ev.stopPropagation(); onUpdateBuffer?.(e.id, e.paddingDays || 0); }}
                                style={{ 
                                  left: `calc(${pos.left + pos.width}px - 4px)`, 
                                  width: `calc(${extPos.width}px + 4px)`
                                }}
                                className="absolute top-4 bottom-4 bg-orange-400/30 border border-orange-400/50 rounded-r-lg z-10 flex items-center justify-end px-2 cursor-pointer hover:bg-orange-400/50 transition-all group/buffer"
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
    </div>
  );
}
