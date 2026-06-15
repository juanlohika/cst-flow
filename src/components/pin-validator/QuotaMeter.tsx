"use client";

/**
 * QuotaMeter — visible monthly geocoding usage indicator.
 *
 * Fetch policy (event-driven, NOT polling):
 *   • Loads ONCE when the component mounts.
 *   • Exposes a `refreshKey` prop — bumping it via the parent re-fetches.
 *     Used by the AccountHub Pin Validator tab to refresh after a geocode
 *     batch completes.
 *   • Manual refresh button surfaces for any team member who wants the
 *     latest read.
 *
 * Why no polling: at our scale (~8 clients/month, intermittent geocoding)
 * the quota number changes in bursts. Periodic polling would burn DB
 * round-trips for a number that rarely moves. Event-driven refresh is
 * accurate without the overhead.
 *
 * Color tiers:
 *   < 80%       green   — normal
 *   80%-87.5%   yellow  — approaching limit
 *   >= 87.5%    red     — final warning / exhausted
 *
 * Used in:
 *   • AI Tools landing page (full card with title + reset date)
 *   • Pin Validator account tab (compact variant via `compact` prop)
 */
import { useCallback, useEffect, useState } from "react";

interface QuotaState {
  monthKey: string;
  used: number;
  limit: number;
  remaining: number;
  warning: boolean;
  exhausted: boolean;
  resetsAt: string;
}

interface Props {
  compact?: boolean;
  /** Bump this number to force a re-fetch (e.g. after a geocode batch). */
  refreshKey?: number;
}

export function QuotaMeter({ compact = false, refreshKey = 0 }: Props) {
  const [state, setState] = useState<QuotaState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNow = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/pin-validator/quota", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: QuotaState = await res.json();
      setState(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load quota");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Fetch once on mount AND whenever the parent bumps refreshKey.
  useEffect(() => {
    fetchNow();
  }, [fetchNow, refreshKey]);

  if (error) {
    return (
      <div className={shellClass(compact, "border-red-200 bg-red-50 text-red-700")}>
        <div className="flex items-center justify-between gap-2">
          <span>Geocoding quota unavailable: {error}</span>
          <button
            onClick={fetchNow}
            disabled={refreshing}
            className="text-xs underline disabled:opacity-50"
          >
            {refreshing ? "…" : "Retry"}
          </button>
        </div>
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
  const ratio = state.used / state.limit;
  const tone = state.exhausted ? "red" : ratio >= 0.875 ? "red" : ratio >= 0.8 ? "yellow" : "green";
  const tones = TONE_CLASSES[tone];
  const resetDate = state.resetsAt.slice(0, 10);

  return (
    <div className={shellClass(compact, tones.outer)}>
      {!compact && (
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-sm font-semibold text-slate-700">
            📍 Pin Validator — Monthly geocoding quota
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${tones.label}`}>
              {state.exhausted
                ? "Monthly limit reached"
                : tone === "red"
                ? "Near monthly limit"
                : tone === "yellow"
                ? "Approaching monthly limit"
                : "Quota normal"}
            </span>
            <button
              onClick={fetchNow}
              disabled={refreshing}
              className="text-[11px] text-slate-500 hover:text-slate-900 disabled:opacity-50"
              title="Refresh"
            >
              {refreshing ? "…" : "↻"}
            </button>
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
            : `Resets ${resetDate}`}
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
