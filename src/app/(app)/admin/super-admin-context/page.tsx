"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  ShieldAlert, Loader2, Copy, Check, Trash2, AlertTriangle, UserPlus, ToggleLeft, ToggleRight, Clock,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";

interface ActiveContext {
  id: string;
  telegramChatId: string;
  bindToken: string | null;
  status: string;
  expiresAt: string;
  boundAt: string | null;
  notes: string | null;
}
interface AllowUser {
  id: string;
  cstUserId: string;
  telegramUserId: string | null;
  allowDmAccess: boolean;
  name: string | null;
  email: string | null;
  addedAt: string;
  notes: string | null;
}
interface AuditEntry {
  id: string;
  toolName: string | null;
  question: string | null;
  status: string;
  reason: string | null;
  userName: string | null;
  userEmail: string | null;
  responseSummary: string | null;
  responseBytes: number | null;
  createdAt: string;
}

export default function SuperAdminContextPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [active, setActive] = useState<ActiveContext | null>(null);
  const [users, setUsers] = useState<AllowUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [durationHours, setDurationHours] = useState(24);
  const [notes, setNotes] = useState("");
  const [emailToAdd, setEmailToAdd] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ctxRes, usersRes, auditRes] = await Promise.all([
        fetch("/api/admin/super-admin/context"),
        fetch("/api/admin/super-admin/users"),
        fetch("/api/admin/super-admin/audit?limit=50"),
      ]);
      if (ctxRes.ok) {
        const data = await ctxRes.json();
        setActive(data.active);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
      if (auditRes.ok) {
        const data = await auditRes.json();
        setAudit(data.entries || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const createContext = async () => {
    if (!confirm(`Generate a new Super Admin Context bind token? Any existing context will be revoked.\n\nDuration: ${durationHours} hours.`)) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/super-admin/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationHours, notes: notes.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data?.error || "Failed to create context"); return; }
      setNotes("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!confirm("Revoke the active Super Admin Context? ARIMA will immediately stop providing portfolio data in the bound GC.")) return;
    const res = await fetch("/api/admin/super-admin/context", { method: "DELETE" });
    if (res.ok) await load();
    else alert("Failed to revoke");
  };

  const extend = async (hours: number) => {
    const res = await fetch("/api/admin/super-admin/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });
    if (res.ok) await load();
    else alert("Failed to extend");
  };

  const addUser = async () => {
    const email = emailToAdd.trim().toLowerCase();
    if (!email) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/super-admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, allowDmAccess: false }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data?.error || "Failed to add user"); return; }
      setEmailToAdd("");
      await load();
    } finally {
      setAdding(false);
    }
  };

  const removeUser = async (cstUserId: string, name: string) => {
    if (!confirm(`Remove ${name} from the Super Admin allowlist?`)) return;
    const res = await fetch(`/api/admin/super-admin/users?cstUserId=${encodeURIComponent(cstUserId)}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  const toggleDm = async (u: AllowUser) => {
    const res = await fetch("/api/admin/super-admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cstUserId: u.cstUserId, allowDmAccess: !u.allowDmAccess }),
    });
    if (res.ok) await load();
  };

  const copyToken = (token: string) => {
    try {
      navigator.clipboard.writeText(token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {}
  };

  if (!isAdmin) return <div className="max-w-3xl mx-auto p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  const isBound = active && active.boundAt;
  const isPending = active && !active.boundAt;
  const expiresInMs = active ? new Date(active.expiresAt).getTime() - Date.now() : 0;
  const expiresInHours = Math.max(0, Math.floor(expiresInMs / (60 * 60 * 1000)));

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-rose-500" />
        <h1 className="text-lg font-black text-slate-900">Super Admin Context</h1>
      </div>

      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div className="text-[12px] text-rose-800">
          <p className="font-bold mb-1">This is the most sensitive surface in CST OS.</p>
          <p>
            When bound, ARIMA gains access to portfolio-wide CRM data (every account's health, EBA scores, RM assignments,
            requested modules, etc.) — but ONLY inside the bound Telegram group chat for users on the allowlist.
            The context expires after a duration you set. Anyone NOT on the allowlist gets a polite refusal even in the bound GC.
            ARIMA refuses to discuss portfolio data anywhere else (including DMs, unless an allowlisted user has explicitly opted in).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : (
        <>
          {/* Active context */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-[13px] font-black text-slate-800 mb-3">Active Context</h2>
            {!active ? (
              <p className="text-[12px] text-slate-500 italic">No context bound. Generate a token below and run <code className="bg-slate-100 px-1 rounded">/sabind &lt;token&gt;</code> in your designated Telegram group.</p>
            ) : isPending ? (
              <div className="space-y-3">
                <p className="text-[12px] text-slate-700">
                  <strong>Token generated — awaiting Telegram bind.</strong> Run <code className="bg-slate-100 px-1 rounded">/sabind {active.bindToken}</code> in the target Telegram group chat. Token expires in <strong>{expiresInHours} hours</strong>.
                </p>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <code className="flex-1 font-mono text-[13px] font-bold text-slate-800">{active.bindToken}</code>
                  <button onClick={() => copyToken(active.bindToken!)} className="p-1.5 text-slate-400 hover:text-slate-700">
                    {tokenCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button onClick={revoke} className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 text-[11px] font-black uppercase tracking-widest hover:bg-rose-50 inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Revoke token
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[12px] text-slate-700">
                  ✅ Bound to Telegram chat <code className="bg-slate-100 px-1 rounded">{active.telegramChatId}</code>
                </p>
                <div className="flex items-center gap-2 text-[12px] text-slate-700">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  Expires in <strong>{expiresInHours} hours</strong> ({new Date(active.expiresAt).toLocaleString()})
                </div>
                {active.notes && <p className="text-[11px] text-slate-500 italic">"{active.notes}"</p>}
                <div className="flex items-center gap-2">
                  <button onClick={() => extend(24)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black uppercase tracking-widest hover:border-emerald-300">+24h</button>
                  <button onClick={() => extend(168)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black uppercase tracking-widest hover:border-emerald-300">+7d</button>
                  <button onClick={revoke} className="ml-auto px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 text-[11px] font-black uppercase tracking-widest hover:bg-rose-50 inline-flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Revoke
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Create new context */}
          {!isBound && (
            <section className="bg-white border border-slate-200 rounded-2xl p-5">
              <h2 className="text-[13px] font-black text-slate-800 mb-3">{isPending ? "Generate a new token" : "Bind a Super Admin Group"}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Duration (hours)</label>
                  <input
                    type="number"
                    min={1}
                    max={2160}
                    value={durationHours}
                    onChange={e => setDurationHours(Number(e.target.value) || 24)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Default 24h. Max 90 days (2160h).</p>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Notes (optional)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. CEO portfolio review prep, May 2026"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300"
                  />
                </div>
              </div>
              <button
                onClick={createContext}
                disabled={creating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                Generate Bind Token
              </button>
            </section>
          )}

          {/* Allowlist */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-[13px] font-black text-slate-800 mb-3">Allowlist ({users.length})</h2>
            <p className="text-[11px] text-slate-500 mb-3">Only these CST OS users can interact with ARIMA in the Super Admin GC. Users must have a linked Telegram account.</p>

            <div className="flex items-center gap-2 mb-3">
              <input
                type="email"
                value={emailToAdd}
                onChange={e => setEmailToAdd(e.target.value)}
                placeholder="user@example.com"
                onKeyDown={e => { if (e.key === "Enter") addUser(); }}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300"
              />
              <button
                onClick={addUser}
                disabled={adding || !emailToAdd.trim()}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50"
              >
                {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                Add
              </button>
            </div>

            {users.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-4">No users on the allowlist yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                {users.map(u => (
                  <li key={u.id} className="px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-slate-800 truncate">{u.name || u.email || u.cstUserId}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span>{u.email || "—"}</span>
                        {!u.telegramUserId && <span className="text-amber-600 font-bold">⚠ Telegram not linked</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleDm(u)}
                      title={u.allowDmAccess ? "DM access enabled — disable" : "Enable DM access for this user"}
                      className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border ${u.allowDmAccess ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                    >
                      {u.allowDmAccess ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                      DM {u.allowDmAccess ? "On" : "Off"}
                    </button>
                    <button onClick={() => removeUser(u.cstUserId, u.name || u.email || "this user")} className="p-1 text-slate-400 hover:text-rose-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Audit log */}
          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h2 className="text-[13px] font-black text-slate-800">Audit Log</h2>
              <p className="text-[10px] text-slate-500 mt-0.5">Every Super Admin tool call and refusal. Most recent first.</p>
            </div>
            {audit.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-6">No audit entries yet.</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">When</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">User</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Tool</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Status</th>
                    <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Question / Response</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map(e => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-700">{e.userName || e.userEmail || "(unknown)"}</td>
                      <td className="px-3 py-2 font-mono text-slate-700">{e.toolName}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${e.status === "allowed" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {e.question && <p className="italic">"{e.question.slice(0, 120)}{e.question.length > 120 ? "…" : ""}"</p>}
                        {e.responseSummary && <p className="text-[10px] text-slate-400 mt-0.5">→ {e.responseSummary}</p>}
                        {e.reason && e.status !== "allowed" && <p className="text-[10px] text-rose-600 mt-0.5">{e.reason}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
