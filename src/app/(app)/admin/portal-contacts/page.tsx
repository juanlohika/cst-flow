"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Users, Plus, Loader2, Mail, Send, Trash2, CheckCircle2,
  Copy, Check, AlertTriangle, Search, Building2, Shield, X,
  ExternalLink,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface Contact {
  id: string;
  clientProfileId: string;
  name: string;
  email: string;
  role: string | null;
  phone: string | null;
  status: string;
  invitedAt: string | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  companyName: string | null;
  clientCode: string | null;
}

interface Account {
  id: string;
  companyName: string;
  clientCode: string | null;
}

export default function PortalContactsPage() {
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
    { label: "Portal Contacts" },
  ]);

  const isAdmin = (session?.user as any)?.role === "admin";

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    clientProfileId: "",
    name: "",
    email: "",
    role: "",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ contactId: string; magicUrl: string; emailSent: boolean } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/portal-contacts");
      if (res.ok) setContacts(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchContacts();
      fetchAccounts();
    }
  }, [isAdmin, fetchContacts, fetchAccounts]);

  const addContact = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      if (!form.clientProfileId) {
        setFormError("Please select an account.");
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/accounts/${form.clientProfileId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          role: form.role || undefined,
          phone: form.phone || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to add contact.");
        return;
      }
      setForm({ clientProfileId: "", name: "", email: "", role: "", phone: "" });
      setShowAdd(false);
      fetchContacts();
    } catch (err: any) {
      setFormError(err.message || "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendInvite = async (contact: Contact) => {
    setInviting(contact.id);
    setLastInvite(null);
    try {
      const res = await fetch(`/api/accounts/${contact.clientProfileId}/contacts/${contact.id}/invite`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setLastInvite({ contactId: contact.id, magicUrl: data.magicUrl, emailSent: data.emailSent });
        fetchContacts();
      } else {
        alert(data.error || "Failed to send invite.");
      }
    } finally {
      setInviting(null);
    }
  };

  const deleteContact = async (contact: Contact) => {
    if (!confirm(`Remove ${contact.name} from ${contact.companyName}? Any active portal sessions will be revoked.`)) return;
    setRevoking(contact.id);
    try {
      const res = await fetch(`/api/accounts/${contact.clientProfileId}/contacts/${contact.id}`, { method: "DELETE" });
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

  const filtered = contacts.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.companyName || "").toLowerCase().includes(q) ||
      (c.role || "").toLowerCase().includes(q)
    );
  });

  const formatTime = (iso?: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString();
  };

  const statusBadge = (s: string) => {
    if (s === "active") return "bg-emerald-100 text-emerald-700";
    if (s === "revoked") return "bg-slate-100 text-slate-500";
    return "bg-amber-100 text-amber-700";
  };

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
          <Users className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-black text-slate-800 tracking-tight">Portal Contacts</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Manage external client contacts and their ARIMA portal access
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setFormError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-br from-rose-400 to-pink-500 text-white text-[11px] font-black uppercase tracking-widest shadow-md shadow-rose-500/30 hover:scale-[1.02] transition-transform"
        >
          <Plus className="w-3 h-3" />
          Add Contact
        </button>
      </header>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
        <Search className="w-3.5 h-3.5 text-slate-300" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, company…"
          className="flex-1 bg-transparent text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-slate-300 hover:text-slate-500">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Last invite info */}
      {lastInvite && (
        <div className="bg-white border border-emerald-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            {lastInvite.emailSent ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <p className="text-[12px] font-bold text-emerald-700">Email sent</p>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <p className="text-[12px] font-bold text-amber-700">SMTP unavailable — share the link manually</p>
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

      {/* Add contact form */}
      {showAdd && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
              New contact
            </p>
            <button
              onClick={() => { setShowAdd(false); setFormError(null); }}
              className="text-slate-300 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              Account *
            </label>
            <select
              value={form.clientProfileId}
              onChange={e => setForm({ ...form, clientProfileId: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-rose-300"
            >
              <option value="">— Select account —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.companyName}{a.clientCode ? ` · ${a.clientCode}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                Full name *
              </label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Jane Doe"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
              />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                Email *
              </label>
              <input
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="jane@company.com"
                type="email"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
              />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                Role
              </label>
              <input
                value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}
                placeholder="e.g. CFO"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
              />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                Phone
              </label>
              <input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="+63 9xx xxx xxxx"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
              />
            </div>
          </div>

          {formError && (
            <p className="text-[11px] font-bold text-rose-500 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              {formError}
            </p>
          )}

          <button
            onClick={addContact}
            disabled={submitting || !form.name.trim() || !form.email.trim() || !form.clientProfileId}
            className="w-full px-3 py-2 rounded-xl bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-rose-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            Save contact
          </button>
        </div>
      )}

      {/* Contacts table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-400">
              {contacts.length === 0 ? "No contacts yet." : "No contacts match your search."}
            </p>
            {contacts.length === 0 && (
              <p className="text-[11px] text-slate-400 mt-1">
                Click <strong>Add Contact</strong> to invite the first client contact.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Account</th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="text-left px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Last seen</th>
                <th className="text-right px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white text-[11px] font-black shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-slate-800 truncate">{c.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{c.email}</p>
                        {c.role && (
                          <p className="text-[10px] text-slate-400 truncate">{c.role}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <a
                      href={`/accounts/${c.clientProfileId}`}
                      className="flex items-center gap-1 text-[11px] font-bold text-slate-700 hover:text-rose-600 transition-colors"
                    >
                      <Building2 className="w-3 h-3 opacity-60" />
                      <span className="truncate max-w-[180px]">{c.companyName}</span>
                      {c.clientCode && (
                        <span className="text-[9px] font-black text-slate-400 px-1.5 py-0.5 bg-slate-100 rounded ml-1">
                          {c.clientCode}
                        </span>
                      )}
                    </a>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusBadge(c.status)}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <p className="text-[11px] text-slate-500">{formatTime(c.lastSeenAt)}</p>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => sendInvite(c)}
                        disabled={inviting === c.id}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-colors disabled:opacity-50"
                      >
                        {inviting === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        {c.status === "active" ? "Re-send" : "Send invite"}
                      </button>
                      <button
                        onClick={() => deleteContact(c)}
                        disabled={revoking === c.id}
                        className="p-1.5 text-slate-300 hover:text-rose-500"
                        title="Remove"
                      >
                        {revoking === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[10px] font-semibold text-slate-400 text-center">
        Showing {filtered.length} of {contacts.length} contacts.
      </p>
    </div>
  );
}
