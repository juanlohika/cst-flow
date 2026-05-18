"use client";

import { HEALTH_COLORS, type HealthColor } from "@/lib/accounts/health-score";

interface Props {
  color: HealthColor;
  score?: number;
  size?: "sm" | "md" | "lg";
  reasons?: string[];        // tooltip content
  showLabel?: boolean;
  showScore?: boolean;
}

/**
 * Compact health indicator. Use in account lists (size=sm), header strips
 * (size=lg), and queue rows (size=md).
 */
export default function HealthChip({
  color,
  score,
  size = "md",
  reasons,
  showLabel = true,
  showScore = true,
}: Props) {
  const palette = HEALTH_COLORS[color];

  const sizing = {
    sm: { dot: "w-2 h-2", text: "text-[9px]", padding: "px-1.5 py-0.5" },
    md: { dot: "w-2.5 h-2.5", text: "text-[10px]", padding: "px-2 py-1" },
    lg: { dot: "w-3 h-3", text: "text-[11px]", padding: "px-2.5 py-1.5" },
  }[size];

  const tooltip = reasons && reasons.length > 0 ? reasons.join(" · ") : undefined;

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1.5 ${sizing.padding} rounded-full border font-black uppercase tracking-widest ${sizing.text} ${palette.tailwindBg} ${palette.tailwindText} ${palette.tailwindBorder}`}
    >
      <span className={`${sizing.dot} rounded-full`} style={{ backgroundColor: palette.hex }} />
      {showLabel && <span>{palette.label}</span>}
      {showScore && typeof score === "number" && color !== "grey" && (
        <span className="opacity-70">{score}</span>
      )}
    </span>
  );
}
