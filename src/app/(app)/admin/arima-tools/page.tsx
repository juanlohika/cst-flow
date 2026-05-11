"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Wrench, Shield, Loader2, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle,
  Eye, EyeOff, ChevronDown, FileCode,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface Tool {
  id: string;
  name: string;
  category: "read" | "write" | "external";
  description: string;
  inputSchema: any;
  enabled: boolean;
  autonomy: "auto" | "approval" | "disabled";
  isBuiltIn: boolean;
}

interface Invocation {
  id: string;
  toolName: string;
  conversationId: string | null;
  userId: string | null;
  clientProfileId: string | null;
  input: string | null;
  output: string | null;
  status: string;
  approvalNeeded: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  executedAt: string | null;
  clientName: string | null;
  clientCode: string | null;
}

export default function ArimaToolsPage() {
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
    { label: "ARIMA Tools" },
  ]);

  const isAdmin = (session?.user as any)?.role === "admin";
  const [view, setView] = useState<"tools" | "approvals" | "invocations">("tools");

  // Tools
  const [tools, setTools] = useState<Tool[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  // Invocations
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [selectedInv, setSelectedInv] = useState<Invocation | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const fetchTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const res = await fetch("/api/admin/arima-tools");
      if (res.ok) setTools(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoadingTools(false); }
  }, []);

  const fetchInvocations = useCallback(async (statusFilter?: string) => {
    setLoadingInv(true);
    try {
      const url = statusFilter
        ? `/api/admin/arima-tools/invocations?status=${statusFilter}`
        : "/api/admin/arima-tools/invocations";
      const res = await fetch(url);
      if (res.ok) setInvocations(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoadingInv(false); }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    if (view === "tools") fetchTools();
    else if (view === "approvals") fetchInvocations("pending");
    else fetchInvocations();
  }, [view, isAdmin, fetchTools, fetchInvocations]);

  const updateTool = async (name: string, patch: Partial<Tool>) => {
    try {
      const res = await fetch(`/api/admin/arima-tools/${name}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setTools(prev => prev.map(t => t.name === name ? { ...t, ...patch } as Tool : t));
      }
    } catch (err) { console.error(err); }
  };

  const decideApproval = async (id: string, action: "approve" | "deny") => {
    setApproving(id);
    try {
      const res = await fetch(`/api/admin/arima-tools/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await fetchInvocations(view === "approvals" ? "pending" : undefined);
        if (selectedInv?.id === id) setSelectedInv(null);
      }
    } finally { setApproving(null); }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-500">Admin only</p>
      </div>
    );
  }

  const pendingCount = invocations.filter(i => i.status === "pending").length;

  const formatTime = (iso?: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
  };

  const categoryBadge = (c: string) =>
    c === "read" ? "bg-emerald-100 text-emerald-700"
    : c === "write" ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-500";

  const autonomyBadge = (a: string) =>
    a === "auto" ? "bg-emerald-100 text-emerald-700"
    : a === "approval" ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-500";

  const statusBadge = (s: string) =>
    s === "executed" ? "bg-emerald-100 text-emerald-700"
    : s === "failed" ? "bg-rose-100 text-rose-700"
    : s === "denied" ? "bg-slate-100 text-slate-500"
    : s === "pending" ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-500";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center shadow-md">
          <Wrench className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-black text-slate-800 tracking-tight">ARIMA Tools</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Manage the actions ARIMA can take during conversations
          </p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-slate-100/60 p-1 rounded-xl w-fit">
        <button
          onClick={() => setView("tools")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
            view === "tools" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Wrench className="w-3 h-3" />
          Tools ({tools.length})
        </button>
        <button
          onClick={() => setView("approvals")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
            view === "approvals" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Clock className="w-3 h-3" />
          Approvals {pendingCount > 0 && <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px]">{pendingCount}</span>}
        </button>
        <button
          onClick={() => setView("invocations")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
            view === "invocations" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileCode className="w-3 h-3" />
          Log
        </button>
      </div>

      {/* TOOLS VIEW */}
      {view === "tools" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loadingTools ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          ) : tools.length === 0 ? (
            <div className="p-12 text-center">
              <Wrench className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-400">No tools registered yet.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Visit <code>/api/auth/config</code> once to seed the built-ins.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {tools.map(t => (
                <div key={t.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <code className="text-[12px] font-mono font-bold text-slate-800">{t.name}</code>
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${categoryBadge(t.category)}`}>
                          {t.category}
                        </span>
                        {t.isBuiltIn && (
                          <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                            built-in
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-slate-600 leading-relaxed mb-2">{t.description}</p>
                      <button
                        onClick={() => setExpandedTool(expandedTool === t.id ? null : t.id)}
                        className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-slate-700 uppercase tracking-widest"
                      >
                        {expandedTool === t.id ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        {expandedTool === t.id ? "Hide" : "Show"} schema
                      </button>
                      {expandedTool === t.id && (
                        <pre className="mt-2 bg-slate-50 border border-slate-100 rounded-lg p-3 text-[10px] font-mono text-slate-600 overflow-auto max-h-48">
{JSON.stringify(t.inputSchema, null, 2)}
                        </pre>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Enabled</span>
                        <button
                          onClick={() => updateTool(t.name, { enabled: !t.enabled })}
                          className={`relative w-9 h-5 rounded-full transition-colors ${t.enabled ? "bg-emerald-500" : "bg-slate-200"}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-transform ${t.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </button>
                      </label>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Autonomy</span>
                        <select
                          value={t.autonomy}
                          onChange={e => updateTool(t.name, { autonomy: e.target.value as Tool["autonomy"] })}
                          className="text-[10px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none"
                        >
                          <option value="auto">Auto</option>
                          <option value="approval">Approval</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* APPROVALS VIEW */}
      {view === "approvals" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loadingInv ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          ) : invocations.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-200 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-400">No pending approvals.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                When ARIMA wants to run an approval-required tool, it'll queue up here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {invocations.map(inv => (
                <div key={inv.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <code className="text-[12px] font-mono font-bold text-slate-800">{inv.toolName}</code>
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusBadge(inv.status)}`}>
                          {inv.status}
                        </span>
                        {inv.clientName && (
                          <span className="text-[10px] font-bold text-slate-500">
                            for {inv.clientName}{inv.clientCode ? ` (${inv.clientCode})` : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mb-2">Queued {formatTime(inv.createdAt)}</p>
                      {inv.input && (
                        <pre className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-[10px] font-mono text-slate-600 overflow-auto max-h-40">
{JSON.stringify(JSON.parse(inv.input || "{}"), null, 2)}
                        </pre>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => decideApproval(inv.id, "approve")}
                        disabled={approving === inv.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 disabled:opacity-50"
                      >
                        {approving === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Approve
                      </button>
                      <button
                        onClick={() => decideApproval(inv.id, "deny")}
                        disabled={approving === inv.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3" />
                        Deny
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* INVOCATIONS LOG */}
      {view === "invocations" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loadingInv ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          ) : invocations.length === 0 ? (
            <div className="p-12 text-center">
              <FileCode className="w-10 h-10 text-slate-200 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-400">No tool invocations yet.</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Chat with ARIMA and watch this log fill up.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Tool</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Client</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Duration</th>
                  <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">When</th>
                </tr>
              </thead>
              <tbody>
                {invocations.map(inv => (
                  <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50/40 cursor-pointer" onClick={() => setSelectedInv(inv)}>
                    <td className="px-4 py-3"><code className="text-[11px] font-mono font-bold text-slate-700">{inv.toolName}</code></td>
                    <td className="px-4 py-3">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusBadge(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-600 truncate max-w-[180px]">
                      {inv.clientName || "—"}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{inv.durationMs != null ? `${inv.durationMs}ms` : "—"}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{formatTime(inv.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Detail modal for invocation log */}
      {selectedInv && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setSelectedInv(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[13px] font-black text-slate-800">Tool invocation</h3>
              <button onClick={() => setSelectedInv(null)} className="text-slate-300 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tool</p>
                <code className="text-[12px] font-mono font-bold">{selectedInv.toolName}</code>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusBadge(selectedInv.status)}`}>
                    {selectedInv.status}
                  </span>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Client</p>
                  <p className="text-[11px] text-slate-700">{selectedInv.clientName || "—"}</p>
                </div>
              </div>
              {selectedInv.input && (
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Input</p>
                  <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[10px] font-mono text-slate-600 overflow-auto">{JSON.stringify(JSON.parse(selectedInv.input || "{}"), null, 2)}</pre>
                </div>
              )}
              {selectedInv.output && (
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Output</p>
                  <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[10px] font-mono text-slate-600 overflow-auto">{JSON.stringify(JSON.parse(selectedInv.output || "{}"), null, 2)}</pre>
                </div>
              )}
              {selectedInv.errorMessage && (
                <div>
                  <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-1">Error</p>
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{selectedInv.errorMessage}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
