"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList, MessageCircle, Boxes, ChevronRight, Loader2, AlertTriangle,
  Crown, RefreshCw, FileText, Briefcase, CheckCircle2, Layers,
  ArrowUpRight, X,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

type Tab = "sessions" | "brds" | "modules";

interface DiscoveryBinding {
  id: string;
  chatId: string;
  chatTitle: string | null;
  clientName: string;
  clientCode: string | null;
  agentMode: "arima" | "eliana";
  boundAt: string;
}

interface BRDRequest {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string;
  createdAt: string;
  clientName: string | null;
  ownerName: string | null;
}

interface KnowledgeModule {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string;
  whoItsFor: string | null;
  keyFeatures: string | null;
  priceNote: string | null;
  status: string;
}

export default function ElianaPage() {
  const router = useRouter();
  useBreadcrumbs([{ label: "Eliana" }]);

  const [tab, setTab] = useState<Tab>("sessions");
  const [sessions, setSessions] = useState<DiscoveryBinding[]>([]);
  const [brds, setBrds] = useState<BRDRequest[]>([]);
  const [modules, setModules] = useState<KnowledgeModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBrd, setSelectedBrd] = useState<BRDRequest | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [bindingsRes, brdsRes, modulesRes] = await Promise.all([
        fetch("/api/telegram/bindings").then(r => r.ok ? r.json() : []).catch(() => []),
        fetch("/api/arima/requests?category=brd").then(r => r.ok ? r.json() : []).catch(() => []),
        fetch("/api/admin/knowledge/modules").then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      // Only Eliana-mode bindings show in the Sessions tab
      const elianaSessions = (Array.isArray(bindingsRes) ? bindingsRes : []).filter(
        (b: DiscoveryBinding) => b.agentMode === "eliana"
      );
      setSessions(elianaSessions);
      setBrds(Array.isArray(brdsRes) ? brdsRes : (brdsRes?.requests || []));
      setModules(Array.isArray(modulesRes) ? modulesRes : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  return (
    <AuthGuard>
      <div className="flex flex-col h-full bg-surface-subtle">
        <div className="px-6 pt-6 pb-2 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-blue-600 flex items-center justify-center shadow-md">
              <ClipboardList className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight">Eliana</h1>
              <p className="text-[11px] font-semibold text-slate-500">Business Analyst · Discovery & requirements elicitation</p>
            </div>
            <button
              onClick={loadAll}
              className="ml-auto flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-indigo-600 uppercase tracking-widest"
              title="Refresh"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          <div className="flex items-center gap-1 mt-4 border-b border-slate-100">
            {([
              { id: "sessions", label: "Discovery Sessions", icon: MessageCircle, count: sessions.length },
              { id: "brds", label: "Captured BRDs", icon: FileText, count: brds.length },
              { id: "modules", label: "Module Catalog", icon: Boxes, count: modules.length },
            ] as Array<{ id: Tab; label: string; icon: any; count: number }>).map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold border-b-2 transition-colors ${
                    tab === t.id ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                  <span className="text-[10px] font-black text-slate-400 ml-0.5">{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6 max-w-6xl mx-auto w-full">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            </div>
          )}
          {!loading && tab === "sessions" && <SessionsTab sessions={sessions} />}
          {!loading && tab === "brds" && <BRDsTab brds={brds} onOpen={setSelectedBrd} onReload={loadAll} />}
          {!loading && tab === "modules" && <ModulesTab modules={modules} />}
        </div>

        {selectedBrd && <BRDDetail brd={selectedBrd} onClose={() => setSelectedBrd(null)} onReload={loadAll} router={router} />}
      </div>
    </AuthGuard>
  );
}

// ─── Sessions tab ───────────────────────────────────────────────

function SessionsTab({ sessions }: { sessions: DiscoveryBinding[] }) {
  if (sessions.length === 0) {
    return (
      <EmptyCard
        icon={MessageCircle}
        title="No active discovery sessions"
        subtitle="Eliana leads discovery in Telegram groups bound with agent mode 'eliana'. Switch a bound group's mode by running /mode eliana in Telegram (admin only)."
      />
    );
  }
  return (
    <div className="space-y-2 pt-4">
      <p className="text-[12px] text-slate-500 mb-2">
        Active Eliana discovery rooms — Telegram groups currently in BA mode where Eliana leads requirements elicitation.
      </p>
      {sessions.map(s => (
        <div key={s.id} className="bg-white border border-slate-100 rounded-xl p-3 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
            <MessageCircle className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13px] font-bold text-slate-800 truncate">{s.chatTitle || `Chat ${s.chatId}`}</p>
              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">Eliana mode</span>
            </div>
            <p className="text-[11px] text-slate-500 truncate">
              {s.clientName}{s.clientCode ? ` · ${s.clientCode}` : ""}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Bound {new Date(s.boundAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── BRDs tab ───────────────────────────────────────────────────

function BRDsTab({ brds, onOpen, onReload }: { brds: BRDRequest[]; onOpen: (b: BRDRequest) => void; onReload: () => void }) {
  if (brds.length === 0) {
    return (
      <EmptyCard
        icon={FileText}
        title="No BRDs captured yet"
        subtitle="When Eliana finishes a discovery session, she emits a structured [BRD] block that's captured here as a request with category 'brd'."
      />
    );
  }
  return (
    <div className="space-y-2 pt-4">
      <p className="text-[12px] text-slate-500 mb-2">
        Business requirements captured by Eliana. Click one to see the full summary and optionally promote it to a project.
      </p>
      {brds.map(b => (
        <button
          key={b.id}
          onClick={() => onOpen(b)}
          className="w-full text-left bg-white border border-slate-100 rounded-xl p-3 flex items-start gap-3 hover:border-indigo-300"
        >
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
              <p className="text-[13px] font-bold text-slate-800 truncate">{b.title}</p>
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusColor(b.status)}`}>{b.status}</span>
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${priorityColor(b.priority)}`}>{b.priority}</span>
            </div>
            {b.clientName && <p className="text-[11px] text-slate-500 truncate">{b.clientName}</p>}
            <p className="text-[10px] text-slate-400 mt-0.5">{new Date(b.createdAt).toLocaleString()}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-2" />
        </button>
      ))}
    </div>
  );
}

function BRDDetail({ brd, onClose, onReload, router }: { brd: BRDRequest; onClose: () => void; onReload: () => void; router: any }) {
  const [promoting, setPromoting] = useState(false);

  const promote = async () => {
    if (!confirm(`Promote "${brd.title}" to a new project?`)) return;
    setPromoting(true);
    try {
      const res = await fetch(`/api/eliana/brds/${brd.id}/promote`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data?.projectId) {
        onReload();
        onClose();
        router.push(`/architect/${data.projectId}`);
      } else {
        alert(data?.error || "Failed to promote — endpoint may not be wired yet. Marking BRD as 'reviewed' instead.");
        await fetch(`/api/arima/requests/${brd.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "reviewed" }),
        });
        onReload();
        onClose();
      }
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusColor(brd.status)}`}>{brd.status}</span>
              <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${priorityColor(brd.priority)}`}>{brd.priority}</span>
              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">BRD</span>
            </div>
            <h2 className="text-[16px] font-black text-slate-900">{brd.title}</h2>
            {brd.clientName && <p className="text-[11px] text-slate-500 mt-0.5">{brd.clientName}</p>}
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {brd.description && (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 whitespace-pre-wrap text-[12px] text-slate-700 leading-relaxed">
            {brd.description}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={promote}
            disabled={promoting}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white text-[12px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
          >
            {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
            Promote to project
          </button>
        </div>
        <p className="text-[10px] text-slate-400 text-center">
          Created {new Date(brd.createdAt).toLocaleString()}
          {brd.ownerName ? ` · Captured by ${brd.ownerName}` : ""}
        </p>
      </div>
    </div>
  );
}

// ─── Modules tab ────────────────────────────────────────────────

function ModulesTab({ modules }: { modules: KnowledgeModule[] }) {
  if (modules.length === 0) {
    return (
      <EmptyCard
        icon={Boxes}
        title="No modules in the catalog yet"
        subtitle="Add Tarkie modules in /admin/knowledge so Eliana can suggest existing solutions during discovery instead of recommending custom builds."
      />
    );
  }
  return (
    <div className="grid gap-2 pt-4 sm:grid-cols-2">
      {modules.map(m => (
        <div key={m.id} className="bg-white border border-slate-100 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
              <Layers className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <p className="text-[13px] font-bold text-slate-800 truncate">{m.name}</p>
            {m.category && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{m.category}</span>}
            <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ml-auto ${m.status === "active" ? "bg-emerald-50 text-emerald-600" : m.status === "beta" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>{m.status}</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">{m.description}</p>
          {m.whoItsFor && <p className="text-[10px] text-slate-400 mt-1">For: {m.whoItsFor}</p>}
          {m.priceNote && <p className="text-[10px] text-slate-400 mt-0.5">{m.priceNote}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Shared ─────────────────────────────────────────────────────

function EmptyCard({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-8 text-center mt-4">
      <Icon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
      <p className="text-[13px] font-bold text-slate-700 mb-1">{title}</p>
      <p className="text-[11px] text-slate-500 max-w-md mx-auto">{subtitle}</p>
    </div>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case "new": return "bg-indigo-50 text-indigo-600";
    case "reviewed": return "bg-blue-50 text-blue-600";
    case "scoped": return "bg-purple-50 text-purple-600";
    case "converted": return "bg-emerald-50 text-emerald-600";
    case "declined": return "bg-slate-100 text-slate-500";
    default: return "bg-slate-100 text-slate-500";
  }
}

function priorityColor(p: string): string {
  switch (p) {
    case "urgent": return "bg-rose-50 text-rose-600";
    case "high": return "bg-amber-50 text-amber-600";
    case "medium": return "bg-blue-50 text-blue-600";
    case "low": return "bg-slate-100 text-slate-500";
    default: return "bg-slate-100 text-slate-500";
  }
}
