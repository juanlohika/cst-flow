"use client";

import { useEffect, useState, useCallback } from "react";
import ForceLink from "@/components/ui/ForceLink";
import { useSearchParams } from "next/navigation";
import {
  Activity, Loader2, ArrowRight, AlertTriangle, Sparkles, Clock, Calendar,
  CheckCircle2, X,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import HealthChip from "@/components/accounts/HealthChip";
import type { HealthColor } from "@/lib/accounts/health-score";

interface AccountCard {
  accountId: string;
  companyName: string;
  industry: string;
  engagementStatus: string;
  health: { color: HealthColor; score: number; reasons: string[]; isCritical: boolean };
  lastAssessedAt: string | null;
  daysSince: number | null;
  campaign: { id: string; title: string; closesAt: string | null } | null;
}

interface QueueData {
  campaignPending: AccountCard[];
  neverAssessed: AccountCard[];
  stale: AccountCard[];
  recent: AccountCard[];
}

export default function AssessmentsQueuePage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const searchParams = useSearchParams();
  const submittedAccount = searchParams.get("submitted");

  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showToast, setShowToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/assessments/my-accounts");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (submittedAccount) {
      setShowToast(submittedAccount);
      const t = setTimeout(() => setShowToast(null), 6000);
      return () => clearTimeout(t);
    }
  }, [submittedAccount]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  const totalPending = (data?.campaignPending.length || 0) + (data?.neverAssessed.length || 0) + (data?.stale.length || 0);
  const hasAnyAccounts = (data?.campaignPending.length || 0) + (data?.neverAssessed.length || 0) + (data?.stale.length || 0) + (data?.recent.length || 0) > 0;

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-5 h-5 text-indigo-500" />
            <h1 className="text-[18px] font-black text-slate-900">My Account Assessments</h1>
          </div>
          <p className="text-[12px] text-slate-500">
            Accounts where you're the Primary RM. Keep their health snapshots fresh — the CEO's executive view depends on this data.
          </p>
        </div>
      </div>

      {/* Success toast */}
      {showToast && (
        <div className="max-w-4xl mx-auto px-6 pt-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-[12px] text-emerald-800 flex-1">
              <strong>{showToast}</strong> assessment submitted. AI summary is generating in the background.
            </p>
            <button onClick={() => setShowToast(null)} className="text-emerald-400 hover:text-emerald-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">

        {!hasAnyAccounts ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-[14px] font-bold text-slate-700 mb-1">No accounts assigned to you yet</p>
            <p className="text-[12px] text-slate-500 max-w-md mx-auto">
              An admin needs to tag you as Primary RM on at least one account. Go to any account's detail page → Access Control → star icon next to your name.
            </p>
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3 flex items-center gap-4 flex-wrap">
              <StatPill icon={<AlertTriangle className="w-3 h-3" />} count={data?.campaignPending.length || 0} label="campaign pending" tone="rose" />
              <StatPill icon={<Sparkles className="w-3 h-3" />} count={data?.neverAssessed.length || 0} label="never assessed" tone="indigo" />
              <StatPill icon={<Clock className="w-3 h-3" />} count={data?.stale.length || 0} label="stale (90+ days)" tone="amber" />
              <StatPill icon={<CheckCircle2 className="w-3 h-3" />} count={data?.recent.length || 0} label="recently assessed" tone="emerald" />
              {totalPending > 0 && (
                <div className="ml-auto text-[11px] font-bold text-slate-700">
                  <span className="text-rose-600">{totalPending}</span> need your attention
                </div>
              )}
            </div>

            {/* Campaign pending (highest priority) */}
            {data && data.campaignPending.length > 0 && (
              <Group
                title="Campaign assessments due"
                subtitle="Active campaign(s) from your team. Click to assess."
                accent="rose"
                cards={data.campaignPending}
                showDeadline
              />
            )}

            {/* Never assessed */}
            {data && data.neverAssessed.length > 0 && (
              <Group
                title="Never assessed"
                subtitle="Accounts you own that haven't had a health check yet."
                accent="indigo"
                cards={data.neverAssessed}
              />
            )}

            {/* Stale */}
            {data && data.stale.length > 0 && (
              <Group
                title="Stale (90+ days old)"
                subtitle="Refresh these to keep the CEO view current."
                accent="amber"
                cards={data.stale}
                showDaysSince
              />
            )}

            {/* Recent */}
            {data && data.recent.length > 0 && (
              <Group
                title="Recently assessed"
                subtitle="Update only if circumstances changed."
                accent="emerald"
                cards={data.recent}
                showLastAssessed
                collapsedByDefault
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatPill({ icon, count, label, tone }: { icon: React.ReactNode; count: number; label: string; tone: "rose" | "indigo" | "amber" | "emerald" }) {
  const palette: Record<string, string> = {
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${palette[tone]}`}>
      {icon}
      <span>{count} {label}</span>
    </span>
  );
}

function Group({
  title, subtitle, accent, cards, showDeadline, showDaysSince, showLastAssessed, collapsedByDefault,
}: {
  title: string; subtitle: string; accent: "rose" | "indigo" | "amber" | "emerald";
  cards: AccountCard[]; showDeadline?: boolean; showDaysSince?: boolean; showLastAssessed?: boolean;
  collapsedByDefault?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!!collapsedByDefault);
  const accentBorder: Record<string, string> = {
    rose: "border-rose-200",
    indigo: "border-indigo-200",
    amber: "border-amber-200",
    emerald: "border-emerald-200",
  };
  return (
    <section className={`bg-white border ${accentBorder[accent]} rounded-2xl overflow-hidden`}>
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[13px] font-black text-slate-900">{title} <span className="text-slate-400 font-bold">· {cards.length}</span></p>
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{collapsed ? "Expand" : "Collapse"}</span>
      </button>

      {!collapsed && (
        <ul className="divide-y divide-slate-100">
          {cards.map(card => (
            <AccountCardRow
              key={card.accountId}
              card={card}
              showDeadline={showDeadline}
              showDaysSince={showDaysSince}
              showLastAssessed={showLastAssessed}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountCardRow({
  card, showDeadline, showDaysSince, showLastAssessed,
}: {
  card: AccountCard; showDeadline?: boolean; showDaysSince?: boolean; showLastAssessed?: boolean;
}) {
  const deadline = card.campaign?.closesAt ? new Date(card.campaign.closesAt) : null;
  const urgent = deadline && (deadline.getTime() - Date.now()) < 3 * 24 * 60 * 60 * 1000;

  return (
    <li>
      <ForceLink
        href={`/assessments/${card.accountId}`}
        className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 group"
      >
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 text-slate-700 text-[14px] font-black flex items-center justify-center shrink-0">
          {card.companyName.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-[13px] text-slate-900 truncate group-hover:text-indigo-700">{card.companyName}</p>
            <HealthChip color={card.health.color} score={card.health.score} reasons={card.health.reasons} size="sm" />
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 flex-wrap">
            <span>{card.industry}</span>
            <span>·</span>
            <span>{card.engagementStatus}</span>
            {showDeadline && deadline && (
              <>
                <span>·</span>
                <span className={`inline-flex items-center gap-0.5 font-bold ${urgent ? "text-rose-600" : "text-amber-700"}`}>
                  {urgent && <AlertTriangle className="w-3 h-3" />}
                  <Calendar className="w-3 h-3" /> Due {deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </>
            )}
            {showDaysSince && card.daysSince !== null && (
              <>
                <span>·</span>
                <span className="text-amber-700 font-bold inline-flex items-center gap-0.5">
                  <Clock className="w-3 h-3" /> {card.daysSince} days ago
                </span>
              </>
            )}
            {showLastAssessed && card.lastAssessedAt && (
              <>
                <span>·</span>
                <span className="text-emerald-700 font-bold">Last: {new Date(card.lastAssessedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </>
            )}
            {card.campaign && showDeadline && (
              <>
                <span>·</span>
                <span className="text-slate-500 italic truncate">{card.campaign.title}</span>
              </>
            )}
          </div>
        </div>

        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-indigo-700 group-hover:gap-1.5 transition-all shrink-0">
          {card.lastAssessedAt ? "Update" : "Assess"} <ArrowRight className="w-3 h-3" />
        </span>
      </ForceLink>
    </li>
  );
}
