"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Send, Loader2, Copy, Check, AlertTriangle, RefreshCw,
  Trash2, KeyRound, Link as LinkIcon, Eye, EyeOff, Shield, X,
  ExternalLink, CheckCircle2,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface AdminConfig {
  botTokenSet: boolean;
  botToken: string | null;
  botUsername: string | null;
  webhookSecret: string | null;
  webhookUrl: string;
  webhookInfo: any;
  myLink: any;
}

interface Binding {
  id: string;
  chatId: string;
  chatTitle: string | null;
  clientProfileId: string;
  clientName: string;
  clientCode: string | null;
  boundAt: string;
}

export default function TelegramAdminPage() {
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
    { label: "Channels" },
    { label: "Telegram" },
  ]);

  const isAdmin = (session?.user as any)?.role === "admin";

  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loadingBindings, setLoadingBindings] = useState(true);

  const [tokenInput, setTokenInput] = useState("");
  const [tokenSubmitting, setTokenSubmitting] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkCodeExpiresAt, setLinkCodeExpiresAt] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);

  const [copied, setCopied] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/telegram/admin");
      if (res.ok) setConfig(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  const fetchBindings = useCallback(async () => {
    setLoadingBindings(true);
    try {
      const res = await fetch("/api/telegram/bindings");
      if (res.ok) setBindings(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBindings(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchConfig();
      fetchBindings();
    }
  }, [isAdmin, fetchConfig, fetchBindings]);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {}
  };

  const saveToken = async () => {
    setTokenSubmitting(true);
    setTokenError(null);
    setTokenMessage(null);
    try {
      const res = await fetch("/api/telegram/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-token", token: tokenInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setTokenMessage(`✅ Connected to @${data.botUsername}. Webhook registered.`);
        setTokenInput("");
        fetchConfig();
      } else {
        setTokenError(data.error || "Failed to save token.");
      }
    } catch (err: any) {
      setTokenError(err.message || "Network error.");
    } finally {
      setTokenSubmitting(false);
    }
  };

  const reregisterWebhook = async () => {
    try {
      const res = await fetch("/api/telegram/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register-webhook" }),
      });
      if (res.ok) fetchConfig();
    } catch (err) {
      console.error(err);
    }
  };

  const clearBot = async () => {
    if (!confirm("This will disconnect the bot from CST OS, revoke the webhook, and clear the stored token. All existing bindings remain but the bot will stop responding until reconfigured. Proceed?")) return;
    try {
      const res = await fetch("/api/telegram/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (res.ok) fetchConfig();
    } catch (err) {
      console.error(err);
    }
  };

  const generateLinkCode = async () => {
    setGeneratingCode(true);
    try {
      const res = await fetch("/api/telegram/link-code", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setLinkCode(data.code);
        setLinkCodeExpiresAt(data.expiresAt);
      }
    } finally {
      setGeneratingCode(false);
    }
  };

  const unlinkMe = async () => {
    if (!confirm("Unlink your Telegram account from CST OS? You'll need to /link again to use admin commands.")) return;
    try {
      const res = await fetch("/api/telegram/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlink-me" }),
      });
      if (res.ok) fetchConfig();
    } catch (err) {
      console.error(err);
    }
  };

  const revokeBinding = async (chatId: string, clientName: string) => {
    if (!confirm(`Revoke the binding for ${clientName}? The bot will stop responding in that Telegram group.`)) return;
    try {
      const res = await fetch(`/api/telegram/bindings?chatId=${encodeURIComponent(chatId)}`, { method: "DELETE" });
      if (res.ok) fetchBindings();
    } catch (err) {
      console.error(err);
    }
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
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
          <Send className="w-5 h-5 text-white" fill="white" />
        </div>
        <div>
          <h1 className="text-base font-black text-slate-800 tracking-tight">Telegram Bot</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Configure the ARIMA Telegram channel
          </p>
        </div>
      </header>

      {/* ── BOT CONNECTION ─────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-blue-500" />
          <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
            Bot connection
          </h2>
        </div>
        <div className="p-5 space-y-4">
          {loadingConfig ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
          ) : config?.botTokenSet ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">
                    Connected as @{config.botUsername || "unknown"}
                  </p>
                  <p className="text-[10px] font-semibold text-slate-400">
                    Token: <code>{config.botToken}</code>
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Webhook
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[10px] font-mono text-slate-700 bg-white border border-slate-100 rounded px-2 py-1 truncate">
                    {config.webhookUrl}
                  </code>
                  <button
                    onClick={() => copy("webhookUrl", config.webhookUrl)}
                    className="p-1 text-slate-400 hover:text-blue-500 transition-colors"
                  >
                    {copied === "webhookUrl" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                {config.webhookInfo && (
                  <p className="text-[10px] font-semibold text-slate-500">
                    {config.webhookInfo?.url
                      ? <>Status: <span className="text-emerald-600 font-bold">live</span> · pending updates: {config.webhookInfo.pending_update_count ?? 0}</>
                      : <>Status: <span className="text-amber-600 font-bold">not registered yet</span></>}
                    {config.webhookInfo?.last_error_message && (
                      <span className="block text-rose-500 mt-1">⚠️ Last error: {config.webhookInfo.last_error_message}</span>
                    )}
                  </p>
                )}
                <button
                  onClick={reregisterWebhook}
                  className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-register webhook
                </button>
              </div>

              <button
                onClick={clearBot}
                className="text-[10px] font-black text-rose-500 hover:text-rose-700 uppercase tracking-widest flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Disconnect bot
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Paste your bot token from <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline">@BotFather</a>. After saving, the webhook is registered automatically.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  placeholder="123456789:ABCdefGHIjkl…"
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono text-slate-700 placeholder:text-slate-300 outline-none focus:border-blue-300"
                />
                <button
                  onClick={saveToken}
                  disabled={tokenSubmitting || !tokenInput.trim()}
                  className="px-4 py-2 rounded-xl bg-blue-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {tokenSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Save & Register
                </button>
              </div>
              {tokenError && (
                <p className="text-[11px] font-bold text-rose-500 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {tokenError}
                </p>
              )}
              {tokenMessage && (
                <p className="text-[11px] font-bold text-emerald-600">{tokenMessage}</p>
              )}
              <details className="mt-2">
                <summary className="text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer">
                  How to get a bot token (3 minutes)
                </summary>
                <ol className="text-[11px] text-slate-600 mt-2 space-y-1 list-decimal list-inside">
                  <li>Open Telegram → search for <strong>@BotFather</strong> → start a chat</li>
                  <li>Send <code>/newbot</code></li>
                  <li>Pick a display name (e.g. "ARIMA — Mobile Optima")</li>
                  <li>Pick a unique username ending in <code>_bot</code></li>
                  <li>BotFather replies with a token like <code>1234:ABC…</code> — copy it</li>
                  <li>Paste it above and click <strong>Save & Register</strong></li>
                </ol>
              </details>
            </div>
          )}
        </div>
      </section>

      {/* ── MY TELEGRAM LINK ────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-purple-500" />
          <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
            My Telegram link
          </h2>
        </div>
        <div className="p-5 space-y-3">
          {config?.myLink ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800">
                  Linked as {config.myLink.telegramName || `@${config.myLink.telegramUsername || "unknown"}`}
                </p>
                <p className="text-[10px] font-semibold text-slate-400">
                  Telegram ID: <code>{config.myLink.telegramUserId}</code>
                </p>
                <button
                  onClick={unlinkMe}
                  className="mt-1 text-[10px] font-black text-rose-500 hover:text-rose-700 uppercase tracking-widest"
                >
                  Unlink
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                Link your Telegram account so you can run admin commands (<code>/bind</code>, <code>/unbind</code>) from the bot in groups.
              </p>
              {linkCode ? (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-2">
                  <p className="text-[9px] font-black text-purple-600 uppercase tracking-widest">
                    Your link code
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-2xl font-black tracking-[0.2em] text-purple-700">
                      {linkCode}
                    </code>
                    <button
                      onClick={() => copy("linkCode", linkCode)}
                      className="p-1 text-purple-400 hover:text-purple-700"
                    >
                      {copied === "linkCode" ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-600">
                    DM the bot (<strong>@{config?.botUsername || "your_bot"}</strong>) and send <code>/link {linkCode}</code>
                  </p>
                  {linkCodeExpiresAt && (
                    <p className="text-[10px] font-semibold text-slate-400">
                      Expires {new Date(linkCodeExpiresAt).toLocaleTimeString()} (30 min)
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={generateLinkCode}
                  disabled={generatingCode}
                  className="px-4 py-2 rounded-xl bg-purple-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {generatingCode && <Loader2 className="w-3 h-3 animate-spin" />}
                  Generate Link Code
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── BOUND GROUPS ─────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Send className="w-4 h-4 text-sky-500" />
          <h2 className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
            Bound groups ({bindings.length})
          </h2>
          <button
            onClick={fetchBindings}
            className="ml-auto text-slate-300 hover:text-slate-500"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="p-5">
          {loadingBindings ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
          ) : bindings.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic py-3 text-center">
              No groups bound yet. Add the bot to a Telegram group, then run <code>/bind &lt;accessToken&gt;</code> in that group.
            </p>
          ) : (
            <div className="space-y-2">
              {bindings.map(b => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 group"
                >
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center text-white text-[11px] font-black shrink-0">
                    TG
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {b.chatTitle || `(Chat ${b.chatId})`}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-500 truncate">
                      Bound to {b.clientName}{b.clientCode ? ` (${b.clientCode})` : ""} · {b.boundAt.split("T")[0]}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeBinding(b.chatId, b.clientName)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-300 hover:text-rose-500"
                    title="Revoke binding"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── INSTRUCTIONS ────────────────────────────────────────────────── */}
      <section className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
        <h3 className="text-[11px] font-black text-slate-600 uppercase tracking-widest mb-3 flex items-center gap-1">
          <Shield className="w-3 h-3" />
          How to bind a Telegram group to a client
        </h3>
        <ol className="text-[11px] text-slate-700 space-y-1.5 list-decimal list-inside">
          <li>Make sure you've completed <strong>Bot connection</strong> + <strong>My Telegram link</strong> above.</li>
          <li>In Telegram, create a new group (or open an existing one).</li>
          <li>Add the bot (<strong>@{config?.botUsername || "your_bot"}</strong>) to the group.</li>
          <li>Make sure you're a Telegram <strong>group admin</strong> (creator counts).</li>
          <li>In CST OS → <strong>Accounts</strong> → click the client → <strong>Access Control</strong> card → <strong>Show</strong> + copy the <em>accessToken</em>.</li>
          <li>Back in the Telegram group, type <code>/bind &lt;paste-the-token&gt;</code>.</li>
          <li>The bot will confirm and start responding. Done!</li>
        </ol>
      </section>
    </div>
  );
}
