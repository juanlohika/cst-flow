"use client";

/**
 * QuotaMeter — visible monthly geocoding usage indicator.
 *
 * Polls /api/pin-validator/quota every 30 s while mounted so any CST team
 * member who has the AI Tools page open sees the meter advance in close to
 * real time. Color-coded:
 *   < 80%   green   — normal
 *   80-87.5% yellow — approaching limit
 *   >= 87.5% red    — final warning / exhausted
 *
 * Used in two places:
 *   • AI Tools landing page (full card with title + reset date)
 *   • Pin Validator account tab (compact variant via `compact` prop)
 */
import { useEffect, useState } from "react";

interface QuotaState {
  monthKey: string;
  used: number;
  limit: number;
  remaining: number;
  warning: boolean;
  exhausted: boolean;
  resetsAt: string;
}

export function QuotaMeter({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<QuotaState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/pin-validator/quota", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: QuotaState = await res.json();
        if (!cancelled) {
          setState(data);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load quota");
      } finally {
        if (!cancelled) timer = setTimeout(tick, 30_000);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (error) {
    return (
      <div className={shellClass(compact, "border-red-200 bg-red-50 text-red-700")}>
        Geocoding quota unavailable: {error}
      </div>
    );
  }
  if (!state) {
    return (
      <div className={shellClass(compact, "border-slate-200 bg-slate-50 text-slate-500")}>
        Loading geocoding quota…
      </div>
    );
  }

  const pct = Math.min(100, Math.round((state.used / state.limit) * 100));
  const tone = state.exhausted
    ? "red"
    : state.used / state.limit >= 0.875
    ? "red"
    : state.used / state.limit >= 0.8
    ? "yellow"
    : "green";
  const tones = TONE_CLASSES[tone];
  const resetDate = state.resetsAt.slice(0, 10);

  return (
    <div className={shellClass(compact, tones.outer)}>
      {!compact && (
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-sm font-semibold text-slate-700">
            📍 Pin Validator — Monthly geocoding quota
          </div>
          <div className={`text-xs font-medium ${tones.label}`}>
            {state.exhausted
              ? "Monthly limit reached"
              : tone === "red"
              ? "Near monthly limit"
              : tone === "yellow"
              ? "Approaching monthly limit"
              : "Quota normal"}
          </div>
        </div>
      )}
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`absolute inset-y-0 left-0 ${tones.bar} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-600">
        <span>
          <strong className="text-slate-900">{state.used.toLocaleString()}</strong>{" "}
          / {state.limit.toLocaleString()} ({pct}%)
        </span>
        <span className="text-slate-500">
          {state.exhausted
            ? `🛑 Resets ${resetDate}`
            : `Resets ${resetDate} · Free tier (Google Maps)`}
        </span>
      </div>
    </div>
  );
}

function shellClass(compact: boolean, color: string): string {
  const padding = compact ? "px-3 py-2" : "px-4 py-3";
  return `rounded-xl border ${padding} ${color}`;
}

const TONE_CLASSES = {
  green: {
    outer: "border-emerald-200 bg-emerald-50",
    bar: "bg-emerald-500",
    label: "text-emerald-700",
  },
  yellow: {
    outer: "border-amber-200 bg-amber-50",
    bar: "bg-amber-500",
    label: "text-amber-700",
  },
  red: {
    outer: "border-red-200 bg-red-50",
    bar: "bg-red-500",
    label: "text-red-700",
  },
} as const;
