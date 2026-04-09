"use client";

// VERSION: 2.0.0-QUARTER-HOUR
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Clock } from "lucide-react";

interface StitchTimePickerProps {
  onSelect: (startTime: string, endTime: string) => void;
  defaultValue?: { start: string; end: string };
  value?: { start: string; end: string };
}

// Parse "HH:MM" or "H:MM" → float hours (e.g. "09:30" → 9.5)
function timeToFloat(t: string): number {
  const parts = (t || "").split(":");
  const h = parseInt(parts[0]) || 0;
  const m = parseInt(parts[1]) || 0;
  return h + m / 60;
}

// Snap to nearest 1-min increment (1/60th of an hour)
function snapM(h: number): number {
  return Math.round(h * 60) / 60;
}

// Float hours → zero-padded "HH:MM"
function toHHMM(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// Float hours → display string "9:30 AM"
function displayTime(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  const period = hours >= 12 ? "PM" : "AM";
  const dh = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${dh}:${String(mins).padStart(2, "0")} ${period}`;
}

// Float hours duration → "30m", "1h", "1h 30m"
function displayDuration(d: number): string {
  const totalMins = Math.round(d * 60);
  if (totalMins < 60) return `${totalMins}m`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const RANGE_START = 7;   // 7 AM
const RANGE_END = 22;    // 10 PM
const RANGE_SPAN = RANGE_END - RANGE_START; // 15 hours
const MIN_DURATION = 0.25; // 15 minutes

export default function StitchTimePicker({ onSelect, defaultValue, value }: StitchTimePickerProps) {
  const [startH, setStartH] = useState(() => {
    const v = (value?.start || defaultValue?.start) ? timeToFloat(value?.start || defaultValue?.start || "09:00") : 9;
    return snapM(Math.max(RANGE_START, Math.min(v, RANGE_END - MIN_DURATION)));
  });
  const [endH, setEndH] = useState(() => {
    const v = (value?.end || defaultValue?.end) ? timeToFloat(value?.end || defaultValue?.end || "17:00") : 17;
    return snapM(Math.max(RANGE_START + MIN_DURATION, Math.min(v, RANGE_END)));
  });

  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<"start" | "end" | "both" | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  // Sync internal state with props
  useEffect(() => {
    if (value?.start) {
      const v = timeToFloat(value.start);
      const snapped = snapM(v);
      if (Math.abs(snapped - startH) > 0.001) setStartH(snapped);
    }
    if (value?.end) {
      const v = timeToFloat(value.end);
      const snapped = snapM(v);
      if (Math.abs(snapped - endH) > 0.001) setEndH(snapped);
    }
  }, [value?.start, value?.end]);

  const xToHour = useCallback((x: number): number => {
    if (!trackRef.current) return RANGE_START;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return RANGE_START + pct * RANGE_SPAN;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const h = xToHour(e.clientX);

    if (isDragging === "start") {
      setStartH(Math.max(RANGE_START, Math.min(h, endH - MIN_DURATION)));
    } else if (isDragging === "end") {
      setEndH(Math.min(RANGE_END, Math.max(h, startH + MIN_DURATION)));
    } else if (isDragging === "both") {
      const duration = endH - startH;
      let ns = h - dragOffset;
      let ne = ns + duration;
      if (ns < RANGE_START) { ns = RANGE_START; ne = RANGE_START + duration; }
      if (ne > RANGE_END) { ne = RANGE_END; ns = RANGE_END - duration; }
      setStartH(ns);
      setEndH(ne);
    }
  }, [isDragging, startH, endH, dragOffset, xToHour]);

  const handleMouseUp = useCallback(() => setIsDragging(null), []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    // Only trigger onSelect if internal state changed due to dragging OR if props changed
    // But to prevent feedback loop, we can just always call it since parent will handle sync
    onSelect(toHHMM(snapM(startH)), toHHMM(snapM(endH)));
  }, [startH, endH, onSelect]);

  const startPct = ((startH - RANGE_START) / RANGE_SPAN) * 100;
  const endPct = ((endH - RANGE_START) / RANGE_SPAN) * 100;

  return (
    <div className="w-full bg-slate-50/50 p-2 rounded-2xl border border-slate-100 select-none">
      <div className="relative pt-2 pb-0 px-1">
        <div className="flex justify-between mb-1 text-[7px] font-black text-slate-300 uppercase tracking-widest px-1">
          <span>7 AM</span>
          <span>10 PM</span>
        </div>

        {/* Track */}
        <div ref={trackRef} className="h-3 w-full bg-slate-100 rounded-full relative overflow-hidden">
          {/* Hour tick marks */}
          {Array.from({ length: RANGE_SPAN + 1 }).map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-[1px] bg-slate-200/40"
              style={{ left: `${(i / RANGE_SPAN) * 100}%` }}
            />
          ))}
          {/* Selected range bar — draggable to shift both handles */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDragging("both");
              setDragOffset(xToHour(e.clientX) - startH);
            }}
            className="absolute inset-y-0 bg-primary/20 border-l border-r border-primary cursor-grab active:cursor-grabbing"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          />
        </div>

        {/* Start handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging("start"); }}
          className="absolute top-[16px] h-4 w-1 bg-primary rounded-full cursor-ew-resize hover:scale-125 transition-transform"
          style={{ left: `${startPct}%`, transform: "translateX(-50%)" }}
        />
        {/* End handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsDragging("end"); }}
          className="absolute top-[16px] h-4 w-1 bg-primary rounded-full cursor-ew-resize hover:scale-125 transition-transform"
          style={{ left: `${endPct}%`, transform: "translateX(-50%)" }}
        />
      </div>

      <div className="mt-1 flex items-center justify-between px-1">
        <p className="text-[9px] font-black text-slate-700 uppercase tracking-tight">
          {displayTime(snapM(startH))} — {displayTime(snapM(endH))}
        </p>
        <p className="text-[8px] font-black text-primary uppercase tracking-widest leading-none">
          {displayDuration(endH - startH)} Allotted
        </p>
      </div>
    </div>
  );
}
