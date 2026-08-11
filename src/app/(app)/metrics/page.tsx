"use client";

/**
 * CST employee scorecard.
 *
 * Only the Courtesy Calls block is computed from CST OS data today. The other
 * five areas of the manual sheet are shown with their real weights but marked
 * "not measured here yet" — deliberately NOT as zero, because a zero reads as a
 * failure when the truth is that the source still lives in the spreadsheet.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Phone, AlertCircle, ChevronRight, Upload } from "lucide-react";

type Period = {
  label: string; display: string; start: string; end: string;
  callDate: string | null; momSentDate: string | null;
  status: string; evidenceCount: number;
};
type AccountRow = {
  accountId: string; accountName: string; tier: string | null; cadence: string;
  planned: number; completed: number; compliant: number; score: number;
  periods: Period[];
};
type Payload = {
  user: { id: string; name: string | null; email: string | null };
  month: string;
  courtesyCalls: {
    accounts: AccountRow[];
    planned: number; completed: number; compliant: number;
    score: number; weight: number; weightedScore: number;
    excludedNoTier: string[];
  };
  unsourced: Array<{ area: string; metric: string; weight: number }>;
  totals: { sourcedWeight: number; declaredWeight: number; scoreOfSourced: number; weightedScore: number };
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pct2 = (n: number) => `${(n * 100).toFixed(2)}%`;

const STATUS_STYLE: Record<string, string> = {
  compliant:  "bg-green-50 text-green-700 border-green-200",
  late:       "bg-amber-50 text-amber-700 border-amber-200",
  incomplete: "bg-amber-50 text-amber-700 border-amber-200",
  missed:     "bg-red-50 text-red-600 border-red-200",
  pending:    "bg-slate-50 text-slate-600 border-slate-200",
};
const STATUS_TEXT: Record<string, string> = {
  compliant: "Compliant", late: "Late", incomplete: "MOM not sent",
  missed: "Missed", pending: "Due",
};

function monthShift(month: string, by: number) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function MetricsPage() {
  const { data: session } = useSession();
  const me = (session?.user as any)?.id as string | undefined;
  const isAdmin = (session?.user as any)?.role === "admin";

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [userId, setUserId] = useState<string | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; name: string | null }>>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState<{ url: string; tab: string } | null>(null);

  useEffect(() => { if (me && !userId) setUserId(me); }, [me, userId]);

  // Admins get a person picker; everyone else only ever sees themselves.
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/metrics/people")
      .then(r => (r.ok ? r.json() : { people: [] }))
      .then(d => setPeople((d.people || []).map((u: any) => ({
        id: u.id, name: `${u.name} (${u.accounts})`,
      }))))
      .catch(() => {});
  }, [isAdmin]);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true); setError(null);
    fetch(`/api/metrics/${userId}?month=${month}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || "Could not load metrics");
        return j;
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, month]);

  useEffect(load, [load]);

  const cc = data?.courtesyCalls;

  // Month-end often cannot wait for the weekly cron, so the same push is
  // available on demand. One-way by design: the Sheet is a report, not a source.
  const pushNow = async () => {
    if (!userId) return;
    setPushing(true); setPushed(null);
    try {
      const r = await fetch(`/api/metrics/${userId}/push?month=${month}`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setPushed({ url: j.sheetUrl, tab: j.tab });
      else setError(j?.error || "Push failed");
    } catch (e: any) { setError(e.message); }
    setPushing(false);
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-auto">
      <div className="px-6 py-4 border-b border-border-default flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold">Metrics</h1>
          <p className="text-[12px] text-text-secondary mt-0.5">
            {data?.user?.name || "—"} · {monthLabel(month)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && people.length > 0 && (
            <select value={userId || ""} onChange={e => setUserId(e.target.value)}
              className="border border-border-default rounded-md px-2 py-1.5 text-[13px] bg-white">
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={pushNow} disabled={pushing || !userId}
            className="flex items-center gap-1.5 border border-border-default rounded-md px-3 py-1.5 text-[13px] hover:bg-surface-muted disabled:opacity-40"
            title="Render this month into the Google Sheet">
            <Upload className="w-3.5 h-3.5" />
            {pushing ? "Pushing…" : "Push to Sheet"}
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth(m => monthShift(m, -1))}
              className="border border-border-default rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-muted">&larr;</button>
            <span className="text-[13px] px-2 min-w-[110px] text-center">{monthLabel(month)}</span>
            <button onClick={() => setMonth(m => monthShift(m, 1))}
              className="border border-border-default rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-muted">&rarr;</button>
          </div>
        </div>
      </div>

      {pushed && (
        <div className="mx-6 mt-4 border border-green-200 bg-green-50 rounded-lg px-4 py-2.5 text-[12px] text-green-900">
          Pushed to the <span className="font-medium">{pushed.tab}</span> tab.{" "}
          <a href={pushed.url} target="_blank" rel="noreferrer" className="underline">Open the Sheet &rarr;</a>
        </div>
      )}

      {loading ? (
        <div className="p-6 text-[13px] text-text-secondary">Loading…</div>
      ) : error ? (
        <div className="p-6 text-[13px] text-red-600">{error}</div>
      ) : !cc ? null : (
        <div className="p-6 max-w-[1150px] space-y-5">
          {/* Honest headline: score across what is actually measured. */}
          <div className="flex flex-wrap gap-3">
            <div className="border border-border-default rounded-lg px-4 py-3 bg-white min-w-[190px]">
              <div className="text-[10px] uppercase tracking-wide text-text-muted font-medium">Courtesy calls</div>
              <div className="text-[22px] font-semibold mt-0.5">{pct(cc.score)}</div>
              <div className="text-[11px] text-text-secondary">
                {cc.completed} of {cc.planned} periods · {cc.accounts.length} accounts
              </div>
            </div>
            <div className="border border-border-default rounded-lg px-4 py-3 bg-white min-w-[190px]">
              <div className="text-[10px] uppercase tracking-wide text-text-muted font-medium">Weighted contribution</div>
              <div className="text-[22px] font-semibold mt-0.5">{pct2(cc.weightedScore)}</div>
              <div className="text-[11px] text-text-secondary">of the {pct2(cc.weight)} this area is worth</div>
            </div>
            <div className="border border-border-default rounded-lg px-4 py-3 bg-white min-w-[190px]">
              <div className="text-[10px] uppercase tracking-wide text-text-muted font-medium">With minutes sent</div>
              <div className="text-[22px] font-semibold mt-0.5">{cc.compliant}</div>
              <div className="text-[11px] text-text-secondary">
                {cc.completed - cc.compliant > 0
                  ? `${cc.completed - cc.compliant} called but MOM not recorded`
                  : "every logged call has its minutes"}
              </div>
            </div>
          </div>

          {/* Coverage caveat — the page must not look like a full scorecard. */}
          <div className="border border-amber-200 bg-amber-50 rounded-lg px-4 py-3 flex gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="text-[12px] text-amber-900">
              <span className="font-medium">This is not the full scorecard yet.</span>{" "}
              Courtesy Calls ({pct2(data.totals.sourcedWeight)}) is the only area computed from CST OS.
              The remaining {pct2(data.totals.declaredWeight - data.totals.sourcedWeight)} still lives in the
              spreadsheet and is listed below without a score — blank rather than zero, because a zero
              would read as a failure instead of "not measured here".
            </div>
          </div>

          {/* Courtesy calls — the sheet's Account | Tier | Planned | Completed block */}
          <div className="border border-border-default rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border-default flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-primary" />
              <span className="text-[11px] uppercase tracking-wide text-text-muted font-medium">
                Courtesy calls · weight {pct2(cc.weight)}
              </span>
            </div>
            {cc.accounts.length === 0 ? (
              <div className="p-6 text-[13px] text-text-secondary">
                No accounts with a tier are assigned to this person as primary RM for {monthLabel(month)}.
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border-default">
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-4 py-2 font-medium">Tier</th>
                    <th className="px-4 py-2 font-medium">Cadence</th>
                    <th className="px-4 py-2 font-medium text-right">Planned</th>
                    <th className="px-4 py-2 font-medium text-right">Completed</th>
                    <th className="px-4 py-2 font-medium text-right">Score</th>
                    <th className="px-4 py-2 font-medium">Periods</th>
                  </tr>
                </thead>
                <tbody>
                  {cc.accounts.map(a => (
                    <React.Fragment key={a.accountId}>
                      <tr className="border-b border-border-default last:border-0">
                        <td className="px-4 py-2.5">
                          <button onClick={() => setOpen(o => (o === a.accountId ? null : a.accountId))}
                            className="flex items-center gap-1 hover:text-primary">
                            <ChevronRight className={`w-3 h-3 transition-transform ${open === a.accountId ? "rotate-90" : ""}`} />
                            {a.accountName}
                          </button>
                        </td>
                        <td className="px-4 py-2.5">{a.tier || "—"}</td>
                        <td className="px-4 py-2.5 text-text-secondary">{a.cadence}</td>
                        <td className="px-4 py-2.5 text-right">{a.planned}</td>
                        <td className="px-4 py-2.5 text-right">{a.completed}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${a.score === 1 ? "text-green-700" : a.score === 0 ? "text-red-600" : "text-amber-700"}`}>
                          {pct(a.score)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex gap-1">
                            {a.periods.map(p => (
                              <span key={p.label}
                                title={`${p.display} — ${STATUS_TEXT[p.status] || p.status}`}
                                className={`inline-block w-2.5 h-2.5 rounded-sm border ${STATUS_STYLE[p.status] || STATUS_STYLE.pending}`} />
                            ))}
                          </span>
                        </td>
                      </tr>
                      {open === a.accountId && (
                        <tr className="bg-surface-muted/40">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {a.periods.map(p => (
                                <div key={p.label} className="border border-border-default rounded-md bg-white px-3 py-2 min-w-[190px]">
                                  <div className="text-[12px] font-medium">{p.display}</div>
                                  <div className="text-[11px] text-text-muted">due by {p.end}</div>
                                  <div className="mt-1 flex items-center gap-2">
                                    <span className={`inline-block border rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[p.status] || STATUS_STYLE.pending}`}>
                                      {STATUS_TEXT[p.status] || p.status}
                                    </span>
                                    {p.evidenceCount > 0 && (
                                      <span className="text-[10px] text-text-secondary">{p.evidenceCount} file{p.evidenceCount === 1 ? "" : "s"}</span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-text-secondary mt-1">
                                    call {p.callDate || "—"} · MOM {p.momSentDate || "—"}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <a href={`/accounts?account=${a.accountId}&activeTab=courtesyCalls`}
                              className="inline-block mt-2 text-[12px] text-primary hover:underline">
                              Open this account's Courtesy Calls tab &rarr;
                            </a>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
            {cc.excludedNoTier.length > 0 && (
              <div className="px-4 py-2.5 border-t border-border-default text-[11px] text-text-secondary">
                {cc.excludedNoTier.length} assigned account{cc.excludedNoTier.length === 1 ? " has" : "s have"} no
                tier, so there is no target to score against and {cc.excludedNoTier.length === 1 ? "it is" : "they are"} excluded:{" "}
                {cc.excludedNoTier.slice(0, 6).join(", ")}
                {cc.excludedNoTier.length > 6 ? `, +${cc.excludedNoTier.length - 6} more` : ""}.
              </div>
            )}
          </div>

          {/* The areas still in the spreadsheet */}
          <div className="border border-border-default rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border-default text-[11px] uppercase tracking-wide text-text-muted font-medium">
              Still measured in the spreadsheet
            </div>
            <table className="w-full text-[13px]">
              <tbody>
                {data.unsourced.map(u => (
                  <tr key={u.metric} className="border-b border-border-default last:border-0">
                    <td className="px-4 py-2.5 text-text-secondary w-[240px]">{u.area}</td>
                    <td className="px-4 py-2.5">{u.metric}</td>
                    <td className="px-4 py-2.5 text-right w-[110px]">{pct2(u.weight)}</td>
                    <td className="px-4 py-2.5 text-right w-[150px] text-text-muted">not measured here</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
