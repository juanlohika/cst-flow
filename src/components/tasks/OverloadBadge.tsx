"use client";

interface OverloadBadgeProps {
  level: "ok" | "warning" | "critical";
  plannedHours?: number;
  capacity?: number;
}

export default function OverloadBadge({ level, plannedHours, capacity }: OverloadBadgeProps) {
  if (level === "ok") return null;

  const label = plannedHours != null && capacity != null
    ? `${Math.round(plannedHours * 10) / 10}h / ${capacity}h`
    : level === "critical" ? "Overloaded" : "Near capacity";

  if (level === "critical") {
    return (
      <span
        title={`Overloaded today: ${label}`}
        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-600 border border-red-200 ml-1 shrink-0"
      >
        {label}
      </span>
    );
  }

  return (
    <span
      title={`Near capacity today: ${label}`}
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-200 ml-1 shrink-0"
    >
      {label}
    </span>
  );
}
