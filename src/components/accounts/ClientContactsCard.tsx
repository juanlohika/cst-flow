"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Users, Plus, Mail, Send, Loader2, Trash2, CheckCircle2,
  Copy, Check, AlertTriangle, Phone, Briefcase, X,
} from "lucide-react";

interface Contact {
  id: string;
  name: string;
  email: string;
  role: string | null;
  phone: string | null;
  status: string;
  invitedAt: string | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

interface Props {
  accountId: string;
  companyName?: string;
}

export default function ClientContactsCard({ accountId, companyName }: Props) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ contactId: string; magicUrl: string; emailSent: boolean } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts`);
      if (res.ok) setContacts(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  if (!isAdmin) return null;

  const addContact = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to add contact.");
        return;
      }
      setForm({ name: "", email: "", role: "", phone: "" });
      setShowAdd(false);
      fetchContacts();
    } catch (err: any) {
      setError(err.message || "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendInvite = async (contactId: string) => {
    setInviting(contactId);
    setLastInvite(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts/${contactId}/invite`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setLastInvite({ contactId, magicUrl: data.magicUrl, emailSent: data.emailSent });
        fetchContacts();
      } else {
        alert(data.error || "Failed to send invite.");
      }
    } finally {
      setInviting(null);
    }
  };

  const deleteContact = async (contactId: string, name: string) => {
    if (!confirm(`Remove ${name}? Any active portal sessions will be revoked.`)) return;
    setRevoking(contactId);
    try {
      const res = await fetch(`/api/accounts/${accountId}/contacts/${contactId}`, { method: "DELETE" });
      if (res.ok) fetchContacts();
    } finally {
      setRevoking(null);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {}
  };

  const formatTime = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString();
  };

  const statusBadge = (s: string) => {
    if (s === "active") return "bg-emerald-100 text-emerald-700";
    if (s === "revoked") return "bg-slate-100 text-slate-500";
    return "bg-amber-100 text-amber-700"; // invited
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Users className="w-4 h-4 text-rose-500" />
        <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex-1">
          Client Contacts (Portal Access)
        </h3>
        <button
          onClick={() => { setShowAdd(true); setError(null); }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-widest hover:bg-rose-100 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add contact
        </button>
      </div>

      <div className="p-5 space-y-3">
        <p className="text-[11px] text-slate-500">
          Invite people on the client's side to chat with ARIMA directly via a magic-link portal. They get an email, click once, and they're in — no signup needed.
        </p>

        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
        ) : contacts.length === 0 ? (
          <p className="text-[11px] font-semibold text-slate-400 italic py-3 text-center">
            No client contacts yet. Add one and send them an invite to give them ARIMA access.
          </p>
        ) : (
          <div className="space-y-2">
            {contacts.map(c => (
              <div key={c.id} className="border border-slate-100 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white text-[11px] font-black shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
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
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-colors disabled:opacity-50"
                    >
                      {inviting === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      {c.status === "active" ? "Re-send" : "Send invite"}
                    </button>
                    <button
                      onClick={() => deleteContact(c.id, c.name)}
                      disabled={revoking === c.id}
                      className="text-slate-300 hover:text-rose-500 p-1"
                      title="Remove contact"
                    >
                      {revoking === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {/* Just-sent invite info */}
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
                          <p className="text-[11px] font-bold text-amber-700">SMTP unavailable — share the link manually</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                      <code className="flex-1 text-[10px] font-mono text-slate-700 break-all">{lastInvite.magicUrl}</code>
                      <button
                        onClick={() => copyUrl(lastInvite.magicUrl)}
                        className="p-1 text-slate-400 hover:text-rose-500 shrink-0"
                        title="Copy link"
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

        {/* Add contact modal */}
        {showAdd && (
          <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                New contact
              </p>
              <button
                onClick={() => { setShowAdd(false); setError(null); }}
                className="text-slate-300 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            <input
              autoFocus
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Full name"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
            />
            <input
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="Email address"
              type="email"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}
                placeholder="Role (e.g. CFO)"
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
              />
              <input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone"
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
              />
            </div>

            {error && (
              <p className="text-[11px] font-bold text-rose-500 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <button
              onClick={addContact}
              disabled={submitting || !form.name.trim() || !form.email.trim()}
              className="w-full px-3 py-2 rounded-xl bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-rose-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
              Save contact
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
