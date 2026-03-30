"use client";

import { AlertTriangle, Wand2 } from "lucide-react";

interface ConflictInfo {
  taskId: string;
  conflictingTaskId: string;
  owner: string;
  overlapStart: string;
  overlapEnd: string;
}

interface ConflictWarningProps {
  conflicts: ConflictInfo[];
  taskOwner: string | null;
  taskDurationHours?: number;
  onAutoAdjust?: (suggestedStart: string, suggestedEnd: string) => void;
}

export default function ConflictWarning({
  conflicts,
  taskOwner,
  taskDurationHours = 8,
  onAutoAdjust,
}: ConflictWarningProps) {
  if (!conflicts || conflicts.length === 0) return null;

  async function handleAutoAdjust() {
    if (!onAutoAdjust || !taskOwner) return;
    try {
      const res = await fetch("/api/tasks/suggest-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: taskOwner,
          durationHours: taskDurationHours,
          afterDate: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        const { suggestedStart, suggestedEnd } = await res.json();
        onAutoAdjust(suggestedStart, suggestedEnd);
      }
    } catch {
      // silent
    }
  }

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className="mt-2 p-2.5 rounded-lg bg-orange-50 border border-orange-200 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={12} className="text-orange-500 shrink-0" />
        <span className="text-[10px] font-bold text-orange-700 uppercase tracking-wide">
          {conflicts.length} schedule conflict{conflicts.length > 1 ? "s" : ""} detected
        </span>
      </div>
      {conflicts.slice(0, 2).map((c, i) => (
        <p key={i} className="text-[10px] text-orange-600 ml-4">
          Overlaps {fmtTime(c.overlapStart)}–{fmtTime(c.overlapEnd)} with another task for{" "}
          <span className="font-bold">{c.owner}</span>
        </p>
      ))}
      {conflicts.length > 2 && (
        <p className="text-[10px] text-orange-500 ml-4">+{conflicts.length - 2} more</p>
      )}
      {onAutoAdjust && taskOwner && (
        <button
          type="button"
          onClick={handleAutoAdjust}
          className="ml-4 flex items-center gap-1 text-[10px] font-bold text-orange-700 hover:text-orange-900 underline underline-offset-2 transition-colors"
        >
          <Wand2 size={10} />
          Auto-Adjust to next free slot
        </button>
      )}
    </div>
  );
}
