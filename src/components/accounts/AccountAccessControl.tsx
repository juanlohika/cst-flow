"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Shield, Loader2, Plus, X, Copy, Check, RefreshCw, KeyRound, AlertTriangle, Users,
} from "lucide-react";
import { useSession } from "next-auth/react";

interface Member {
  id: string;
  userId: string;
  role: string;
  grantedBy?: string | null;
  grantedAt: string;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
}

interface UserOption {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface Props {
  accountId: string;
  companyName?: string;
}

export default function AccountAccessControl({ accountId, companyName }: Props) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [access, setAccess] = useState<{ clientCode?: string; accessToken?: string } | null>(null);
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [granting, setGranting] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  // Only admins should ever see this card. Show a small visible note for
  // non-admins so the absence isn't confusing.
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-3 flex items-center gap-2 text-[11px] font-bold text-slate-400">
        <Shield className="w-3.5 h-3.5" />
        Access control is admin-only. Ask an admin to manage member access for this account.
      </div>
    );
  }

  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(Array.isArray(data.members) ? data.members : []);
      }
    } catch (err) {
      console.error("Failed to load members", err);
    } finally {
      setLoadingMembers(false);
    }
  }, [accountId]);

  const fetchAccess = useCallback(async () => {
    setLoadingAccess(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/access`);
      if (res.ok) {
        const data = await res.json();
        setAccess({ clientCode: data.clientCode, accessToken: data.accessToken });
      }
    } catch (err) {
      console.error("Failed to load access codes", err);
    } finally {
      setLoadingAccess(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchMembers();
    fetchAccess();
  }, [fetchMembers, fetchAccess]);

  const loadUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.users || [];
        setUsers(list);
      }
    } catch (err) {
      console.error("Failed to load users", err);
    }
  };

  const grantAccess = async (userId: string) => {
    setGranting(userId);
    try {
      const res = await fetch(`/api/accounts/${accountId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: "member" }),
      });
      if (res.ok) {
        await fetchMembers();
        setShowAdd(false);
        setSearch("");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to grant access");
      }
    } finally {
      setGranting(null);
    }
  };

  const revokeAccess = async (userId: string, userName: string) => {
    if (!confirm(`Revoke ${userName}'s access to this account?`)) return;
    setRevoking(userId);
    try {
      const res = await fetch(`/api/accounts/${accountId}/members?userId=${userId}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchMembers();
    } finally {
      setRevoking(null);
    }
  };

  const copy = async (label: string, value?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // fallback
    }
  };

  const regenerateToken = async () => {
    if (!confirm(
      "Regenerating the access token will INVALIDATE all current channel bindings (Telegram groups, magic links, etc.) for this account. They will need to be re-registered. Proceed?"
    )) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/regenerate-token`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAccess(prev => ({ ...prev, accessToken: data.accessToken }));
        setTokenVisible(true);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to regenerate token");
      }
    } finally {
      setRegenerating(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (u.name || "").toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  }).filter(u => !members.some(m => m.userId === u.id));

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Shield className="w-4 h-4 text-rose-500" />
        <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
          Access Control
        </h3>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-auto">
          Admin only
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Client codes section */}
        <section>
          <div className="flex items-center gap-1.5 mb-2">
            <KeyRound className="w-3 h-3 text-slate-400" />
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Identifiers
            </h4>
          </div>
          {loadingAccess ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[11px] font-semibold">Loading…</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                    Client Code
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-[12px] font-black text-slate-800 bg-slate-50 px-2 py-1 rounded">
                      {access?.clientCode || "—"}
                    </code>
                    <button
                      onClick={() => copy("clientCode", access?.clientCode)}
                      className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                      title="Copy"
                    >
                      {copiedField === "clientCode" ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Human-readable reference. Safe to share with the client (it's just an ID).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 pt-3 border-t border-slate-100">
                <div className="flex-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                    Access Token (secret)
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[10px] font-mono text-slate-800 bg-slate-50 px-2 py-1 rounded break-all">
                      {tokenVisible ? access?.accessToken : "•".repeat(40)}
                    </code>
                    <button
                      onClick={() => setTokenVisible(v => !v)}
                      className="text-[10px] font-black text-slate-500 px-2 py-1 rounded hover:bg-slate-50 uppercase tracking-widest shrink-0"
                    >
                      {tokenVisible ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={() => copy("accessToken", access?.accessToken)}
                      className="p-1 text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                      title="Copy"
                    >
                      {copiedField === "accessToken" ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Used to bind external channels (Telegram groups, magic links, etc) to this account. Treat like a password — never share publicly. Regenerate if compromised.
                    </span>
                  </p>
                  <button
                    onClick={regenerateToken}
                    disabled={regenerating}
                    className="mt-2 flex items-center gap-1 text-[10px] font-black text-amber-600 hover:text-amber-700 uppercase tracking-widest"
                  >
                    {regenerating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Regenerate Token
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Members section */}
        <section className="pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 mb-2 justify-between">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-slate-400" />
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Members ({members.length})
              </h4>
            </div>
            <button
              onClick={() => {
                setShowAdd(true);
                if (users.length === 0) loadUsers();
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Grant Access
            </button>
          </div>

          {loadingMembers ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[11px] font-semibold">Loading members…</span>
            </div>
          ) : members.length === 0 ? (
            <p className="text-[11px] font-semibold text-slate-400 italic py-3 text-center">
              No team members granted access yet.
            </p>
          ) : (
            <div className="space-y-1">
              {members.map(m => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 group"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white text-[11px] font-black shrink-0">
                    {(m.userName || m.userEmail || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-800 truncate">
                      {m.userName || m.userEmail || "Unknown user"}
                    </p>
                    <p className="text-[9px] font-semibold text-slate-400 truncate">
                      {m.userEmail} · {m.role}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeAccess(m.userId, m.userName || m.userEmail || "this user")}
                    disabled={revoking === m.userId}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-300 hover:text-red-500"
                    title="Revoke access"
                  >
                    {revoking === m.userId ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <X className="w-3 h-3" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add member modal */}
          {showAdd && (
            <div className="mt-3 border border-slate-200 rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  Select a user to grant access
                </p>
                <button
                  onClick={() => { setShowAdd(false); setSearch(""); }}
                  className="text-slate-300 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300 transition-colors"
              />
              <div className="mt-2 max-h-48 overflow-auto thin-scrollbar space-y-0.5">
                {filteredUsers.length === 0 ? (
                  <p className="text-[10px] font-semibold text-slate-400 italic py-2 text-center">
                    No matching users
                  </p>
                ) : (
                  filteredUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => grantAccess(u.id)}
                      disabled={granting === u.id}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
                    >
                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                        {(u.name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[11px] font-bold text-slate-800 truncate">
                          {u.name || "—"}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 truncate">
                          {u.email} · {u.role}
                        </p>
                      </div>
                      {granting === u.id && <Loader2 className="w-3 h-3 animate-spin text-rose-400" />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
