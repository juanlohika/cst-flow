"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Shield, Loader2, Copy, Check, Eye, EyeOff, RefreshCw, Search, Building2,
  Users, AlertTriangle, KeyRound,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface AccessRow {
  id: string;
  companyName: string;
  industry: string;
  engagementStatus: string;
  clientCode: string;
  accessToken: string;
  memberCount: number;
}

export default function AccessCodesPage() {
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
    { label: "Access Codes" },
  ]);

  const isAdmin = (session?.user as any)?.role === "admin";

  const [rows, setRows] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts/access-overview");
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchRows();
  }, [isAdmin, fetchRows]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Fallback: prompt user to copy manually
      window.prompt("Copy this value:", value);
    }
  };

  const toggleReveal = (id: string) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const regenerateToken = async (id: string) => {
    if (!confirm("Regenerating this access token will INVALIDATE all existing channel bindings (Telegram groups, etc.) for this account. Proceed?")) return;
    setRegenerating(id);
    try {
      const res = await fetch(`/api/accounts/${id}/regenerate-token`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setRows(prev => prev.map(r => r.id === id ? { ...r, accessToken: data.accessToken } : r));
        // Auto-reveal so user can copy the new one immediately
        setRevealed(prev => new Set(prev).add(id));
      }
    } finally {
      setRegenerating(null);
    }
  };

  const filtered = rows.filter(r => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.companyName.toLowerCase().includes(q) ||
      r.industry.toLowerCase().includes(q) ||
      (r.clientCode || "").toLowerCase().includes(q)
    );
  });

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-500">Admin only</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/30">
          <KeyRound className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-black text-slate-800 tracking-tight">Access Codes</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Manage client codes and access tokens for all accounts
          </p>
        </div>
      </header>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[11px] text-amber-900">
          <p className="font-bold mb-1">Treat tokens like passwords.</p>
          <p>
            Anyone with an access token can bind a Telegram group (or other channel) to that client. Don't share them in public channels. Regenerate any token that may have leaked — existing channel bindings will need to be re-registered.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
        <Search className="w-3.5 h-3.5 text-slate-300" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by company, industry, or code…"
          className="flex-1 bg-transparent text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none"
        />
        <button
          onClick={fetchRows}
          className="text-slate-300 hover:text-slate-500"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-400">
              {rows.length === 0 ? "No accounts in the system yet." : "No accounts match your search."}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Company</th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Client Code</th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Access Token (secret)</th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest w-24">Members</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isRevealed = revealed.has(r.id);
                return (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/40 transition-colors">
                    {/* Company */}
                    <td className="px-4 py-3 align-top">
                      <p className="text-[12px] font-bold text-slate-800 truncate">{r.companyName}</p>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                        {r.industry} · {r.engagementStatus}
                      </p>
                    </td>

                    {/* Client Code */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <code className="text-[11px] font-black text-slate-700 bg-slate-100 px-2 py-1 rounded">
                          {r.clientCode}
                        </code>
                        <button
                          onClick={() => copy(`code-${r.id}`, r.clientCode)}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                          title="Copy code"
                        >
                          {copied === `code-${r.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>

                    {/* Access Token */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 text-[10px] font-mono text-slate-700 bg-slate-50 border border-slate-100 px-2 py-1 rounded break-all min-w-0">
                          {isRevealed ? r.accessToken : "•".repeat(40)}
                        </code>
                        <button
                          onClick={() => toggleReveal(r.id)}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors shrink-0"
                          title={isRevealed ? "Hide" : "Show"}
                        >
                          {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => copy(`token-${r.id}`, r.accessToken)}
                          className="p-1 text-slate-300 hover:text-rose-500 transition-colors shrink-0"
                          title="Copy token"
                        >
                          {copied === `token-${r.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => regenerateToken(r.id)}
                          disabled={regenerating === r.id}
                          className="p-1 text-slate-300 hover:text-amber-500 transition-colors shrink-0"
                          title="Regenerate token"
                        >
                          {regenerating === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        </button>
                      </div>
                    </td>

                    {/* Members */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
                        <Users className="w-3 h-3 text-slate-400" />
                        {r.memberCount}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[10px] font-semibold text-slate-400 text-center">
        Showing {filtered.length} of {rows.length} accounts.
      </p>
    </div>
  );
}
