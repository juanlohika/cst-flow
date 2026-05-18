"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Activity, Loader2, FileText, Download, Sparkles, AlertTriangle,
  TrendingUp, TrendingDown, ChevronRight, RotateCcw, Calendar, Sheet,
  ExternalLink,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import HealthChip from "@/components/accounts/HealthChip";
import { HEALTH_COLORS, type HealthColor } from "@/lib/accounts/health-score";

interface AccountSnap {
  accountId: string;
  companyName: string;
  industry: string;
  engagementStatus: string;
  primaryRmName: string | null;
  health: { color: HealthColor; score: number; reasons: string[]; isCritical: boolean };
  lastAssessedAt: string | null;
  aiSummary: string | null;
  topRisks: string[];
  topOpportunities: string[];
  notableRequests: string[];
  satisfaction: number | null;
  ebaDecisionMaker: number | null;
  ebaAdmin: number | null;
  v5Readiness: number | null;
  isTarkieSsot: boolean | null;
  thirdPartySsot: string | null;
  tier?: string | null;
  groupName?: string | null;
  rmEmail?: string | null;
  lastCourtesyCall?: string | null;
  frequencyLabel?: string;
  complianceStatus?: "compliant" | "warning" | "overdue" | "unknown";
  daysSinceCall?: number | null;
}

interface ColorCounts { green: number; yellow: number; red: number; grey: number; critical: number; }
interface ComplianceCounts { compliant: number; warning: number; overdue: number; unknown: number; }
interface TierBreakdownRow { tier: string; accountCount: number; health: ColorCounts; compliance: ComplianceCounts; avgScore: number | null; }
interface GroupBreakdownRow { groupName: string; accountCount: number; health: ColorCounts; compliance: ComplianceCounts; worstColor: HealthColor; rollupScore: number | null; members: string[]; }
interface RmBreakdownRow { rmEmail: string; rmName: string | null; accountCount: number; health: ColorCounts; compliance: ComplianceCounts; avgScore: number | null; }

interface Summary {
  generatedAt: string;
  totalAccounts: number;
  assessed: number;
  unassessed: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  greyCount: number;
  criticalCount: number;
  ebaDMDistribution: number[];
  ebaAdminDistribution: number[];
  v5Distribution: number[];
  ssotTarkie: number;
  ssotThirdParty: number;
  ssotUnknown: number;
  thirdPartyTools: Array<{ tool: string; count: number }>;
  topRequestedModules: Array<{ module: string; count: number }>;
  complianceCounts?: ComplianceCounts;
  byTier?: TierBreakdownRow[];
  byGroup?: GroupBreakdownRow[];
  byRm?: RmBreakdownRow[];
  accounts: AccountSnap[];
  aiPortfolioSummary?: string;
  aiTopRisks?: string[];
  aiTopOpportunities?: string[];
  aiClusteringError?: string;
}

export default function ExecutiveSummaryPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ docxUrl?: string; pdfUrl?: string; errors?: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sheetResult, setSheetResult] = useState<{ sheetUrl?: string; created?: boolean; error?: string } | null>(null);

  const load = useCallback(async (withAi = false) => {
    setLoading(true);
    try {
      const url = withAi ? "/api/admin/executive-summary?ai=1" : "/api/admin/executive-summary";
      const res = await fetch(url);
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAi = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/admin/executive-summary?ai=1");
      if (res.ok) setSummary(await res.json());
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    // First load without AI for fast paint, then trigger AI refresh
    (async () => {
      await load(false);
      await refreshAi();
    })();
    // eslint-disable-next-line
  }, [isAdmin]);

  const doExport = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch("/api/admin/executive-summary/export?format=both", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Export failed");
      } else {
        setExportResult({ docxUrl: data.docxUrl, pdfUrl: data.pdfUrl, errors: data.errors });
        if (data.pdfUrl) window.open(data.pdfUrl, "_blank");
      }
    } finally {
      setExporting(false);
    }
  };

  const syncSheet = async () => {
    setSyncing(true);
    setSheetResult(null);
    try {
      const res = await fetch("/api/admin/executive-summary/sync-sheet", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSheetResult({ error: data?.error || "Sync failed" });
      } else {
        setSheetResult({ sheetUrl: data.sheetUrl, created: data.created });
        if (data.sheetUrl) window.open(data.sheetUrl, "_blank");
      }
    } catch (e: any) {
      setSheetResult({ error: e?.message || "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  const resetCachedSheet = async () => {
    if (!confirm("Clear the cached Sheet ID? The next sync will create a fresh Sheet in your Dashboards folder. The old Sheet (if any) won't be deleted automatically — clean it up in Drive yourself.")) return;
    try {
      const res = await fetch("/api/admin/executive-summary/sync-sheet/reset", { method: "POST" });
      if (res.ok) {
        setSheetResult(null);
        alert("Cached Sheet ID cleared. Click Sync to Google Sheet to create a fresh one.");
      } else {
        alert("Failed to clear cached Sheet ID.");
      }
    } catch (e: any) {
      alert(e?.message || "Failed to clear cached Sheet ID.");
    }
  };

  if (!isAdmin) return <div className="max-w-3xl mx-auto p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-500" />
          <h1 className="text-lg font-black text-slate-900">Account Health · Executive Summary</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={loading || aiLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-black uppercase tracking-widest hover:border-indigo-300 disabled:opacity-50"
          >
            {(loading || aiLoading) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            Refresh
          </button>
          <button
            onClick={syncSheet}
            disabled={syncing || !summary}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-700 text-[11px] font-black uppercase tracking-widest hover:bg-emerald-50 disabled:opacity-50"
            title="Push the latest data to the live Google Sheet"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sheet className="w-3.5 h-3.5" />}
            Sync to Google Sheet
          </button>
          <button
            onClick={doExport}
            disabled={exporting || !summary}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export Word + PDF
          </button>
        </div>
      </div>

      {sheetResult && (
        sheetResult.error ? (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[11px] text-rose-700 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-bold">Sheet sync failed</p>
              <p className="mt-0.5">{sheetResult.error}</p>
              <p className="text-[10px] mt-1 opacity-80">Make sure GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID is set under <Link href="/admin/google-integration" className="underline">/admin/google-integration</Link> and the folder is shared with the service account as Editor.</p>
              <button
                onClick={resetCachedSheet}
                className="mt-2 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest bg-white border border-rose-300 text-rose-700 hover:bg-rose-100"
              >
                Reset cached Sheet ID
              </button>
              <p className="text-[10px] mt-1 opacity-60">Try if a previous failed sync left a stale ID pointing at the wrong Sheet.</p>
            </div>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-black text-emerald-700 uppercase tracking-widest">
              {sheetResult.created ? "Sheet created" : "Sheet updated"}
            </span>
            {sheetResult.sheetUrl && (
              <a href={sheetResult.sheetUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-emerald-800 hover:underline inline-flex items-center gap-1">
                Open Google Sheet <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <span className="text-[10px] text-emerald-600 ml-auto">Bookmark this URL — it stays the same on every sync.</span>
          </div>
        )
      )}

      {summary && (
        <p className="text-[11px] text-slate-500">
          Generated {new Date(summary.generatedAt).toLocaleString()} · {summary.totalAccounts} accounts in portfolio · {summary.assessed} assessed
        </p>
      )}

      {exportResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-black text-emerald-700 uppercase tracking-widest">Exported to Drive:</span>
          {exportResult.docxUrl && <a href={exportResult.docxUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-blue-700 hover:underline">Open Word →</a>}
          {exportResult.pdfUrl && <a href={exportResult.pdfUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-rose-700 hover:underline">Open PDF →</a>}
          {exportResult.errors && exportResult.errors.length > 0 && (
            <span className="text-[10px] text-rose-600 ml-auto">{exportResult.errors.join(" · ")}</span>
          )}
        </div>
      )}

      {loading && !summary ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : !summary ? null : (
        <>
          {/* AI portfolio summary */}
          {summary.aiPortfolioSummary && (
            <section className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Executive Summary</p>
                {aiLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-400 ml-auto" />}
              </div>
              <p className="text-[13px] text-slate-800 leading-relaxed">{summary.aiPortfolioSummary}</p>
            </section>
          )}
          {!summary.aiPortfolioSummary && aiLoading && (
            <section className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex items-center gap-2 text-[12px] text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating cross-portfolio AI summary…
            </section>
          )}
          {summary.aiClusteringError && (
            <section className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-[11px] text-rose-700">
              <strong>AI clustering failed:</strong> {summary.aiClusteringError}
              <button onClick={refreshAi} className="ml-3 underline">Retry</button>
            </section>
          )}

          {/* Portfolio counts */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CountCard color="red" label="Critical" count={summary.redCount} total={summary.totalAccounts} subtitle={summary.criticalCount > 0 ? `${summary.criticalCount} flagged` : undefined} />
            <CountCard color="yellow" label="Watch" count={summary.yellowCount} total={summary.totalAccounts} />
            <CountCard color="green" label="Healthy" count={summary.greenCount} total={summary.totalAccounts} />
            <CountCard color="grey" label="Unassessed" count={summary.greyCount} total={summary.totalAccounts} />
          </section>

          {/* Critical accounts */}
          {summary.redCount > 0 && (
            <section className="bg-white border border-rose-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-rose-100 bg-rose-50 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <h2 className="text-[13px] font-black text-rose-800">Accounts needing attention ({summary.redCount})</h2>
              </div>
              <ul className="divide-y divide-slate-100">
                {summary.accounts.filter(a => a.health.color === "red").map(a => (
                  <li key={a.accountId} className="px-5 py-3 hover:bg-rose-50">
                    <Link href={`/accounts/${a.accountId}`} className="flex items-start gap-3 group">
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-[13px] text-rose-900 group-hover:underline">{a.companyName}</p>
                        <p className="text-[10px] text-rose-700 mt-0.5">{a.health.reasons.join(" · ")}</p>
                        {a.aiSummary && <p className="text-[11px] text-slate-600 mt-1 italic">"{a.aiSummary}"</p>}
                      </div>
                      <span className="shrink-0 text-[10px] font-bold text-rose-700">{a.industry}{a.primaryRmName ? ` · ${a.primaryRmName}` : ""}</span>
                      <ChevronRight className="w-4 h-4 text-rose-300 group-hover:text-rose-600 shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* AI themes */}
          {(summary.aiTopRisks?.length || summary.aiTopOpportunities?.length) ? (
            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {summary.aiTopRisks && summary.aiTopRisks.length > 0 && (
                <ThemeList title="Top Risks" icon={<TrendingDown className="w-3.5 h-3.5" />} items={summary.aiTopRisks} accent="rose" />
              )}
              {summary.aiTopOpportunities && summary.aiTopOpportunities.length > 0 && (
                <ThemeList title="Top Opportunities" icon={<TrendingUp className="w-3.5 h-3.5" />} items={summary.aiTopOpportunities} accent="emerald" />
              )}
            </section>
          ) : null}

          {/* Distributions */}
          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
            <h2 className="text-[13px] font-black text-slate-800 mb-3">Score distributions</h2>
            <div className="space-y-3">
              <Distribution label="EBA — Decision Maker" dist={summary.ebaDMDistribution} />
              <Distribution label="EBA — Admin" dist={summary.ebaAdminDistribution} />
              <Distribution label="V5 Readiness" dist={summary.v5Distribution} />
            </div>
          </section>

          {/* SSOT */}
          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
            <h2 className="text-[13px] font-black text-slate-800 mb-3">System of Record</h2>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <Stat label="Tarkie is SSOT" value={summary.ssotTarkie} color="emerald" />
              <Stat label="Displaced" value={summary.ssotThirdParty} color="amber" />
              <Stat label="Unknown" value={summary.ssotUnknown} color="slate" />
            </div>
            {summary.thirdPartyTools.length > 0 && (
              <>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Tools displacing Tarkie</p>
                <div className="flex flex-wrap gap-1">
                  {summary.thirdPartyTools.map(t => (
                    <span key={t.tool} className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100">
                      {t.tool} <span className="opacity-70">{t.count}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Courtesy Call Compliance */}
          {summary.complianceCounts && (
            <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
              <h2 className="text-[13px] font-black text-slate-800 mb-3">Courtesy Call Compliance</h2>
              <p className="text-[11px] text-slate-500 mb-3">Based on each account's tier-derived call cadence vs the last courtesy call logged. Per-account override available on the account profile.</p>
              <div className="grid grid-cols-4 gap-2">
                <ComplianceStat label="Compliant" value={summary.complianceCounts.compliant} color="emerald" />
                <ComplianceStat label="Warning" value={summary.complianceCounts.warning} color="amber" />
                <ComplianceStat label="Overdue" value={summary.complianceCounts.overdue} color="rose" />
                <ComplianceStat label="Unknown" value={summary.complianceCounts.unknown} color="slate" />
              </div>
            </section>
          )}

          {/* By Tier */}
          {summary.byTier && summary.byTier.length > 0 && (
            <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="text-[13px] font-black text-slate-800">Health by Tier</h2>
              </div>
              <BreakdownTable
                rows={summary.byTier.map(r => ({
                  key: r.tier,
                  label: r.tier === "Unset" ? "Unset (no tier)" : (r.tier === "VIP" ? "VIP" : `Tier ${r.tier}`),
                  health: r.health,
                  compliance: r.compliance,
                  count: r.accountCount,
                  avgScore: r.avgScore,
                }))}
              />
            </section>
          )}

          {/* By RM */}
          {summary.byRm && summary.byRm.length > 0 && (
            <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="text-[13px] font-black text-slate-800">Health by Relationship Manager</h2>
              </div>
              <BreakdownTable
                rows={summary.byRm.map(r => ({
                  key: r.rmEmail,
                  label: r.rmName || r.rmEmail,
                  sublabel: r.rmName ? r.rmEmail : undefined,
                  health: r.health,
                  compliance: r.compliance,
                  count: r.accountCount,
                  avgScore: r.avgScore,
                }))}
              />
            </section>
          )}

          {/* By Group */}
          {summary.byGroup && summary.byGroup.length > 0 && (
            <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="text-[13px] font-black text-slate-800">Health by Group</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Accounts sharing a group name are aggregated as one parent unit. Group's color is its worst child color.</p>
              </div>
              <BreakdownTable
                rows={summary.byGroup.map(r => ({
                  key: r.groupName,
                  label: r.groupName,
                  sublabel: r.members.length > 0 ? `Members: ${r.members.join(", ")}${r.accountCount > r.members.length ? ` (+${r.accountCount - r.members.length} more)` : ""}` : undefined,
                  health: r.health,
                  compliance: r.compliance,
                  count: r.accountCount,
                  avgScore: r.rollupScore,
                }))}
              />
            </section>
          )}

          {/* Requested modules */}
          {summary.topRequestedModules.length > 0 && (
            <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
              <h2 className="text-[13px] font-black text-slate-800 mb-3">Top requested modules</h2>
              <div className="flex flex-wrap gap-1.5">
                {summary.topRequestedModules.map(m => (
                  <span key={m.module} className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-bold border border-blue-100">
                    {m.module} <span className="opacity-70">{m.count}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* All accounts table */}
          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h2 className="text-[13px] font-black text-slate-800">All accounts</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Account</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Industry</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Primary RM</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Health</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">EBA-DM</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">EBA-Adm</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">V5</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">SSOT</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {summary.accounts.map(a => (
                    <tr key={a.accountId} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <Link href={`/accounts/${a.accountId}`} className="font-bold text-slate-800 hover:text-indigo-600">{a.companyName}</Link>
                        {a.aiSummary && <p className="text-[10px] text-slate-500 line-clamp-1">{a.aiSummary}</p>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{a.industry}</td>
                      <td className="px-3 py-2 text-slate-600">{a.primaryRmName || "—"}</td>
                      <td className="px-3 py-2"><HealthChip color={a.health.color} score={a.health.score} reasons={a.health.reasons} size="sm" /></td>
                      <td className="px-3 py-2 text-slate-700">{a.ebaDecisionMaker ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{a.ebaAdmin ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-700">{a.v5Readiness ?? "—"}</td>
                      <td className="px-3 py-2">
                        {a.isTarkieSsot === true ? <span className="text-emerald-700 font-bold">Tarkie</span> :
                         a.isTarkieSsot === false ? <span className="text-amber-700">{a.thirdPartySsot || "Other"}</span> :
                         <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2"><ChevronRight className="w-3 h-3 text-slate-300" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function CountCard({ color, label, count, total, subtitle }: { color: HealthColor; label: string; count: number; total: number; subtitle?: string }) {
  const palette = HEALTH_COLORS[color];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`rounded-2xl border p-4 ${palette.tailwindBg} ${palette.tailwindBorder}`}>
      <p className={`text-[10px] font-black uppercase tracking-widest ${palette.tailwindText}`}>{label}</p>
      <p className={`text-3xl font-black mt-1 ${palette.tailwindText}`}>{count}</p>
      <p className={`text-[10px] mt-0.5 ${palette.tailwindText} opacity-70`}>{pct}% of portfolio{subtitle ? ` · ${subtitle}` : ""}</p>
    </div>
  );
}

function ThemeList({ title, icon, items, accent }: { title: string; icon: React.ReactNode; items: string[]; accent: "rose" | "emerald" }) {
  const palette = accent === "rose"
    ? "bg-rose-50 border-rose-200 text-rose-700"
    : "bg-emerald-50 border-emerald-200 text-emerald-700";
  return (
    <div className={`border rounded-2xl p-4 ${palette}`}>
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest mb-2">
        {icon} {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] text-slate-800 flex gap-1.5">
            <span className="shrink-0">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Distribution({ label, dist }: { label: string; dist: number[] }) {
  const total = dist.reduce((a, b) => a + b, 0);
  const max = Math.max(...dist, 1);
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <div className="flex items-end gap-1 h-16">
        {dist.map((count, i) => {
          const score = i + 1;
          const hue = score <= 2 ? "bg-rose-400" : score === 3 ? "bg-amber-400" : "bg-emerald-500";
          const heightPct = (count / max) * 100;
          return (
            <div key={score} className="flex-1 flex flex-col items-center justify-end">
              <p className="text-[9px] font-bold text-slate-500 mb-0.5">{count}</p>
              <div className={`w-full ${hue} rounded-t`} style={{ height: `${heightPct}%` }} />
              <p className="text-[9px] font-bold text-slate-400 mt-0.5">{score}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-slate-400 mt-1">{total} assessment{total === 1 ? "" : "s"}</p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "emerald" | "amber" | "slate" }) {
  const palette: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <div className={`border rounded-xl p-2.5 ${palette[color]}`}>
      <p className="text-[9px] font-black uppercase tracking-widest">{label}</p>
      <p className="text-lg font-black mt-0.5">{value}</p>
    </div>
  );
}

function ComplianceStat({ label, value, color }: { label: string; value: number; color: "emerald" | "amber" | "rose" | "slate" }) {
  const palette: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-50 text-slate-500 border-slate-200",
  };
  return (
    <div className={`border rounded-xl p-3 ${palette[color]}`}>
      <p className="text-[9px] font-black uppercase tracking-widest">{label}</p>
      <p className="text-xl font-black mt-1">{value}</p>
    </div>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  sublabel?: string;
  health: { green: number; yellow: number; red: number; grey: number; critical: number };
  compliance: { compliant: number; warning: number; overdue: number; unknown: number };
  count: number;
  avgScore: number | null;
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-50">
          <tr>
            <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Bucket</th>
            <th className="text-center px-2 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Accounts</th>
            <th className="text-center px-2 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Avg Score</th>
            <th className="text-center px-2 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest" colSpan={4}>Health</th>
            <th className="text-center px-2 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest" colSpan={4}>Compliance</th>
          </tr>
          <tr className="border-t border-slate-100 bg-slate-50/60">
            <th colSpan={3}></th>
            <th className="text-center px-1.5 py-1 font-bold text-emerald-700 text-[9px]">🟢</th>
            <th className="text-center px-1.5 py-1 font-bold text-amber-700 text-[9px]">🟡</th>
            <th className="text-center px-1.5 py-1 font-bold text-rose-700 text-[9px]">🔴</th>
            <th className="text-center px-1.5 py-1 font-bold text-slate-500 text-[9px]">⚪</th>
            <th className="text-center px-1.5 py-1 font-bold text-emerald-700 text-[9px]">✓</th>
            <th className="text-center px-1.5 py-1 font-bold text-amber-700 text-[9px]">⚠</th>
            <th className="text-center px-1.5 py-1 font-bold text-rose-700 text-[9px]">⌛</th>
            <th className="text-center px-1.5 py-1 font-bold text-slate-500 text-[9px]">?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2">
                <p className="font-bold text-slate-800">{r.label}</p>
                {r.sublabel && <p className="text-[10px] text-slate-500 mt-0.5">{r.sublabel}</p>}
              </td>
              <td className="px-2 py-2 text-center font-bold text-slate-700">{r.count}</td>
              <td className="px-2 py-2 text-center font-black text-slate-800">{r.avgScore !== null ? r.avgScore : "—"}</td>
              <td className="px-1.5 py-2 text-center text-emerald-700 font-bold">{r.health.green || ""}</td>
              <td className="px-1.5 py-2 text-center text-amber-700 font-bold">{r.health.yellow || ""}</td>
              <td className="px-1.5 py-2 text-center text-rose-700 font-bold">{r.health.red || ""}</td>
              <td className="px-1.5 py-2 text-center text-slate-500 font-bold">{r.health.grey || ""}</td>
              <td className="px-1.5 py-2 text-center text-emerald-700 font-bold">{r.compliance.compliant || ""}</td>
              <td className="px-1.5 py-2 text-center text-amber-700 font-bold">{r.compliance.warning || ""}</td>
              <td className="px-1.5 py-2 text-center text-rose-700 font-bold">{r.compliance.overdue || ""}</td>
              <td className="px-1.5 py-2 text-center text-slate-500 font-bold">{r.compliance.unknown || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
