"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  BarChart3, Shield, Loader2, MessageSquare, ClipboardList, Calendar,
  Wrench, Users, Building2, RefreshCw, TrendingUp, AlertTriangle,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface Analytics {
  windowDays: number;
  generatedAt: string;
  conversations: { total: number; last30: number; last7: number; last1: number };
  messages: { last30: number; last7: number; last1: number };
  channelBreakdown: Array<{ channel: string; count: number }>;
  topClients: Array<{ clientProfileId: string; companyName: string; clientCode: string | null; messageCount: number }>;
  requests: {
    total: number;
    windowed: number;
    byStatus: Record<string, number>;
    byCategory: Array<{ category: string; count: number }>;
    openByPriority: Record<string, number>;
  };
  checkIns: {
    total: number;
    windowed: number;
    responded: number;
    responseRatePct: number;
    escalated: number;
  };
  tools: {
    callsInWindow: number;
    topTools: Array<{ name: string; count: number; failures: number }>;
    failureRatePct: number;
  };
  coverage: {
    totalClients: number;
    clientsWithTelegramBinding: number;
    clientsWithPortalContact: number;
    clientsWithBindingPct: number;
    clientsWithContactPct: number;
  };
  notifications: {
    summary: Array<{ channel: string; status: string; count: number }>;
  };
  dailyMessages: Array<{ day: string; count: number }>;
}

export default function ArimaAnalyticsPage() {
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
    { label: "ARIMA Analytics" },
  ]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/arima-analytics?days=${days}`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin, fetchData]);

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-500">Admin only</p>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  // Sparkline calculation
  const maxDaily = Math.max(1, ...data.dailyMessages.map(d => d.count));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center shadow-md">
          <BarChart3 className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-black text-slate-800 tracking-tight">ARIMA Analytics</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Conversation volume, requests, check-ins, tools, and coverage
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(parseInt(e.target.value, 10))}
            className="text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1.5 outline-none"
          >
            <option value="1">Last 24h</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <button
            onClick={fetchData}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Top KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<MessageSquare className="w-4 h-4" />} label="Conversations" value={data.conversations.last30} sub={`${data.conversations.total} all-time`} />
        <Kpi icon={<MessageSquare className="w-4 h-4" />} label="Messages" value={data.messages.last30} sub={`${data.messages.last7} this week`} />
        <Kpi icon={<ClipboardList className="w-4 h-4" />} label="Requests captured" value={data.requests.windowed} sub={`${data.requests.byStatus?.new || 0} open`} />
        <Kpi icon={<Calendar className="w-4 h-4" />} label="Check-ins sent" value={data.checkIns.windowed} sub={`${data.checkIns.responseRatePct}% response rate`} />
      </div>

      {/* Daily messages sparkline */}
      <Card title="Daily message volume (last 14 days)" icon={<TrendingUp className="w-4 h-4 text-slate-500" />}>
        {data.dailyMessages.length === 0 ? (
          <p className="text-[12px] text-slate-400 italic">No messages yet in the window.</p>
        ) : (
          <div className="flex items-end gap-1 h-24">
            {data.dailyMessages.map(d => {
              const h = Math.max(4, Math.round((d.count / maxDaily) * 92));
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.count} messages`}>
                  <div
                    style={{ height: `${h}px` }}
                    className="w-full bg-gradient-to-t from-rose-400 to-pink-300 rounded-t-sm"
                  />
                  <span className="text-[8px] font-bold text-slate-400">
                    {d.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Channel breakdown + Coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Conversations by channel" icon={<MessageSquare className="w-4 h-4 text-slate-500" />}>
          {data.channelBreakdown.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic">No conversations yet.</p>
          ) : (
            <div className="space-y-2">
              {data.channelBreakdown.map(c => {
                const total = data.channelBreakdown.reduce((s, x) => s + x.count, 0);
                const pct = total > 0 ? Math.round((c.count / total) * 100) : 0;
                return (
                  <div key={c.channel}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-bold text-slate-700">{c.channel}</span>
                      <span className="font-bold text-slate-500">{c.count} · {pct}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-rose-400 to-pink-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Channel coverage" icon={<Building2 className="w-4 h-4 text-slate-500" />}>
          <div className="space-y-2">
            <CoverageRow
              label="Total client accounts"
              count={data.coverage.totalClients}
            />
            <CoverageRow
              label="With Telegram binding"
              count={data.coverage.clientsWithTelegramBinding}
              pct={data.coverage.clientsWithBindingPct}
            />
            <CoverageRow
              label="With portal contact"
              count={data.coverage.clientsWithPortalContact}
              pct={data.coverage.clientsWithContactPct}
            />
          </div>
        </Card>
      </div>

      {/* Requests + Check-ins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Requests" icon={<ClipboardList className="w-4 h-4 text-slate-500" />}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <MiniStat label="Open" value={data.requests.byStatus?.new || 0} color="rose" />
            <MiniStat label="In progress" value={data.requests.byStatus?.["in-progress"] || 0} color="amber" />
            <MiniStat label="Done" value={data.requests.byStatus?.done || 0} color="emerald" />
            <MiniStat label="Archived" value={data.requests.byStatus?.archived || 0} color="slate" />
          </div>
          {data.requests.byCategory.length > 0 && (
            <>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">By category</p>
              <div className="space-y-1.5">
                {data.requests.byCategory.map(r => (
                  <div key={r.category} className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-700 capitalize">{r.category}</span>
                    <span className="font-bold text-slate-500">{r.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="Check-ins" icon={<Calendar className="w-4 h-4 text-slate-500" />}>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <MiniStat label="Sent" value={data.checkIns.windowed} color="rose" />
            <MiniStat label="Responded" value={data.checkIns.responded} color="emerald" />
            <MiniStat label="Escalated" value={data.checkIns.escalated} color="amber" />
          </div>
          <div className="bg-slate-50 rounded-xl p-3 text-center">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Response rate</p>
            <p className="text-3xl font-black text-slate-800">{data.checkIns.responseRatePct}<span className="text-base text-slate-400">%</span></p>
            <p className="text-[10px] text-slate-400 mt-1">
              {data.checkIns.responded} of {data.checkIns.windowed} replied
            </p>
          </div>
        </Card>
      </div>

      {/* Top clients + Top tools */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top clients by message volume" icon={<Building2 className="w-4 h-4 text-slate-500" />}>
          {data.topClients.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic">No client conversations in this window.</p>
          ) : (
            <div className="space-y-2">
              {data.topClients.map((c, i) => (
                <a
                  key={c.clientProfileId}
                  href={`/accounts/${c.clientProfileId}`}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <span className="text-[10px] font-black text-slate-300 w-5">#{i + 1}</span>
                  <span className="text-[12px] font-bold text-slate-700 flex-1 truncate">
                    {c.companyName}
                    {c.clientCode && <span className="ml-1 text-[9px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{c.clientCode}</span>}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500">{c.messageCount} msgs</span>
                </a>
              ))}
            </div>
          )}
        </Card>

        <Card title="Top tools used" icon={<Wrench className="w-4 h-4 text-slate-500" />}>
          {data.tools.topTools.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic">No tool calls in this window.</p>
          ) : (
            <>
              <div className="space-y-1.5 mb-3">
                {data.tools.topTools.map(t => (
                  <div key={t.name} className="flex items-center justify-between text-[11px]">
                    <code className="font-mono font-bold text-slate-700">{t.name}</code>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-500">{t.count}</span>
                      {t.failures > 0 && (
                        <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                          {t.failures} failed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {data.tools.failureRatePct > 0 && (
                <div className="bg-slate-50 rounded-xl p-2 flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  <p className="text-[10px] font-bold text-slate-600">
                    Tool failure rate: <span className="text-rose-600">{data.tools.failureRatePct}%</span>
                  </p>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Notifications summary */}
      {data.notifications.summary.length > 0 && (
        <Card title="Notifications dispatched" icon={<MessageSquare className="w-4 h-4 text-slate-500" />}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Channel</th>
                <th className="text-left py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="text-right py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Count</th>
              </tr>
            </thead>
            <tbody>
              {data.notifications.summary.map((n, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-2 text-[11px] font-bold text-slate-700">{n.channel}</td>
                  <td className="py-2 text-[11px] text-slate-600">{n.status}</td>
                  <td className="py-2 text-[11px] font-bold text-slate-700 text-right">{n.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-[10px] font-semibold text-slate-400 text-center">
        Generated {new Date(data.generatedAt).toLocaleString()} · Window: {data.windowDays} day(s)
      </p>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        {icon}
        <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center gap-1.5 mb-2 text-slate-400">
        {icon}
        <p className="text-[9px] font-black uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-2xl font-black text-slate-800">{value.toLocaleString()}</p>
      {sub && <p className="text-[10px] font-bold text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: "rose" | "emerald" | "amber" | "slate" }) {
  const colorClass =
    color === "rose" ? "bg-rose-50 text-rose-700"
    : color === "emerald" ? "bg-emerald-50 text-emerald-700"
    : color === "amber" ? "bg-amber-50 text-amber-700"
    : "bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-xl p-3 ${colorClass}`}>
      <p className="text-[9px] font-black uppercase tracking-widest opacity-60">{label}</p>
      <p className="text-lg font-black mt-0.5">{value}</p>
    </div>
  );
}

function CoverageRow({ label, count, pct }: { label: string; count: number; pct?: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="font-bold text-slate-700">{label}</span>
        <span className="font-bold text-slate-500">
          {count}{pct !== undefined ? ` · ${pct}%` : ""}
        </span>
      </div>
      {pct !== undefined && (
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-rose-400 to-pink-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
