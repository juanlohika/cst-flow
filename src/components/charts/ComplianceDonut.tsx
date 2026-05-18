"use client";

/**
 * Multi-segment donut chart for compliance / health distributions.
 * Each segment is a [label, value, color] triple. Renders a clean SVG donut
 * with a center value (defaults to total), a small legend below, and a
 * highlighted "primary" value in the center if specified.
 */
interface Segment {
  label: string;
  value: number;
  color: string;       // tailwind class OR hex
}

interface Props {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;        // small text above the big number
  centerValue?: string | number; // big number in center; defaults to total
  centerSubtext?: string;      // tiny text below the big number
  showLegend?: boolean;
}

export default function ComplianceDonut({
  segments,
  size = 200,
  thickness = 22,
  centerLabel,
  centerValue,
  centerSubtext,
  showLegend = true,
}: Props) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const center = size / 2;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Build cumulative offsets so segments stack around the circle
  let cumulative = 0;
  const renderedSegments = segments.map((seg, idx) => {
    const fraction = total > 0 ? seg.value / total : 0;
    const dashLength = fraction * circumference;
    const offset = -cumulative;
    cumulative += dashLength;
    return { seg, dashLength, offset, idx };
  });

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
          {/* Background ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="#f1f5f9"
            strokeWidth={thickness}
          />
          {/* Render each segment from largest cumulative offset to top */}
          {total > 0 && renderedSegments.map(({ seg, dashLength, offset, idx }) => (
            <circle
              key={idx}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${dashLength} ${circumference}`}
              strokeDashoffset={offset}
              className="transition-all duration-700 ease-out"
            />
          ))}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerLabel && (
            <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
              {centerLabel}
            </span>
          )}
          <span className="text-3xl font-black text-slate-900 leading-none mt-1">
            {centerValue ?? total}
          </span>
          {centerSubtext && (
            <span className="text-[10px] font-bold text-slate-500 mt-1.5">
              {centerSubtext}
            </span>
          )}
        </div>
      </div>

      {showLegend && (
        <div className="mt-4 w-full space-y-1.5">
          {segments.map((seg, i) => {
            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
            return (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-[11px] font-bold text-slate-700 truncate">{seg.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-black text-slate-900">{seg.value}</span>
                  <span className="text-[10px] text-slate-400 w-8 text-right">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
