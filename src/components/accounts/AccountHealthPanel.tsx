"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Activity, Loader2, Sparkles, Star, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, ChevronDown, ChevronUp, FileText, RotateCcw, Plus, X,
} from "lucide-react";
import { computeHealth, HEALTH_COLORS, type HealthColor } from "@/lib/accounts/health-score";
import HealthChip from "./HealthChip";

interface Assessment {
  id: string;
  submittedByUserId: string;
  submittedByName: string | null;
  submittedAt: string;
  satisfaction: number | null;
  ebaDecisionMaker: number | null;
  ebaDecisionMakerNote: string | null;
  ebaAdmin: number | null;
  ebaAdminNote: string | null;
  contactChangeRecent: boolean;
  contactChangeNote: string | null;
  isTarkieSsot: boolean | null;
  thirdPartySsot: string | null;
  v5Readiness: number | null;
  requestedModules: string[];
  aiSummary: string | null;
  aiRisks: string[];
  aiOpportunities: string[];
  notableRequests: string[];
  aiRollupStatus: "pending" | "ok" | "failed";
  aiRollupError: string | null;
  aiRollupAt: string | null;
  responsesJson: string | null;
}

interface Props {
  accountId: string;
}

export default function AccountHealthPanel({ accountId }: Props) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/assessments`);
      if (res.ok) {
        const data = await res.json();
        setAssessments(Array.isArray(data.assessments) ? data.assessments : []);
      }
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const regenerate = async (assId: string) => {
    setRegenerating(assId);
    try {
      const res = await fetch(`/api/accounts/${accountId}/assessments/${assId}/regenerate`, { method: "POST" });
      if (res.ok) {
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Failed to regenerate AI summary");
      }
    } finally {
      setRegenerating(null);
    }
  };

  const latest = assessments[0] || null;
  const history = assessments.slice(1);

  // Derive the color from the latest assessment, locally — same logic the API uses.
  const health = latest ? computeHealth({
    satisfaction: latest.satisfaction,
    ebaDecisionMaker: latest.ebaDecisionMaker,
    ebaAdmin: latest.ebaAdmin,
    v5Readiness: latest.v5Readiness,
    isTarkieSsot: latest.isTarkieSsot,
    thirdPartySsot: latest.thirdPartySsot,
    contactChangeRecent: latest.contactChangeRecent,
  }) : null;
  const palette = HEALTH_COLORS[health?.color || "grey"];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Top color stripe — driven by computed health */}
      <div className="h-1.5 w-full" style={{ backgroundColor: palette.hex }} />
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <Activity className="w-4 h-4 text-indigo-500" />
        <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
          Account Health
        </h3>
        {health && (
          <HealthChip color={health.color} score={health.score} reasons={health.reasons} size="md" />
        )}
        <div className="ml-auto flex items-center gap-2">
          {latest && (
            <span className="text-[10px] font-bold text-slate-400">
              Updated {formatDate(latest.submittedAt)}
              {latest.submittedByName ? ` · ${latest.submittedByName}` : ""}
            </span>
          )}
          <a
            href={`/assessments/${accountId}`}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100"
          >
            <Plus className="w-3 h-3" />
            {latest ? "Update" : "Start Assessment"}
          </a>
        </div>
      </div>

      {/* Critical reasons banner — when red and there are specific reasons */}
      {health?.isCritical && health.reasons.length > 0 && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-100 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Critical signals</p>
            <p className="text-[11px] text-rose-700 mt-0.5">{health.reasons.join(" · ")}</p>
          </div>
        </div>
      )}

      <div className="p-5 space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[11px] font-semibold">Loading…</span>
          </div>
        ) : !latest ? (
          <div className="text-center py-6">
            <Sparkles className="w-6 h-6 text-slate-300 mx-auto mb-2" />
            <p className="text-[12px] font-semibold text-slate-500 mb-1">No health assessment yet</p>
            <p className="text-[11px] text-slate-400 max-w-md mx-auto">
              Capture the RM's read on this account: EBA scores, SSOT status, V5 readiness, open requests. The AI rolls up a CEO-ready summary on submit.
            </p>
          </div>
        ) : (
          <LatestSnapshot a={latest} onRegenerate={regenerate} regeneratingId={regenerating} />
        )}

        {history.length > 0 && (
          <div className="pt-3 border-t border-slate-100">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700"
            >
              {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              History ({history.length})
            </button>
            {showHistory && (
              <div className="mt-3 space-y-2">
                {history.map(h => (
                  <HistoryRow key={h.id} a={h} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function LatestSnapshot({ a, onRegenerate, regeneratingId }: { a: Assessment; onRegenerate: (id: string) => void; regeneratingId: string | null }) {
  const isRegenerating = regeneratingId === a.id;
  return (
    <div className="space-y-4">
      {/* Top: scores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <ScoreCard label="Satisfaction" value={a.satisfaction} max={5} />
        <ScoreCard label="EBA — Decision Maker" value={a.ebaDecisionMaker} max={5} note={a.ebaDecisionMakerNote} />
        <ScoreCard label="EBA — Admin" value={a.ebaAdmin} max={5} note={a.ebaAdminNote} />
        <ScoreCard label="V5 Readiness" value={a.v5Readiness} max={5} />
      </div>

      {/* Middle row: SSOT + contact change */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <StatusCard
          label="System of Record"
          color={a.isTarkieSsot === true ? "emerald" : a.isTarkieSsot === false ? "amber" : "slate"}
          headline={a.isTarkieSsot === true ? "Tarkie is SSOT" : a.isTarkieSsot === false ? `Third-party SSOT${a.thirdPartySsot ? `: ${a.thirdPartySsot}` : ""}` : "Unknown"}
        />
        <StatusCard
          label="Recent contact change"
          color={a.contactChangeRecent ? "amber" : "slate"}
          headline={a.contactChangeRecent ? "Yes" : "No"}
          subtitle={a.contactChangeRecent ? (a.contactChangeNote || "") : ""}
        />
      </div>

      {/* AI block */}
      {a.aiRollupStatus === "pending" && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          AI summary generating… (usually 5-15 seconds)
        </div>
      )}
      {a.aiRollupStatus === "failed" && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[11px] text-rose-700">
          <p className="font-bold mb-1">AI rollup failed</p>
          {a.aiRollupError && <p className="text-rose-600 text-[10px]">{a.aiRollupError}</p>}
          <button
            onClick={() => onRegenerate(a.id)}
            disabled={isRegenerating}
            className="mt-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-rose-700 hover:text-rose-800 disabled:opacity-50"
          >
            {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            Retry
          </button>
        </div>
      )}
      {a.aiRollupStatus === "ok" && a.aiSummary && (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3 h-3 text-indigo-500" />
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">AI Summary</p>
            <button
              onClick={() => onRegenerate(a.id)}
              disabled={isRegenerating}
              title="Regenerate"
              className="ml-auto p-1 text-indigo-400 hover:text-indigo-700 disabled:opacity-50"
            >
              {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            </button>
          </div>
          <p className="text-[12px] text-slate-800 leading-relaxed">{a.aiSummary}</p>
        </div>
      )}

      {/* Risks + Opportunities */}
      {(a.aiRisks.length > 0 || a.aiOpportunities.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BulletList title="Risks" icon={<TrendingDown className="w-3 h-3" />} items={a.aiRisks} accent="rose" />
          <BulletList title="Opportunities" icon={<TrendingUp className="w-3 h-3" />} items={a.aiOpportunities} accent="emerald" />
        </div>
      )}

      {/* Notable requests */}
      {a.notableRequests.length > 0 && (
        <BulletList title="Notable requests" icon={<FileText className="w-3 h-3" />} items={a.notableRequests} accent="amber" />
      )}

      {/* Requested modules */}
      {a.requestedModules.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Modules requested</p>
          <div className="flex flex-wrap gap-1">
            {a.requestedModules.map(m => (
              <span key={m} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">{m}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ a }: { a: Assessment }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-100 hover:bg-slate-50">
      <p className="text-[10px] text-slate-400 font-mono w-28">{formatDate(a.submittedAt)}</p>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-slate-700 truncate">
          {a.submittedByName || "—"}
        </p>
        {a.aiSummary && <p className="text-[10px] text-slate-500 line-clamp-1">{a.aiSummary}</p>}
      </div>
      <div className="flex items-center gap-1 text-[9px] font-bold text-slate-500">
        <Score n={a.ebaDecisionMaker} label="DM" />
        <Score n={a.ebaAdmin} label="Adm" />
        <Score n={a.v5Readiness} label="V5" />
      </div>
    </div>
  );
}

function ScoreCard({ label, value, max, note }: { label: string; value: number | null; max: number; note?: string | null }) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-lg font-black text-slate-900">{value ?? "—"}</span>
        <span className="text-[10px] text-slate-400">/ {max}</span>
      </div>
      {note && <p className="text-[10px] text-slate-600 mt-1 italic line-clamp-2" title={note}>{note}</p>}
    </div>
  );
}

function StatusCard({ label, color, headline, subtitle }: { label: string; color: "emerald" | "amber" | "slate"; headline: string; subtitle?: string }) {
  const palette: any = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    slate: "bg-slate-50 border-slate-200 text-slate-700",
  };
  return (
    <div className={`border rounded-xl p-3 ${palette[color]}`}>
      <p className="text-[9px] font-black uppercase tracking-widest opacity-80">{label}</p>
      <p className="text-[12px] font-bold mt-0.5">{headline}</p>
      {subtitle && <p className="text-[10px] mt-1 opacity-80">{subtitle}</p>}
    </div>
  );
}

function BulletList({ title, icon, items, accent }: { title: string; icon: React.ReactNode; items: string[]; accent: "rose" | "emerald" | "amber" }) {
  if (items.length === 0) return null;
  const palette: any = {
    rose: "text-rose-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
  };
  return (
    <div>
      <p className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest mb-1.5 ${palette[accent]}`}>
        {icon} {title}
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] text-slate-700 flex gap-1.5">
            <span className={`shrink-0 ${palette[accent]}`}>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Score({ n, label }: { n: number | null; label: string }) {
  return (
    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[9px] font-black text-slate-600">
      {label} {n ?? "—"}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
