"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";

interface PendingItem {
  campaignId: string;
  campaignTitle: string;
  closesAt: string | null;
}

/**
 * Lightweight banner that polls /api/assessments/queue once on mount and
 * surfaces a callout if the current user has pending Health Assessments.
 * Drop into any page where RMs are likely to land (accounts list, dashboard).
 *
 * Renders nothing when there's no pending work — silent no-op.
 */
export default function AssessmentQueueBanner() {
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [earliestDeadline, setEarliestDeadline] = useState<string | null>(null);
  const [topCampaign, setTopCampaign] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/assessments/queue");
        if (!res.ok) return;
        const data = await res.json();
        const pending: PendingItem[] = data?.pending || [];
        setPendingCount(pending.length);
        if (pending.length > 0) {
          setTopCampaign(pending[0].campaignTitle);
          // Earliest deadline among pending
          const deadlines = pending.map(p => p.closesAt).filter(Boolean) as string[];
          if (deadlines.length > 0) {
            deadlines.sort();
            setEarliestDeadline(deadlines[0]);
          }
        }
      } catch { /* silent */ }
    })();
  }, []);

  if (pendingCount === 0) return null;

  const deadlineText = earliestDeadline
    ? `Earliest deadline: ${new Date(earliestDeadline).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
    : "";

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
            {pendingCount} pending Health Assessment{pendingCount === 1 ? "" : "s"}
          </p>
          <p className="text-[10px] text-indigo-700">
            {topCampaign}{pendingCount > 1 ? ` + ${pendingCount - 1} more` : ""}
            {deadlineText ? ` · ${deadlineText}` : ""}
          </p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-1 shrink-0">
          Open queue <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </Link>
  );
}
