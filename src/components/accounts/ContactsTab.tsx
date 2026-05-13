"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Users, Crown, Mail, Phone, Briefcase, Send, Plus, Loader2, X, Trash2,
  CheckCircle2, AlertTriangle, Copy, Check, Building2, Calendar, Star,
  MessageCircle, Shield,
} from "lucide-react";

interface InternalMember {
  id: string;
  userId: string;
  role: string;
  internalRole: string | null;
  isPrimary: boolean;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  telegramLinked: boolean;
  telegramUsername: string | null;
  telegramName: string | null;
}

interface ClientContact {
  id: string;
  name: string;
  email: string;
  role: string | null;
  phone: string | null;
  status: string;
  invitedAt: string | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
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

const INTERNAL_ROLE_OPTIONS = [
  { value: "", label: "— None —" },
  { value: "PM", label: "Project Manager" },
  { value: "BA", label: "Business Analyst" },
  { value: "RM", label: "Relationship Manager" },
  { value: "Developer", label: "Developer" },
  { value: "Other", label: "Other" },
];

export default function ContactsTab({ accountId, companyName }: Props) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [internals, setInternals] = useState<InternalMember[]>([]);
  const [clientContacts, setClientContacts] = useState<ClientContact[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Add internal member form
  const [showAddInternal, setShowAddInternal] = useState(false);
  const [internalForm, setInternalForm] = useState({ userId: "", internalRole: "PM", isPrimary: false });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  // Add client contact form
  const [showAddClient, setShowAddClient] = useState(false);
  const [clientForm, setClientForm] = useState({ name: "", email: "", role: "", phone: "" });
  const [clientFormError, setClientFormError] = useState<string | null>(null);

  // Invite + delete state
  const [inviting, setInviting] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ contactId: string; magicUrl: string; emailSent: boolean } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, cRes] = await Promise.all([
        fetch(`/api/accounts/${accountId}/members`),
        fetch(`/api/accounts/${accountId}/contacts`),
      ]);
      if (mRes.ok) {
        const data = await mRes.json();
        setInternals(data.members || []);
      }
      if (cRes.ok) {
        const data = await cRes.json();
        setClientContacts(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const loadUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : data.users || []);
      }
    } catch (err) { console.error(err); }
  };

  // ─── Internal team actions ─────────────────────────────────────

  const addInternal = async () => {
    if (!internalForm.userId) return;
    setSubmitting(true);
    try {
      await fetch(`/api/accounts/${accountId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: internalForm.userId,
          role: "member",
          internalRole: internalForm.internalRole || null,
          isPrimary: internalForm.isPrimary,
        }),
      });
      setInternalForm({ userId: "", internalRole: "PM", isPrimary: false });
      setShowAddInternal(false);
      setSearch("");
      fetchAll();
    } finally {
      setSubmitting(false);
    }
  };

  const updateInternal = async (m: InternalMember, patch: Partial<InternalMember>) => {
    await fetch(`/api/accounts/${accountId}/members/${m.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    fetchAll();
  };

  const removeInternal = async (m: InternalMember) => {
    if (!confirm(`Remove ${m.userName || m.userEmail} from this account's team?`)) return;
    await fetch(`/api/accounts/${accountId}/members?userId=${m.userId}`, { method: "DELETE" });
    fetchAll();
  };

  // ─── Client contact actions ────────────────────────────────────

  const addClient = async () => {
    setClientFormError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setClientFormError(data.error || "Failed");
        return;
      }
      setClientForm({ name: "", email: "", role: "", phone: "" });
      setShowAddClient(false);
      fetchAll();
    } catch (err: any) {
      setClientFormError(err.message);
    }
  };

  const sendInvite = async (contactId: string) => {
    setInviting(contactId);
    setLastInvite(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts/${contactId}/invite`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setLastInvite({ contactId, magicUrl: data.magicUrl, emailSent: data.emailSent });
        fetchAll();
      } else {
        alert(data.error || "Failed");
      }
    } finally {
      setInviting(null);
    }
  };

  const removeClientContact = async (contact: ClientContact) => {
    if (!confirm(`Remove ${contact.name}? Their portal sessions will be revoked.`)) return;
    setRevoking(contact.id);
    try {
      await fetch(`/api/accounts/${accountId}/contacts/${contact.id}`, { method: "DELETE" });
      fetchAll();
    } finally {
      setRevoking(null);
    }
  };

  const sendCheckIn = async () => {
    if (!confirm("Send a proactive check-in to this client right now? ARIMA writes the message and routes it to the best channel.")) return;
    try {
      const res = await fetch("/api/admin/arima-checkins/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientProfileId: accountId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert(`Sent via ${data.channel}.\n\nMessage:\n${data.text}`);
      } else {
        alert(`Failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {}
  };

  const filteredUsers = users.filter(u => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (u.name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  }).filter(u => !internals.some(m => m.userId === u.id));

  const formatTime = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString() : "—";

  const statusBadge = (s: string) => {
    if (s === "active") return "bg-emerald-100 text-emerald-700";
    if (s === "revoked") return "bg-slate-100 text-slate-500";
    return "bg-amber-100 text-amber-700";
  };

  // Show non-admin guidance message
  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
          <Shield className="w-10 h-10 text-slate-200 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-500">Admin only</p>
          <p className="text-[11px] text-slate-400 mt-1">Contact management is restricted to admins.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      {/* ─── INTERNAL TEAM SECTION ─── */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-slate-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-[12px] font-black text-slate-800 uppercase tracking-widest">Internal Team</h3>
            <p className="text-[10px] text-slate-400">Your CST people assigned to this account · Primary owner gets routed alerts</p>
          </div>
          <button
            onClick={() => { setShowAddInternal(true); loadUsers(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 text-slate-700 text-[10px] font-black uppercase tracking-widest hover:bg-slate-100"
          >
            <Plus className="w-3 h-3" />
            Add internal
          </button>
        </div>

        <div className="p-4">
          {internals.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic py-3 text-center">
              No internal team assigned. Click "Add internal" to grant access to a CST user.
            </p>
          ) : (
            <div className="space-y-2">
              {internals.map(m => (
                <div key={m.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-[12px] font-black">
                        {(m.userName || m.userEmail || "?").charAt(0).toUpperCase()}
                      </div>
                      {m.isPrimary && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center">
                          <Crown className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-[12px] font-bold text-slate-800 truncate">{m.userName || "—"}</p>
                        {m.isPrimary && (
                          <span className="text-[8px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                            Primary
                          </span>
                        )}
                        {m.userRole === "admin" && (
                          <span className="text-[8px] font-black uppercase tracking-widest bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                            Admin
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{m.userEmail}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {m.telegramLinked ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            <MessageCircle className="w-2.5 h-2.5" />
                            Telegram: {m.telegramName || `@${m.telegramUsername}`}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-slate-400">
                            <MessageCircle className="w-2.5 h-2.5" />
                            No Telegram link
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <select
                        value={m.internalRole || ""}
                        onChange={e => updateInternal(m, { internalRole: e.target.value || null })}
                        className="text-[10px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none"
                      >
                        {INTERNAL_ROLE_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Primary</span>
                        <button
                          onClick={() => updateInternal(m, { isPrimary: !m.isPrimary })}
                          className={`relative w-7 h-4 rounded-full transition-colors ${m.isPrimary ? "bg-amber-400" : "bg-slate-200"}`}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-md transition-transform ${m.isPrimary ? "translate-x-[14px]" : "translate-x-0.5"}`} />
                        </button>
                      </label>
                      <button
                        onClick={() => removeInternal(m)}
                        className="text-slate-300 hover:text-rose-500 p-0.5"
                        title="Remove from account"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showAddInternal && (
            <div className="mt-3 border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Add internal team member</p>
                <button onClick={() => setShowAddInternal(false)} className="text-slate-300 hover:text-slate-600">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-rose-300"
              />
              <div className="max-h-40 overflow-auto thin-scrollbar space-y-0.5">
                {filteredUsers.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic py-2 text-center">No matching users</p>
                ) : (
                  filteredUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => setInternalForm({ ...internalForm, userId: u.id })}
                      className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors ${internalForm.userId === u.id ? "bg-rose-50 border border-rose-200" : "hover:bg-white"}`}
                    >
                      <p className="text-[11px] font-bold text-slate-700 truncate">{u.name || u.email}</p>
                      <p className="text-[9px] text-slate-400 truncate">{u.email}</p>
                    </button>
                  ))
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={internalForm.internalRole}
                  onChange={e => setInternalForm({ ...internalForm, internalRole: e.target.value })}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none"
                >
                  {INTERNAL_ROLE_OPTIONS.filter(o => o.value).map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 px-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={internalForm.isPrimary}
                    onChange={e => setInternalForm({ ...internalForm, isPrimary: e.target.checked })}
                  />
                  <span className="text-[10px] font-bold text-slate-700">Set as Primary</span>
                </label>
              </div>
              <button
                onClick={addInternal}
                disabled={submitting || !internalForm.userId}
                className="w-full px-3 py-2 rounded-xl bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-rose-600 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
                Grant access
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ─── CLIENT-SIDE CONTACTS SECTION ─── */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
          <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
            <Users className="w-4 h-4 text-rose-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-[12px] font-black text-slate-800 uppercase tracking-widest">Client-Side Contacts</h3>
            <p className="text-[10px] text-slate-400">External people from {companyName || "the client"} who can chat with ARIMA via portal</p>
          </div>
          <button
            onClick={sendCheckIn}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-100"
            title="Send a proactive check-in to this account"
          >
            <Calendar className="w-3 h-3" />
            Send check-in
          </button>
          <button
            onClick={() => setShowAddClient(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-widest hover:bg-rose-100"
          >
            <Plus className="w-3 h-3" />
            Add contact
          </button>
        </div>

        <div className="p-4">
          {clientContacts.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic py-3 text-center">
              No client-side contacts yet. Add one and send them an invite to give them ARIMA portal access.
            </p>
          ) : (
            <div className="space-y-2">
              {clientContacts.map(c => (
                <div key={c.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white text-[12px] font-black shrink-0">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-[12px] font-bold text-slate-800 truncate">{c.name}</p>
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusBadge(c.status)}`}>
                          {c.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        <Mail className="w-2.5 h-2.5 inline mr-1 opacity-60" />
                        {c.email}
                      </p>
                      {c.role && (
                        <p className="text-[10px] text-slate-400 truncate">
                          <Briefcase className="w-2.5 h-2.5 inline mr-1 opacity-60" />
                          {c.role}
                        </p>
                      )}
                      {c.phone && (
                        <p className="text-[10px] text-slate-400 truncate">
                          <Phone className="w-2.5 h-2.5 inline mr-1 opacity-60" />
                          {c.phone}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">
                        Invited {formatTime(c.invitedAt)} · Last seen {formatTime(c.lastSeenAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <button
                        onClick={() => sendInvite(c.id)}
                        disabled={inviting === c.id}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 disabled:opacity-50"
                      >
                        {inviting === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        {c.status === "active" ? "Re-send" : "Send invite"}
                      </button>
                      <button
                        onClick={() => removeClientContact(c)}
                        disabled={revoking === c.id}
                        className="text-slate-300 hover:text-rose-500 p-1"
                        title="Remove"
                      >
                        {revoking === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  {lastInvite && lastInvite.contactId === c.id && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center gap-2">
                        {lastInvite.emailSent ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            <p className="text-[11px] font-bold text-emerald-700">Email sent to {c.email}</p>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <p className="text-[11px] font-bold text-amber-700">SMTP unavailable — share manually</p>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                        <code className="flex-1 text-[10px] font-mono text-slate-700 break-all">{lastInvite.magicUrl}</code>
                        <button
                          onClick={() => copyUrl(lastInvite.magicUrl)}
                          className="p-1 text-slate-400 hover:text-rose-500 shrink-0"
                        >
                          {copiedUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showAddClient && (
            <div className="mt-3 border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">New client contact</p>
                <button onClick={() => { setShowAddClient(false); setClientFormError(null); }} className="text-slate-300 hover:text-slate-600">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <input
                autoFocus
                value={clientForm.name}
                onChange={e => setClientForm({ ...clientForm, name: e.target.value })}
                placeholder="Full name"
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-rose-300"
              />
              <input
                value={clientForm.email}
                onChange={e => setClientForm({ ...clientForm, email: e.target.value })}
                type="email"
                placeholder="Email"
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-rose-300"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={clientForm.role}
                  onChange={e => setClientForm({ ...clientForm, role: e.target.value })}
                  placeholder="Role (e.g. CFO)"
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-rose-300"
                />
                <input
                  value={clientForm.phone}
                  onChange={e => setClientForm({ ...clientForm, phone: e.target.value })}
                  placeholder="Phone"
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-rose-300"
                />
              </div>
              {clientFormError && (
                <p className="text-[11px] font-bold text-rose-500 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5" />
                  {clientFormError}
                </p>
              )}
              <button
                onClick={addClient}
                disabled={!clientForm.name.trim() || !clientForm.email.trim()}
                className="w-full px-3 py-2 rounded-xl bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-rose-600 disabled:opacity-50"
              >
                Save contact
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
