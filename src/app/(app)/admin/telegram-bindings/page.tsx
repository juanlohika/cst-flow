"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import QRCode from "qrcode";
import {
  Loader2, Copy, Check, RefreshCw, Search, Plus, Trash2,
  ExternalLink, MessageSquare, X, QrCode, AlertTriangle,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface ActiveBinding {
  bindingId: string;
  chatId: string;
  chatTitle: string | null;
  boundAt: string;
}
interface BindKeyRow {
  id: string;
  clientProfileId: string;
  label: string;
  accessToken: string;
  status: "active" | "revoked";
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  activeBinding: ActiveBinding | null;
}
interface AccountRow {
  account: {
    id: string;
    companyName: string;
    clientCode: string | null;
    tier: string | null;
    rmEmail: string | null;
    pmEmail: string | null;
  };
  keys: BindKeyRow[];
}

export default function TelegramBindingsPage() {
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
    { label: "Telegram Bindings" },
  ]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unbound" | "bound">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [modal, setModal] = useState<{ key: BindKeyRow; accountName: string } | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/telegram-bindings");
      if (res.ok) {
        const data = await res.json();
        setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
        setBotUsername(data?.botUsername || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) fetchRows(); }, [isAdmin, fetchRows]);

  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return accounts.filter(r => {
      if (needle && !(
        (r.account.companyName || "").toLowerCase().includes(needle)
        || (r.account.clientCode || "").toLowerCase().includes(needle)
        || (r.account.rmEmail || "").toLowerCase().includes(needle)
      )) return false;
      const hasActive = r.keys.some(k => k.status === "active" && k.activeBinding);
      if (filter === "unbound" && hasActive) return false;
      if (filter === "bound" && !hasActive) return false;
      return true;
    });
  }, [accounts, search, filter]);

  const totalAccounts = accounts.length;
  const totalBound = accounts.filter(r => r.keys.some(k => k.status === "active" && k.activeBinding)).length;

  const copy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1200); } catch {}
  };

  const addKey = async (accountId: string, accountName: string) => {
    const label = window.prompt(`Label for the new bind key on ${accountName}?\n\nExamples: "Internal RM Room", "Client-facing", "Solutions Review".`, "Internal Team");
    if (!label) return;
    setBusy(`add-${accountId}`);
    try {
      const res = await fetch("/api/admin/telegram-bindings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientProfileId: accountId, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create key");
      await fetchRows();
      // Surface the new key immediately
      setModal({ key: data.key, accountName });
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const revokeKey = async (keyId: string, label: string) => {
    if (!window.confirm(`Revoke key "${label}"? Any group bound by this key will stop receiving ARIMA replies. This cannot be undone.`)) return;
    setBusy(`revoke-${keyId}`);
    try {
      const res = await fetch(`/api/admin/telegram-bindings/keys/${keyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "Failed to revoke");
      await fetchRows();
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) return <div className="p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-sky-500" /> Telegram Bindings
          </h1>
          <p className="text-[12px] text-slate-500 mt-1">
            Manage Telegram group bindings per account. Each account can have multiple labeled bind keys — one per GC. {totalBound} of {totalAccounts} accounts are bound.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchRows} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-black uppercase tracking-widest hover:border-sky-300 disabled:opacity-50">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
          </button>
        </div>
      </div>

      {!botUsername && (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="text-[13px] text-amber-900">
            <p className="font-bold">Bot username isn't configured yet.</p>
            <p className="mt-1">Set it in <a href="/admin" className="underline">Admin → Auth → Telegram</a> so deep-link bind buttons work. Without it, the table only shows the <code>/bind &lt;token&gt;</code> fallback.</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[220px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by account name, code, or RM email"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-[13px] focus:outline-none focus:border-sky-300"
          />
        </div>
        {(["all", "unbound", "bound"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border ${
              filter === f ? "bg-sky-500 text-white border-sky-500" : "bg-white text-slate-600 border-slate-200 hover:border-sky-300"
            }`}>
            {f}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
            <tr>
              <th className="text-left px-3 py-2.5">Account</th>
              <th className="text-left px-3 py-2.5">Tier</th>
              <th className="text-left px-3 py-2.5">RM</th>
              <th className="text-left px-3 py-2.5">Bind Keys</th>
              <th className="text-right px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-slate-400" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400 text-[12px]">No accounts match those filters.</td></tr>
            ) : (
              filtered.map(row => (
                <tr key={row.account.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-3">
                    <div className="font-bold text-slate-900">{row.account.companyName}</div>
                    {row.account.clientCode && <div className="text-[11px] text-slate-400 font-mono">{row.account.clientCode}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.account.tier || "—"}</td>
                  <td className="px-3 py-3 text-slate-600 text-[12px]">{row.account.rmEmail || "—"}</td>
                  <td className="px-3 py-3 space-y-1.5">
                    {row.keys.length === 0 ? (
                      <span className="text-[11px] text-slate-400 italic">No keys yet.</span>
                    ) : (
                      row.keys.map(k => (
                        <div key={k.id} className="flex items-center gap-2 flex-wrap text-[12px]">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold ${
                            k.status === "revoked" ? "bg-slate-100 text-slate-400 line-through" :
                            k.activeBinding ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                          }`}>
                            {k.label}
                          </span>
                          {k.status === "active" && k.activeBinding && (
                            <span className="text-[11px] text-slate-500">→ {k.activeBinding.chatTitle || `chat ${k.activeBinding.chatId}`}</span>
                          )}
                          {k.status === "active" && !k.activeBinding && (
                            <span className="text-[11px] text-amber-700 italic">unbound</span>
                          )}
                          {k.status === "active" && (
                            <>
                              <button onClick={() => setModal({ key: k, accountName: row.account.companyName })}
                                className="text-[11px] text-sky-700 hover:underline">View link</button>
                              <button onClick={() => revokeKey(k.id, k.label)} disabled={busy === `revoke-${k.id}`}
                                className="text-[11px] text-rose-600 hover:underline">
                                {busy === `revoke-${k.id}` ? "Revoking…" : "Revoke"}
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => addKey(row.account.id, row.account.companyName)}
                      disabled={busy === `add-${row.account.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500 text-white text-[11px] font-bold hover:bg-sky-600 disabled:opacity-50">
                      {busy === `add-${row.account.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Add key
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <BindLinkModal
          modal={modal}
          botUsername={botUsername}
          onClose={() => setModal(null)}
          copy={copy}
          copied={copied}
        />
      )}
    </div>
  );
}

function BindLinkModal({
  modal, botUsername, onClose, copy, copied,
}: {
  modal: { key: BindKeyRow; accountName: string };
  botUsername: string | null;
  onClose: () => void;
  copy: (text: string, id: string) => void;
  copied: string | null;
}) {
  const { key, accountName } = modal;
  const deepLink = botUsername ? `https://t.me/${botUsername}?startgroup=BIND_${key.accessToken}` : null;
  const bindCmd = `/bind ${key.accessToken}`;
  const inviteMessage = deepLink
    ? `Hi! Please set up the Telegram group for ${accountName} (${key.label}).\n\n1. Create the group + add @${botUsername}.\n2. Tap this link, pick the group: ${deepLink}\n\nIt'll auto-bind. If anything goes wrong, paste this in the group instead: ${bindCmd}`
    : `Hi! Please set up the Telegram group for ${accountName} (${key.label}).\n\n1. Create the group + add the bot.\n2. In the group, paste: ${bindCmd}`;

  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!deepLink) { setQrUrl(null); return; }
    QRCode.toDataURL(deepLink, { width: 220, margin: 1 }).then(setQrUrl).catch(() => setQrUrl(null));
  }, [deepLink]);

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-black text-slate-900 text-lg">{accountName}</h2>
            <p className="text-[12px] text-slate-500">Key: <span className="font-bold text-slate-700">{key.label}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        {key.activeBinding && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 mb-4 text-[12px] text-emerald-900">
            <strong>Already bound</strong> to {key.activeBinding.chatTitle || `chat ${key.activeBinding.chatId}`}.
            To bind to a different group, revoke this key first or create a new one.
          </div>
        )}

        {deepLink ? (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Deep link (one-tap on mobile)</label>
              <div className="mt-1 flex items-stretch gap-2">
                <a href={deepLink} target="_blank" rel="noreferrer" className="flex-1 truncate px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-sky-700 hover:underline">{deepLink}</a>
                <button onClick={() => copy(deepLink, "deep")} className="px-3 rounded-lg border border-slate-200 hover:border-sky-300 text-slate-600">
                  {copied === "deep" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Tap on phone → Telegram opens → pick a group → bot auto-binds.</p>
            </div>

            {qrUrl && (
              <div className="flex flex-col items-center gap-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 self-start">QR code (scan from a different device)</label>
                <img src={qrUrl} alt="Bind QR" className="rounded-lg border border-slate-200" />
              </div>
            )}

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Fallback: paste in the group</label>
              <div className="mt-1 flex items-stretch gap-2">
                <code className="flex-1 truncate px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700">{bindCmd}</code>
                <button onClick={() => copy(bindCmd, "cmd")} className="px-3 rounded-lg border border-slate-200 hover:border-sky-300 text-slate-600">
                  {copied === "cmd" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Invite message (DM to the RM / room owner)</label>
              <div className="mt-1 flex items-stretch gap-2">
                <textarea readOnly value={inviteMessage} rows={4}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[12px] text-slate-700 resize-none" />
                <button onClick={() => copy(inviteMessage, "invite")} className="px-3 rounded-lg border border-slate-200 hover:border-sky-300 text-slate-600">
                  {copied === "invite" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-900">
            Bot username not configured. Configure it in Admin → Auth → Telegram, then come back here. In the meantime use the <code>/bind &lt;token&gt;</code> command:
            <div className="mt-2 flex items-stretch gap-2">
              <code className="flex-1 truncate px-3 py-2 rounded-lg bg-white border border-slate-200 text-[11px] font-mono text-slate-700">{bindCmd}</code>
              <button onClick={() => copy(bindCmd, "cmd")} className="px-3 rounded-lg border border-slate-200 hover:border-sky-300 text-slate-600">
                {copied === "cmd" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
