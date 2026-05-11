"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Calendar, Shield, Loader2, Send, Play, RefreshCw, Plus, Trash2,
  CheckCircle2, XCircle, AlertTriangle, Clock, Pause, Building2, X,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface Rule {
  id: string;
  name: string;
  cadence: string;
  customIntervalDays: number | null;
  matchEngagementStatus: string | null;
  priority: number;
  enabled: boolean;
}

interface Schedule {
  id: string;
  clientProfileId: string;
  companyName: string;
  clientCode: string | null;
  cadence: string;
  customIntervalDays: number | null;
  preferredChannel: string;
  nextDueAt: string;
  lastSentAt: string | null;
  lastResponseAt: string | null;
  consecutiveNoResponse: number;
  status: string;
}

interface HistoryRow {
  id: string;
  clientProfileId: string;
  companyName: string | null;
  clientCode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  channel: string;
  status: string;
  messageContent: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  escalatedAt: string | null;
  errorMessage: string | null;
  scheduledAt: string;
}

export default function ArimaCheckInsPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  useBreadcrumbs([
    { label: "Admin", href: "/admin" },
    { label: "ARIMA Check-ins" },
  ]);

  const isAdmin = (session?.user as any)?.role === "admin";
  const [view, setView] = useState<"schedules" | "rules" | "history">("schedules");

  const [rules, setRules] = useState<Rule[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);
  const [selectedMsg, setSelectedMsg] = useState<HistoryRow | null>(null);
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRule, setNewRule] = useState({ name: "", cadence: "monthly", matchEngagementStatus: "" });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, h] = await Promise.all([
        fetch("/api/admin/arima-checkins/rules").then(r => r.ok ? r.json() : []),
        fetch("/api/admin/arima-checkins/schedules").then(r => r.ok ? r.json() : []),
        fetch("/api/admin/arima-checkins/history").then(r => r.ok ? r.json() : []),
      ]);
      setRules(r);
      setSchedules(s);
      setHistory(h);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchAll();
  }, [isAdmin, fetchAll]);

  const runNow = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/admin/arima-checkins/run", { method: "POST" });
      const data = await res.json();
      setRunResult(data);
      await fetchAll();
    } finally {
      setRunning(false);
    }
  };

  const updateRule = async (id: string, patch: Partial<Rule>) => {
    await fetch(`/api/admin/arima-checkins/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    fetchAll();
  };

  const deleteRule = async (id: string, name: string) => {
    if (!confirm(`Delete rule "${name}"?`)) return;
    await fetch(`/api/admin/arima-checkins/rules/${id}`, { method: "DELETE" });
    fetchAll();
  };

  const createRule = async () => {
    if (!newRule.name.trim()) return;
    await fetch("/api/admin/arima-checkins/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newRule,
        matchEngagementStatus: newRule.matchEngagementStatus || null,
      }),
    });
    setNewRule({ name: "", cadence: "monthly", matchEngagementStatus: "" });
    setShowAddRule(false);
    fetchAll();
  };

  const updateSchedule = async (id: string, patch: Partial<Schedule>) => {
    await fetch(`/api/admin/arima-checkins/schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    fetchAll();
  };

  const sendNow = async (clientProfileId: string) => {
    if (!confirm("Send a check-in to this client right now?")) return;
    const res = await fetch("/api/admin/arima-checkins/send-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientProfileId }),
    });
    const data = await res.json();
    if (res.ok) {
      alert(`Sent via ${data.channel}. Message:\n\n${data.text}`);
    } else {
      alert(`Failed: ${data.error}`);
    }
    fetchAll();
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-500">Admin only</p>
      </div>
    );
  }

  const formatTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString() : "—";
  const formatDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString() : "—";
  const dueIn = (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now();
    const days = Math.round(ms / 86400_000);
    if (ms <= 0) return { label: "Due now", className: "bg-rose-100 text-rose-700" };
    if (days <= 1) return { label: "Today/tomorrow", className: "bg-amber-100 text-amber-700" };
    if (days <= 7) return { label: `In ${days}d`, className: "bg-amber-50 text-amber-700" };
    return { label: `In ${days}d`, className: "bg-slate-100 text-slate-500" };
  };

  const statusBadge = (s: string) =>
    s === "sent" ? "bg-emerald-100 text-emerald-700"
    : s === "responded" ? "bg-emerald-100 text-emerald-700"
    : s === "escalated" ? "bg-amber-100 text-amber-700"
    : s === "failed" ? "bg-rose-100 text-rose-700"
    : "bg-slate-100 text-slate-500";

  const dueNowCount = schedules.filter(s => s.status === "active" && new Date(s.nextDueAt).getTime() <= Date.now()).length;
  const pausedCount = schedules.filter(s => s.status === "paused").length;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center shadow-md">
          <Calendar className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-black text-slate-800 tracking-tight">ARIMA Check-ins</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Schedule + run proactive client check-ins
          </p>
        </div>
        <button
          onClick={runNow}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-br from-rose-400 to-pink-500 text-white text-[11px] font-black uppercase tracking-widest shadow-md shadow-rose-500/30 hover:scale-[1.02] transition-transform disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Run due check-ins {dueNowCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[9px]">{dueNowCount}</span>}
        </button>
      </header>

      {/* Run result banner */}
      {runResult && (
        <div className={`p-4 rounded-2xl border text-[12px] ${
          runResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"
        }`}>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-black uppercase tracking-widest text-[10px] mb-1">
                {runResult.ok ? "Run complete" : "Run failed"}
              </p>
              {runResult.ok ? (
                <p>
                  Processed <strong>{runResult.processed}</strong> due schedule(s) ·
                  Sent <strong>{runResult.sent}</strong> · Escalated <strong>{runResult.escalated}</strong> ·
                  Failed <strong>{runResult.failed}</strong>
                </p>
              ) : (
                <p>{runResult.error}</p>
              )}
            </div>
            <button onClick={() => setRunResult(null)} className="text-slate-400 hover:text-slate-600">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-100/60 p-1 rounded-xl w-fit">
        <button
          onClick={() => setView("schedules")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
            view === "schedules" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Calendar className="w-3 h-3" />
          Schedules ({schedules.length})
        </button>
        <button
          onClick={() => setView("rules")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
            view === "rules" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <RefreshCw className="w-3 h-3" />
          Cadence rules ({rules.length})
        </button>
        <button
          onClick={() => setView("history")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
            view === "history" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Send className="w-3 h-3" />
          History ({history.length})
        </button>
      </div>

      {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}

      {/* SCHEDULES VIEW */}
      {view === "schedules" && !loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {schedules.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-400">No schedules yet.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Create at least one cadence rule (e.g. "Monthly for confirmed clients") to auto-create schedules.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Account</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cadence</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Channel</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Next due</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Last sent</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="text-right px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => {
                  const due = dueIn(s.nextDueAt);
                  return (
                    <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3 h-3 text-slate-300" />
                          <p className="text-[12px] font-bold text-slate-800 truncate">{s.companyName}</p>
                          {s.clientCode && (
                            <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                              {s.clientCode}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={s.cadence}
                          onChange={e => updateSchedule(s.id, { cadence: e.target.value })}
                          className="text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none"
                        >
                          <option value="weekly">Weekly</option>
                          <option value="biweekly">Bi-weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="custom">Custom</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={s.preferredChannel}
                          onChange={e => updateSchedule(s.id, { preferredChannel: e.target.value })}
                          className="text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none"
                        >
                          <option value="auto">Auto</option>
                          <option value="telegram">Telegram</option>
                          <option value="portal">Portal/Email</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${due.className}`}>
                          {due.label}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(s.nextDueAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[11px] text-slate-600">{formatDate(s.lastSentAt)}</p>
                        {s.consecutiveNoResponse > 0 && (
                          <p className="text-[9px] font-bold text-amber-600 mt-0.5">
                            {s.consecutiveNoResponse} no-response
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={s.status}
                          onChange={e => updateSchedule(s.id, { status: e.target.value })}
                          className="text-[10px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none"
                        >
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="stopped">Stopped</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => sendNow(s.clientProfileId)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-600"
                        >
                          <Send className="w-3 h-3" />
                          Send now
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* RULES VIEW */}
      {view === "rules" && !loading && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowAddRule(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700"
            >
              <Plus className="w-3 h-3" />
              Add rule
            </button>
          </div>

          {showAddRule && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest">New cadence rule</p>
                <button onClick={() => setShowAddRule(false)} className="text-slate-300 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                value={newRule.name}
                onChange={e => setNewRule({ ...newRule, name: e.target.value })}
                placeholder="Rule name (e.g. 'Confirmed accounts — monthly')"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newRule.cadence}
                  onChange={e => setNewRule({ ...newRule, cadence: e.target.value })}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 outline-none"
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
                <select
                  value={newRule.matchEngagementStatus}
                  onChange={e => setNewRule({ ...newRule, matchEngagementStatus: e.target.value })}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 outline-none"
                >
                  <option value="">Any engagement status</option>
                  <option value="confirmed">Confirmed only</option>
                  <option value="pilot">Pilot only</option>
                  <option value="exploratory">Exploratory only</option>
                </select>
              </div>
              <button
                onClick={createRule}
                disabled={!newRule.name.trim()}
                className="w-full px-3 py-2 rounded-xl bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-rose-600 disabled:opacity-50"
              >
                Create rule
              </button>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {rules.length === 0 ? (
              <div className="p-12 text-center">
                <RefreshCw className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-400">No cadence rules yet.</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Without rules, new clients won't auto-get a check-in schedule.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {rules.map(r => (
                  <div key={r.id} className="p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-800">{r.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {r.cadence} · {r.matchEngagementStatus ? `engagement = ${r.matchEngagementStatus}` : "any engagement"} · priority {r.priority}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Enabled</span>
                      <button
                        onClick={() => updateRule(r.id, { enabled: !r.enabled })}
                        className={`relative w-9 h-5 rounded-full transition-colors ${r.enabled ? "bg-emerald-500" : "bg-slate-200"}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-transform ${r.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </button>
                    </label>
                    <button
                      onClick={() => deleteRule(r.id, r.name)}
                      className="p-1.5 text-slate-300 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* HISTORY VIEW */}
      {view === "history" && !loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {history.length === 0 ? (
            <div className="p-12 text-center">
              <Send className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-400">No check-ins sent yet.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Click "Run due check-ins" or "Send now" on a schedule to test.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">When</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Account</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Channel</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/40 cursor-pointer" onClick={() => setSelectedMsg(h)}>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{formatTime(h.sentAt || h.scheduledAt)}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-700 truncate max-w-[200px]">
                      {h.companyName}{h.clientCode ? ` · ${h.clientCode}` : ""}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-600">
                      {h.contactName || (h.channel === "telegram" ? "Telegram group" : h.channel === "internal" ? "— (internal)" : "—")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                        {h.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusBadge(h.status)}`}>
                        {h.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Detail modal */}
      {selectedMsg && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setSelectedMsg(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[13px] font-black text-slate-800">Check-in detail</h3>
              <button onClick={() => setSelectedMsg(null)} className="text-slate-300 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Account</p>
                  <p className="text-[11px] text-slate-700">{selectedMsg.companyName}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Channel</p>
                  <p className="text-[11px] text-slate-700">{selectedMsg.channel}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Contact</p>
                  <p className="text-[11px] text-slate-700">{selectedMsg.contactName || "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                  <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusBadge(selectedMsg.status)}`}>
                    {selectedMsg.status}
                  </span>
                </div>
              </div>
              {selectedMsg.messageContent && (
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Message</p>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[12px] text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {selectedMsg.messageContent}
                  </div>
                </div>
              )}
              {selectedMsg.errorMessage && (
                <div>
                  <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-1">Error</p>
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{selectedMsg.errorMessage}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
