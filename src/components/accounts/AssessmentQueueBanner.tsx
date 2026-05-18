"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";

/**
 * Lightweight banner showing the current user's pending assessment work.
 * Counts: campaign-pending + never-assessed + stale (90+ days).
 * Renders nothing when there's no pending work.
 *
 * Mounted on the accounts list page so RMs see it whenever they're navigating
 * the account inventory.
 */
export default function AssessmentQueueBanner() {
  const [counts, setCounts] = useState<{ campaign: number; neverAssessed: number; stale: number }>({ campaign: 0, neverAssessed: 0, stale: 0 });
  const [earliestDeadline, setEarliestDeadline] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/assessments/my-accounts");
        if (!res.ok) return;
        const data = await res.json();
        setCounts({
          campaign: data?.campaignPending?.length || 0,
          neverAssessed: data?.neverAssessed?.length || 0,
          stale: data?.stale?.length || 0,
        });
        const deadlines = (data?.campaignPending || [])
          .map((c: any) => c?.campaign?.closesAt)
          .filter(Boolean)
          .sort();
        if (deadlines.length > 0) setEarliestDeadline(deadlines[0]);
      } catch { /* silent */ }
    })();
  }, []);

  const total = counts.campaign + counts.neverAssessed + counts.stale;
  if (total === 0) return null;

  const bits: string[] = [];
  if (counts.campaign > 0) bits.push(`${counts.campaign} campaign`);
  if (counts.neverAssessed > 0) bits.push(`${counts.neverAssessed} never assessed`);
  if (counts.stale > 0) bits.push(`${counts.stale} stale`);
  const subline = bits.join(" · ");

  return (
    <Link
      href="/assessments"
      className="block bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl px-4 py-3 hover:from-indigo-100 hover:to-blue-100 transition-colors group"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
          <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-black text-indigo-900">
            {total} account{total === 1 ? "" : "s"} need{total === 1 ? "s" : ""} a Health Assessment
          </p>
          <p className="text-[10px] text-indigo-700">
            {subline}
            {earliestDeadline ? ` · Earliest deadline ${new Date(earliestDeadline).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : ""}
          </p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-1 shrink-0">
          Open queue <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </Link>
  );
}
