"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Bug, Loader2, AlertTriangle, RefreshCw, ChevronRight, X,
  CheckCircle2, XCircle, Clock, Wrench, FileText, MessagesSquare,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface RunLog {
  id: string;
  conversationId: string;
  agentMode: string;
  senderName: string | null;
  senderChannel: string | null;
  clientProfileId: string | null;
  userMessage: string;
  modelCalled: boolean;
  skipReason: string | null;
  finalReply: string | null;
  functionCalls: Array<{ name: string; args: any }>;
  brdEmitted: boolean;
  requestEmitted: boolean;
  capturedRequestId: string | null;
  provider: string | null;
  durationMs: number | null;
  toolIterations: number;
  createdAt: string;
}

interface RunLogDetail extends RunLog {
  systemPrompt: string | null;
  rawModelOutput: string | null;
  toolResults: Array<{ name: string; ok: boolean; summary?: string; data?: any; error?: string }>;
  errorMessage: string | null;
}

export default function ArimaDebugPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";
  useBreadcrumbs([
    { label: "Admin", href: "/admin" },
    { label: "ARIMA / Eliana Debug" },
  ]);

  const [logs, setLogs] = useState<RunLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RunLogDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/arima-runlogs?limit=100");
      if (res.ok) setLogs(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    const res = await fetch(`/api/admin/arima-runlogs/${id}`);
    if (res.ok) setSelected(await res.json());
  };

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-700">Admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex flex-col h-full bg-surface-subtle">
        <div className="px-6 pt-6 pb-2 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-md">
              <Bug className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight">ARIMA / Eliana Debug</h1>
              <p className="text-[11px] font-semibold text-slate-500">Raw model I/O per turn. Use this to see exactly what the agent received + produced.</p>
            </div>
            <button
              onClick={load}
              className="ml-auto flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-slate-700 uppercase tracking-widest"
              title="Refresh"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
            <Stat label="Total turns" value={logs.length} />
            <Stat label="Eliana" value={logs.filter(l => l.agentMode === "eliana").length} />
            <Stat label="ARIMA" value={logs.filter(l => l.agentMode === "arima").length} />
            <Stat label="BRDs emitted" value={logs.filter(l => l.brdEmitted).length} highlight="emerald" />
            <Stat label="Requests emitted" value={logs.filter(l => l.requestEmitted).length} highlight="blue" />
            <Stat label="Skipped (silent)" value={logs.filter(l => !l.modelCalled).length} highlight="slate" />
            <Stat label="With tool calls" value={logs.filter(l => l.functionCalls && l.functionCalls.length > 0).length} highlight="indigo" />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6 max-w-6xl mx-auto w-full">
          {loading && <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>}
          {!loading && logs.length === 0 && (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-8 text-center mt-4">
              <p className="text-[13px] font-bold text-slate-700 mb-1">No runs logged yet</p>
              <p className="text-[11px] text-slate-500">Have a conversation with ARIMA or Eliana in Telegram/portal, then refresh.</p>
            </div>
          )}
          {!loading && logs.length > 0 && (
            <div className="space-y-2 mt-3">
              {logs.map(l => (
                <button
                  key={l.id}
                  onClick={() => openDetail(l.id)}
                  className="w-full text-left bg-white border border-slate-100 rounded-xl p-3 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      l.agentMode === "eliana" ? "bg-indigo-50" : "bg-rose-50"
                    }`}>
                      <MessagesSquare className={`w-4 h-4 ${l.agentMode === "eliana" ? "text-indigo-600" : "text-rose-600"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                          l.agentMode === "eliana" ? "bg-indigo-50 text-indigo-600" : "bg-rose-50 text-rose-600"
                        }`}>{l.agentMode}</span>
                        {l.senderName && <span className="text-[10px] text-slate-500">{l.senderName}</span>}
                        {l.senderChannel && <span className="text-[9px] text-slate-400">· {l.senderChannel}</span>}
                        {!l.modelCalled && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">silent</span>}
                        {l.brdEmitted && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">BRD emitted</span>}
                        {l.requestEmitted && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">Request emitted</span>}
                        {l.functionCalls && l.functionCalls.length > 0 && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">
                            <Wrench className="w-2.5 h-2.5 inline mr-0.5" />
                            {l.functionCalls.length} tool{l.functionCalls.length > 1 ? "s" : ""}
                          </span>
                        )}
                        {l.capturedRequestId && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">DB row saved</span>}
                      </div>
                      <p className="text-[12px] font-semibold text-slate-700 truncate">"{l.userMessage.slice(0, 140)}"</p>
                      {l.finalReply && (
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">→ {l.finalReply.slice(0, 160)}</p>
                      )}
                      {l.skipReason && (
                        <p className="text-[10px] text-slate-400 mt-0.5">Skipped: {l.skipReason}</p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">
                        {new Date(l.createdAt).toLocaleString()}
                        {l.durationMs ? ` · ${l.durationMs}ms` : ""}
                        {l.toolIterations ? ` · ${l.toolIterations} iter` : ""}
                        {l.provider ? ` · ${l.provider}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && <DetailModal log={selected} onClose={() => setSelected(null)} />}
      </div>
    </AuthGuard>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: string }) {
  const color = highlight === "emerald" ? "text-emerald-600 bg-emerald-50" :
    highlight === "blue" ? "text-blue-600 bg-blue-50" :
    highlight === "indigo" ? "text-indigo-600 bg-indigo-50" :
    highlight === "slate" ? "text-slate-500 bg-slate-100" :
    "text-slate-700 bg-slate-100";
  return (
    <div className="flex items-center gap-1">
      <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${color}`}>{value}</span>
      <span>{label}</span>
    </div>
  );
}

function DetailModal({ log, onClose }: { log: RunLogDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-[14px] font-black text-slate-900">Run Log Detail</h2>
            <p className="text-[11px] text-slate-500">
              {new Date(log.createdAt).toLocaleString()}
              {log.durationMs ? ` · ${log.durationMs}ms` : ""}
              {log.provider ? ` · ${log.provider}` : ""}
              {` · agent: ${log.agentMode}`}
              {log.senderName ? ` · sender: ${log.senderName}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>

        <Section title="User message">
          <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[11.5px] whitespace-pre-wrap font-mono text-slate-700">{log.userMessage}</pre>
        </Section>

        {!log.modelCalled && (
          <Section title="Why we didn't reply">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11.5px] text-amber-800">{log.skipReason || "(no reason recorded)"}</div>
          </Section>
        )}

        {log.systemPrompt && (
          <Section title="System prompt (truncated to 64KB)">
            <details>
              <summary className="cursor-pointer text-[11px] font-bold text-slate-500 mb-1">Click to expand (length: {log.systemPrompt.length} chars)</summary>
              <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[11px] whitespace-pre-wrap font-mono text-slate-700 max-h-96 overflow-auto">{log.systemPrompt}</pre>
            </details>
          </Section>
        )}

        {log.rawModelOutput && (
          <Section title="RAW model output (before scrubbing)">
            <pre className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-[11.5px] whitespace-pre-wrap font-mono text-slate-800 max-h-96 overflow-auto">{log.rawModelOutput}</pre>
          </Section>
        )}

        {log.finalReply && (
          <Section title="Final reply (what the user actually saw)">
            <pre className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-[11.5px] whitespace-pre-wrap font-mono text-slate-800 max-h-96 overflow-auto">{log.finalReply}</pre>
          </Section>
        )}

        {log.functionCalls && log.functionCalls.length > 0 && (
          <Section title={`Function calls (${log.functionCalls.length})`}>
            <div className="space-y-2">
              {log.functionCalls.map((fc, i) => (
                <div key={i} className="bg-indigo-50 border border-indigo-100 rounded-lg p-2">
                  <p className="text-[11px] font-black text-indigo-700 mb-1">{fc.name}</p>
                  <pre className="text-[10.5px] text-slate-600 whitespace-pre-wrap font-mono">{JSON.stringify(fc.args, null, 2)}</pre>
                </div>
              ))}
            </div>
          </Section>
        )}

        {log.toolResults && log.toolResults.length > 0 && (
          <Section title={`Tool results (${log.toolResults.length})`}>
            <div className="space-y-2">
              {log.toolResults.map((r, i) => (
                <div key={i} className={`border rounded-lg p-2 ${r.ok ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-rose-600" />}
                    <p className="text-[11px] font-black text-slate-700">{r.name}</p>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${r.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{r.ok ? "OK" : "FAIL"}</span>
                  </div>
                  {r.summary && <p className="text-[11px] text-slate-600 italic mb-1">{r.summary}</p>}
                  {r.error && <p className="text-[11px] text-rose-700">{r.error}</p>}
                  {r.data && <pre className="text-[10.5px] text-slate-600 whitespace-pre-wrap font-mono">{JSON.stringify(r.data, null, 2)}</pre>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {log.errorMessage && (
          <Section title="Error">
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-[11.5px] text-rose-800">{log.errorMessage}</div>
          </Section>
        )}

        <div className="text-[10px] text-slate-400 mt-3">
          Conversation: <code className="font-mono">{log.conversationId}</code>
          {log.capturedRequestId && <> · Captured request: <code className="font-mono">{log.capturedRequestId}</code></>}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{title}</p>
      {children}
    </div>
  );
}
