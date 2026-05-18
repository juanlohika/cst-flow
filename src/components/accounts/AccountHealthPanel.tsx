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
  const [showForm, setShowForm] = useState(false);
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

  // Poll briefly after a new submission for the AI rollup status to flip
  const poll = useCallback(async () => {
    let attempts = 0;
    while (attempts < 12) { // up to ~60s
      await new Promise(r => setTimeout(r, 5000));
      const res = await fetch(`/api/accounts/${accountId}/assessments`);
      if (res.ok) {
        const data = await res.json();
        const latest = data?.assessments?.[0];
        setAssessments(data.assessments || []);
        if (latest && latest.aiRollupStatus !== "pending") return;
      }
      attempts++;
    }
  }, [accountId]);

  const handleSubmitted = async () => {
    setShowForm(false);
    await load();
    poll();
  };

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
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100"
          >
            <Plus className="w-3 h-3" />
            {latest ? "Update" : "Start Assessment"}
          </button>
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

      {showForm && (
        <AssessmentFormModal
          accountId={accountId}
          existing={latest}
          onClose={() => setShowForm(false)}
          onSubmitted={handleSubmitted}
        />
      )}
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

// ─── Assessment form modal ──────────────────────────────────────────────────
function AssessmentFormModal({
  accountId,
  existing,
  onClose,
  onSubmitted,
}: {
  accountId: string;
  existing: Assessment | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  // Pre-fill from latest if it exists (RM is updating)
  const [satisfaction, setSatisfaction] = useState<number | "">(existing?.satisfaction ?? "");
  const [ebaDM, setEbaDM] = useState<number | "">(existing?.ebaDecisionMaker ?? "");
  const [ebaDMNote, setEbaDMNote] = useState<string>(existing?.ebaDecisionMakerNote || "");
  const [ebaAdmin, setEbaAdmin] = useState<number | "">(existing?.ebaAdmin ?? "");
  const [ebaAdminNote, setEbaAdminNote] = useState<string>(existing?.ebaAdminNote || "");
  const [contactChange, setContactChange] = useState<boolean>(existing?.contactChangeRecent ?? false);
  const [contactChangeNote, setContactChangeNote] = useState<string>(existing?.contactChangeNote || "");
  const [isTarkieSsot, setIsTarkieSsot] = useState<"" | "yes" | "no">(existing?.isTarkieSsot === true ? "yes" : existing?.isTarkieSsot === false ? "no" : "");
  const [thirdPartySsot, setThirdPartySsot] = useState<string>(existing?.thirdPartySsot || "");
  const [v5Readiness, setV5Readiness] = useState<number | "">(existing?.v5Readiness ?? "");
  const [requestedModules, setRequestedModules] = useState<string>(existing?.requestedModules?.join(", ") || "");

  // Long-text answers — initialize from existing.responsesJson if present
  const initialResponses = existing?.responsesJson ? safeJson(existing.responsesJson, {}) : {};
  const [b1, setB1] = useState<string>(initialResponses.b1_overall_state || "");
  const [b2, setB2] = useState<string>(initialResponses.b2_whats_working || "");
  const [b3, setB3] = useState<string>(initialResponses.b3_gaps_pain_points || "");
  const [d3, setD3] = useState<string>(initialResponses.d3_why_not_ssot || "");
  const [e1, setE1] = useState<string>(initialResponses.e1_open_requests || "");
  const [e4, setE4] = useState<string>(initialResponses.e4_single_action || "");
  const [e5, setE5] = useState<string>(initialResponses.e5_other || "");

  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const responses: any = {};
      if (b1.trim()) responses.b1_overall_state = b1.trim();
      if (b2.trim()) responses.b2_whats_working = b2.trim();
      if (b3.trim()) responses.b3_gaps_pain_points = b3.trim();
      if (d3.trim() && isTarkieSsot === "no") responses.d3_why_not_ssot = d3.trim();
      if (e1.trim()) responses.e1_open_requests = e1.trim();
      if (e4.trim()) responses.e4_single_action = e4.trim();
      if (e5.trim()) responses.e5_other = e5.trim();

      const body: any = {
        satisfaction: satisfaction || null,
        ebaDecisionMaker: ebaDM || null,
        ebaDecisionMakerNote: ebaDMNote.trim() || null,
        ebaAdmin: ebaAdmin || null,
        ebaAdminNote: ebaAdminNote.trim() || null,
        contactChangeRecent: contactChange,
        contactChangeNote: contactChange ? (contactChangeNote.trim() || null) : null,
        isTarkieSsot: isTarkieSsot === "yes" ? true : isTarkieSsot === "no" ? false : null,
        thirdPartySsot: isTarkieSsot === "no" ? (thirdPartySsot.trim() || null) : null,
        v5Readiness: v5Readiness || null,
        requestedModules: requestedModules.split(/[,;]/).map(s => s.trim()).filter(Boolean),
        responses,
      };
      const res = await fetch(`/api/accounts/${accountId}/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Submit failed");
      } else {
        onSubmitted();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 sticky top-0 bg-white flex items-center gap-2 z-10">
          <Activity className="w-4 h-4 text-indigo-500" />
          <h3 className="text-[13px] font-black text-slate-900">Health Assessment</h3>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">~5 min</span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-indigo-50/40 border-b border-indigo-100 px-5 py-2.5">
          <p className="text-[11px] text-indigo-900">
            Capture your honest read on this account. The AI rolls this up into a CEO-facing summary on submit — accuracy matters more than length.
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* Section B — Account Health */}
          <Section title="Account Health" letter="B" accent="indigo">
            <LongText label="Overall, how would you describe the current state of this account?" value={b1} onChange={setB1} hint="2-3 sentences. Include both wins and concerns." />
            <LongText label="What is working well for this client on current Tarkie modules?" value={b2} onChange={setB2} />
            <LongText label="What gaps or pain points does the client repeatedly raise?" value={b3} onChange={setB3} />
            <Rating label="Overall satisfaction with Tarkie today" value={satisfaction} onChange={setSatisfaction} hint="1 = very dissatisfied · 5 = champion" />
          </Section>

          {/* Section C — Relationship Strength */}
          <Section title="Relationship Strength (EBA)" letter="C" accent="emerald">
            <p className="text-[10px] text-slate-500 -mt-1 mb-2">
              How strong is your Executive Business Alignment with the two key contacts?
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              <Rating label="EBA — Decision Maker" value={ebaDM} onChange={setEbaDM} hint="The person who signs off on contracts and budget" />
              <ShortText label="Describe the DM relationship" value={ebaDMNote} onChange={setEbaDMNote} placeholder="In 1-2 sentences" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              <Rating label="EBA — Admin / day-to-day" value={ebaAdmin} onChange={setEbaAdmin} hint="Your primary day-to-day contact" />
              <ShortText label="Describe the Admin relationship" value={ebaAdminNote} onChange={setEbaAdminNote} placeholder="In 1-2 sentences" />
            </div>
            <label className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 cursor-pointer hover:border-slate-200">
              <input type="checkbox" checked={contactChange} onChange={e => setContactChange(e.target.checked)} className="mt-0.5 rounded" />
              <div>
                <p className="text-[11px] font-bold text-slate-700">Leadership or admin contact change in the last 6 months?</p>
                <p className="text-[10px] text-slate-500">Check if a key contact joined/left/changed roles</p>
              </div>
            </label>
            {contactChange && (
              <ShortText label="What changed?" value={contactChangeNote} onChange={setContactChangeNote} placeholder="e.g. New CFO took over the relationship in March" />
            )}
          </Section>

          {/* Section D — SSOT */}
          <Section title="System of Record" letter="D" accent="amber">
            <div>
              <label className="text-[11.5px] font-bold text-slate-800 block mb-1.5">
                Is Tarkie the Single Source of Truth (SSOT) for this client's field operations data?
              </label>
              <p className="text-[10px] text-slate-500 mb-2">
                SSOT = where their team checks first for the latest field data, not a backup
              </p>
              <div className="flex items-center gap-2">
                <RadioOption checked={isTarkieSsot === "yes"} onChange={() => setIsTarkieSsot("yes")} label="Yes — Tarkie is SSOT" />
                <RadioOption checked={isTarkieSsot === "no"} onChange={() => setIsTarkieSsot("no")} label="No — third-party tool is SSOT" />
              </div>
            </div>
            {isTarkieSsot === "no" && (
              <div className="bg-amber-50/40 border border-amber-100 rounded-xl p-3 space-y-3">
                <ShortText label="Which third-party tool serves as their SSOT?" value={thirdPartySsot} onChange={setThirdPartySsot} placeholder="e.g. Salesforce, Hubspot, internal spreadsheet…" />
                <LongText label="Why is Tarkie not the SSOT, and what would it take to make it so?" value={d3} onChange={setD3} />
              </div>
            )}
          </Section>

          {/* Section E — Demand & V5 */}
          <Section title="Demand Signals & V5 Outlook" letter="E" accent="blue">
            <LongText label="What are the client's most notable open requests right now?" value={e1} onChange={setE1} hint="High-level themes, not a ticket list" />
            <ShortText label="Which Tarkie capabilities does this client most want to expand into?" value={requestedModules} onChange={setRequestedModules} placeholder="Attendance, Inventory, Audit Forms…" hint="Comma-separated" />
            <Rating label="How ready is this account for V5 in your judgement?" value={v5Readiness} onChange={setV5Readiness} hint="1 = not now · 5 = ready to migrate" />
            <LongText label="What single action from Tarkie would most strengthen this account in the next 90 days?" value={e4} onChange={setE4} />
            <LongText label="Anything else the CEO should know about this account?" value={e5} onChange={setE5} optional />
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 sticky bottom-0 bg-white flex items-center gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-[11px] font-black uppercase tracking-widest hover:border-rose-300">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Submit Assessment
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, letter, accent, children }: { title: string; letter?: string; accent?: "indigo" | "emerald" | "amber" | "blue"; children: React.ReactNode }) {
  const palette: Record<string, string> = {
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
  };
  const dotColor = accent ? palette[accent] : "bg-slate-400";
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
        {letter && (
          <span className={`w-5 h-5 rounded-full ${dotColor} text-white text-[10px] font-black flex items-center justify-center`}>{letter}</span>
        )}
        <h4 className="text-[12px] font-black text-slate-800 uppercase tracking-widest">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function ShortText({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div>
      <label className="text-[11.5px] font-bold text-slate-800 block mb-1">{label}</label>
      {hint && <p className="text-[10px] text-slate-500 -mt-0.5 mb-1">{hint}</p>}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[12px] text-slate-800 placeholder:text-slate-300 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
      />
    </div>
  );
}

function LongText({ label, value, onChange, optional, hint }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; hint?: string }) {
  return (
    <div>
      <label className="text-[11.5px] font-bold text-slate-800 block mb-1">
        {label}
        {optional && <span className="ml-1 text-[9px] font-bold text-slate-400 uppercase tracking-widest">(optional)</span>}
      </label>
      {hint && <p className="text-[10px] text-slate-500 -mt-0.5 mb-1">{hint}</p>}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-[12px] text-slate-800 placeholder:text-slate-300 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 resize-y leading-relaxed"
      />
    </div>
  );
}

function Rating({ label, value, onChange, hint }: { label: string; value: number | ""; onChange: (v: number | "") => void; hint?: string }) {
  return (
    <div>
      <label className="text-[11.5px] font-bold text-slate-800 block mb-1">{label}</label>
      {hint && <p className="text-[10px] text-slate-500 -mt-0.5 mb-1.5">{hint}</p>}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? "" : n)}
            className={`w-9 h-9 rounded-lg text-[13px] font-black border-2 transition-all ${value === n ? "bg-indigo-500 text-white border-indigo-500 shadow-md scale-110" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"}`}
          >
            {n}
          </button>
        ))}
        {value && (
          <button type="button" onClick={() => onChange("")} className="ml-1.5 text-[10px] font-bold text-slate-400 hover:text-rose-500 underline">
            clear
          </button>
        )}
      </div>
    </div>
  );
}

function RadioOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold ${checked ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"}`}
    >
      <span className={`w-3 h-3 rounded-full border ${checked ? "bg-indigo-500 border-indigo-500" : "border-slate-300"}`} />
      {label}
    </button>
  );
}

function safeJson(raw: string, fb: any): any {
  try { return JSON.parse(raw); } catch { return fb; }
}
