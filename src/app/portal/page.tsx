"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Heart, ArrowUp, Loader2, Sparkles, LogOut, CheckCircle2,
  Send, Paperclip, X, Image as ImageIcon,
} from "lucide-react";

interface Attachment {
  type: "image";
  url?: string;     // data URL or remote URL
  mime: string;
  width?: number;
  height?: number;
  source: "telegram" | "portal";
  base64?: string;  // raw base64 (no data:image/… prefix) for vision
}

interface MentionRef {
  type: "internal" | "external" | "arima";
  id: string | null;
  name: string;
  telegramUsername?: string | null;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  senderType?: "internal" | "external" | "arima" | "system" | null;
  senderName?: string | null;
  senderChannel?: "telegram" | "portal" | "web" | null;
  attachments?: Attachment[];
  mentions?: MentionRef[];
  createdAt?: string;
}

interface PortalSession {
  contactId: string;
  contactName: string;
  contactEmail: string;
  clientProfileId: string;
  clientName: string;
  clientCode: string | null;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB — anything bigger should go through a real bucket

export default function PortalChatPage() {
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [capturedToast, setCapturedToast] = useState<{ title: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mention typeahead state
  interface MentionOption { type: string; id: string; name: string; subtitle: string; token: string; }
  const [mentionPool, setMentionPool] = useState<MentionOption[]>([]);
  const [mentionState, setMentionState] = useState<{ open: boolean; query: string; anchorIdx: number; activeIdx: number }>({ open: false, query: "", anchorIdx: -1, activeIdx: 0 });

  const reloadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/chat");
      if (!res.ok) return;
      const data = await res.json();
      if (data.session) setSession(data.session);
      setMessages((data.messages || []) as Message[]);
    } catch {}
  }, []);

  const [loadError, setLoadError] = useState<string | null>(null);

  // ─── Auth check + initial history ───────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/portal/chat");
        if (res.status === 401) {
          // Real auth failure — session expired, send to the resend flow
          router.push("/portal/expired");
          return;
        }
        if (!res.ok) {
          // Transient (5xx / DB hiccup) — keep them on the page, show a banner so they can retry.
          const data = await res.json().catch(() => ({}));
          setLoadError(data?.error || `Couldn't load messages (HTTP ${res.status}). Try refreshing in a moment.`);
          return;
        }
        const data = await res.json();
        setSession(data.session);
        setMessages((data.messages || []) as Message[]);
      } catch (err: any) {
        setLoadError(err?.message || "Network error. Please refresh.");
      } finally {
        setAuthChecking(false);
        setLoadingHistory(false);
      }
    }
    init();
  }, [router]);

  // Mention notification: track newest pinged message id so we only highlight once.
  const [pingedBanner, setPingedBanner] = useState<{ messageId: string; from: string } | null>(null);
  const lastSeenIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session || messages.length === 0) return;
    // Walk backwards; find the most recent message that mentions me and that
    // we haven't already shown a banner for.
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.id === lastSeenIdRef.current) break;
      const pinged = (m.mentions || []).some(x =>
        (x.type === "external" && x.id === session.contactId)
      );
      if (pinged && m.senderType !== "external") {
        setPingedBanner({ messageId: m.id, from: m.senderName || "Someone" });
        // Title-bar nudge so they notice if the tab is in the background
        try {
          const original = document.title;
          document.title = `🔔 ${original}`;
          const restore = () => { document.title = original; window.removeEventListener("focus", restore); };
          window.addEventListener("focus", restore);
        } catch {}
        break;
      }
    }
    lastSeenIdRef.current = messages[messages.length - 1]?.id || null;
  }, [messages, session]);

  // Load the mention pool once we have a session
  useEffect(() => {
    if (authChecking || !session) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portal/mentions");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setMentionPool(data.mentions || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [authChecking, session]);

  // ─── SSE live updates ───────────────────────────────────────────
  useEffect(() => {
    if (authChecking || !session) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/portal/chat/stream");
      es.addEventListener("message", () => { reloadMessages(); });
      es.onerror = () => { /* browser auto-reconnects; nothing to do */ };
    } catch {}
    return () => { try { es?.close(); } catch {} };
  }, [authChecking, session, reloadMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [prompt]);

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_IMAGE_BYTES) {
        alert("Image is too large (max 2MB).");
        continue;
      }
      const buf = await f.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      setPendingAttachments(prev => [...prev, {
        type: "image",
        mime: f.type,
        source: "portal",
        url: `data:${f.type};base64,${base64}`,
        base64,
      }]);
    }
  };

  const removePendingAttachment = (idx: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const sendMessage = async () => {
    const text = prompt.trim();
    if ((!text && pendingAttachments.length === 0) || sending) return;

    setPrompt("");
    const attachmentsToSend = pendingAttachments;
    setPendingAttachments([]);
    setSending(true);

    try {
      const res = await fetch("/api/portal/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          attachments: attachmentsToSend.map(a => ({
            type: a.type, mime: a.mime, source: a.source,
            base64: a.base64, url: a.url,
          })),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Couldn't send message. Please try again.");
      }
      if (data?.capturedRequest) {
        setCapturedToast({ title: data.capturedRequest.title });
        setTimeout(() => setCapturedToast(null), 5000);
      }
      await reloadMessages();
    } catch {
      alert("Network error. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const filteredMentions = (() => {
    if (!mentionState.open) return [];
    const q = mentionState.query.toLowerCase();
    return mentionPool
      .filter(m => !q || m.name.toLowerCase().includes(q) || m.subtitle?.toLowerCase().includes(q))
      .slice(0, 6);
  })();

  const onPromptChange = (val: string) => {
    setPrompt(val);
    const cursor = textareaRef.current?.selectionStart ?? val.length;
    // Walk back from cursor to find an "@" with only word chars / dot / underscore after it.
    let i = cursor - 1;
    let found = -1;
    while (i >= 0) {
      const ch = val[i];
      if (ch === "@") { found = i; break; }
      if (/[a-zA-Z0-9._-]/.test(ch)) { i--; continue; }
      break;
    }
    if (found === -1 || (found > 0 && /[a-zA-Z0-9]/.test(val[found - 1] || ""))) {
      // No active @-trigger (or @ is part of an email-like token)
      setMentionState(s => ({ ...s, open: false }));
      return;
    }
    setMentionState({
      open: true,
      query: val.slice(found + 1, cursor),
      anchorIdx: found,
      activeIdx: 0,
    });
  };

  const insertMention = (option: { token: string; name: string }) => {
    if (mentionState.anchorIdx < 0) return;
    const cursor = textareaRef.current?.selectionStart ?? prompt.length;
    const before = prompt.slice(0, mentionState.anchorIdx);
    const after = prompt.slice(cursor);
    const inserted = `${option.token} `;
    const next = `${before}${inserted}${after}`;
    setPrompt(next);
    setMentionState({ open: false, query: "", anchorIdx: -1, activeIdx: 0 });
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = before.length + inserted.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionState.open && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionState(s => ({ ...s, activeIdx: Math.min(s.activeIdx + 1, filteredMentions.length - 1) }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionState(s => ({ ...s, activeIdx: Math.max(s.activeIdx - 1, 0) }));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentions[mentionState.activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setMentionState(s => ({ ...s, open: false }));
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const [menuOpen, setMenuOpen] = useState(false);

  const logout = async () => {
    setMenuOpen(false);
    if (!confirm("Sign out of this device?")) return;
    try { await fetch("/api/portal/auth/logout", { method: "POST" }); } catch {}
    router.push("/portal/expired");
  };

  const logoutAll = async () => {
    setMenuOpen(false);
    if (!confirm("Sign out of every device you've used? You'll need a new link to get back in on any of them.")) return;
    try { await fetch("/api/portal/auth/logout/all", { method: "POST" }); } catch {}
    router.push("/portal/expired");
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#0177b5]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl shadow-[#0177b5]/10 border border-slate-100 p-8 max-w-md w-full text-center">
          <p className="text-[13px] text-slate-600 mb-4">
            {loadError || "Couldn't load your conversation."}
          </p>
          <button
            onClick={() => location.reload()}
            className="px-4 py-2 rounded-xl bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white text-[12px] font-bold shadow-md shadow-[#0177b5]/30"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* HEADER */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0177b5] to-[#015a9c] flex items-center justify-center shadow-md shadow-[#0177b5]/30 shrink-0">
              <Heart className="w-4 h-4 text-white" fill="white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-black text-slate-800 tracking-tight truncate">ARIMA</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">
                {session.clientName} · Group chat
              </p>
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-[#0177b5] uppercase tracking-widest transition-colors"
              title="Account"
            >
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-100 rounded-xl shadow-xl z-20 py-1 text-left">
                  <button
                    onClick={logout}
                    className="w-full px-3 py-2 text-[12px] font-semibold text-slate-700 hover:bg-[#F0F4FC] flex items-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5 text-slate-500" />
                    Sign out of this device
                  </button>
                  <button
                    onClick={logoutAll}
                    className="w-full px-3 py-2 text-[12px] font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 border-t border-slate-50"
                    title="Use this if a device was lost or stolen"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-500" />
                    Sign out of all devices
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {pingedBanner && (
        <div className="sticky top-14 z-20 bg-gradient-to-r from-[#0177b5] to-[#015a9c] text-white py-1.5 px-4 sm:px-6 flex items-center justify-between gap-3 shadow-md">
          <p className="text-[12px] font-bold truncate">
            🔔 You were mentioned by {pingedBanner.from}
          </p>
          <button
            onClick={() => setPingedBanner(null)}
            className="text-[10px] font-black uppercase tracking-widest opacity-80 hover:opacity-100 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* MESSAGES */}
      <main className="flex-1 overflow-auto px-4 sm:px-6 py-4 pb-36">
        <div className="max-w-3xl mx-auto space-y-2">
          {loadingHistory && messages.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-[#0177b5]/60" />
            </div>
          )}

          {!loadingHistory && messages.length === 0 && (
            <EmptyState contactName={session.contactName} onPickSuggestion={s => setPrompt(s)} />
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} isMine={isMine(m, session.contactId)} />
          ))}

          {sending && (
            <div className="flex justify-start ml-9">
              <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm shadow-sm px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-[#0177b5] rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-[#0177b5] rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-[#0177b5] rounded-full animate-bounce" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* COMPOSER */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          {mentionState.open && filteredMentions.length > 0 && (
            <div className="mb-2 max-w-md ml-auto mr-auto bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              {filteredMentions.map((opt, i) => (
                <button
                  key={`${opt.type}:${opt.id}`}
                  onMouseDown={e => { e.preventDefault(); insertMention(opt); }}
                  onMouseEnter={() => setMentionState(s => ({ ...s, activeIdx: i }))}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                    i === mentionState.activeIdx ? "bg-[#F0F4FC]" : "hover:bg-slate-50"
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0 ${
                    opt.type === "arima"
                      ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c]"
                      : opt.type === "internal"
                        ? "bg-gradient-to-br from-indigo-400 to-blue-500"
                        : "bg-gradient-to-br from-emerald-400 to-teal-500"
                  }`}>
                    {opt.name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-bold text-slate-800 truncate">{opt.name}</p>
                    {opt.subtitle && (
                      <p className="text-[10px] text-slate-400 truncate">{opt.subtitle}</p>
                    )}
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-wider ${
                    opt.type === "arima" ? "text-[#0177b5]" :
                    opt.type === "internal" ? "text-indigo-500" : "text-emerald-500"
                  }`}>
                    {opt.type === "arima" ? "AI" : opt.type === "internal" ? "Team" : "Client"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {pendingAttachments.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              {pendingAttachments.map((a, i) => (
                <div key={i} className="relative shrink-0">
                  <img
                    src={a.url}
                    alt=""
                    className="h-16 w-16 object-cover rounded-lg border border-slate-200"
                  />
                  <button
                    onClick={() => removePendingAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 bg-slate-800 hover:bg-[#015a9c] text-white rounded-full p-0.5 shadow"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-3xl p-2 focus-within:border-[#0177b5]/40 transition-colors">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              title="Attach image"
              className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0177b5] hover:bg-[#F0F4FC] shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onFilePicked}
              className="hidden"
            />
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => onPromptChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message the group… (tip: type @ to mention someone)"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none outline-none border-none bg-transparent px-2 py-1.5 text-[14px] text-slate-700 placeholder:text-slate-300 max-h-[160px]"
            />
            <button
              onClick={sendMessage}
              disabled={sending || (!prompt.trim() && pendingAttachments.length === 0)}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 ${
                (prompt.trim() || pendingAttachments.length > 0) && !sending
                  ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white shadow-md shadow-[#0177b5]/30 hover:scale-105"
                  : "bg-slate-200 text-slate-400"
              }`}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center mt-1.5">
            Telegram + portal · ARIMA replies when you @arima
          </p>
        </div>
      </div>

      {/* CAPTURED-REQUEST TOAST */}
      {capturedToast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-white border border-emerald-200 rounded-2xl shadow-xl px-4 py-3 z-20 animate-in fade-in slide-in-from-bottom-3 duration-200 max-w-sm">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-0.5">
                Request received
              </p>
              <p className="text-[11px] font-bold text-slate-600 truncate" title={capturedToast.title}>
                {capturedToast.title}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Your account team has been notified.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isMine(m: Message, contactId: string): boolean {
  return m.senderType === "external";
}

function EmptyState({ contactName, onPickSuggestion }: { contactName: string; onPickSuggestion: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12">
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-[#0177b5] to-[#015a9c] flex items-center justify-center shadow-xl shadow-[#0177b5]/30 mb-4">
        <Heart className="w-8 h-8 text-white" fill="white" strokeWidth={1.5} />
      </div>
      <h2 className="text-lg font-black text-slate-800 mb-1">
        Hi {contactName.split(" ")[0]}!
      </h2>
      <p className="text-[13px] font-semibold text-slate-500 mb-5 max-w-sm">
        This is the shared group chat between you and our team. Type freely — your message reaches everyone (including our Telegram group). Mention <b>@arima</b> when you want the AI to step in.
      </p>
      <div className="flex flex-wrap gap-1.5 justify-center max-w-xs">
        {[
          "@arima what can you help with?",
          "Can we schedule a call?",
          "I'd like to share a screenshot",
        ].map(s => (
          <button
            key={s}
            onClick={() => onPickSuggestion(s)}
            className="px-3 py-1.5 rounded-full text-[10px] font-bold text-slate-600 bg-white border border-slate-200 hover:border-[#0177b5] hover:text-[#0177b5] transition-all flex items-center gap-1"
          >
            <Sparkles className="w-2.5 h-2.5 opacity-50" />
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ m, isMine }: { m: Message; isMine: boolean }) {
  const senderType = m.senderType || (m.role === "assistant" ? "arima" : "external");

  // Display content: strip the inline "[Name]: " speaker label we add server-side
  // so it doesn't appear twice (once in the header, once in the bubble text).
  const inlineNameMatch = m.content?.match(/^\[([^\]]+)\]:\s*([\s\S]*)/);
  const inlineName = inlineNameMatch?.[1] || null;
  const displayContent = inlineNameMatch ? inlineNameMatch[2] : m.content;

  // Sender name fallback: legacy messages may not have senderName populated yet;
  // derive from the inline prefix so they don't render as "Unknown".
  const name = m.senderName || inlineName || (senderType === "arima" ? "ARIMA" : "Someone");

  const avatarBg =
    senderType === "arima" ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c]" :
    senderType === "internal" ? "bg-gradient-to-br from-indigo-400 to-blue-500" :
    "bg-gradient-to-br from-emerald-400 to-teal-500";

  const roleLabel =
    senderType === "arima" ? "AI assistant" :
    senderType === "internal" ? "CST team member" :
    "Client";

  const initials = name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

  const timeStr = (() => {
    if (!m.createdAt) return "";
    try {
      const d = new Date(m.createdAt);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch { return ""; }
  })();

  return (
    <div className={`flex items-end gap-1.5 ${isMine ? "justify-end" : "justify-start"}`}>
      {!isMine && (
        <div
          className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-[10px] font-black shrink-0`}
          title={roleLabel}
        >
          {initials}
        </div>
      )}
      <div className={`max-w-[78%] flex flex-col ${isMine ? "items-end" : "items-start"}`}>
        <div className="flex items-center gap-1.5 mb-0.5 px-1">
          <span className="text-[10px] font-bold text-slate-600" title={roleLabel}>{name}</span>
          {m.senderChannel === "telegram" && (
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider" title="Sent from Telegram">via TG</span>
          )}
          {timeStr && (
            <span className="text-[10px] text-slate-300" title={m.createdAt}>· {timeStr}</span>
          )}
        </div>

        {m.attachments && m.attachments.length > 0 && (
          <div className="grid grid-cols-2 gap-1 mb-1 max-w-[280px]">
            {m.attachments.map((a, i) => (
              <ImageBubble key={i} attachment={a} />
            ))}
          </div>
        )}

        {displayContent && (
          <div
            className={`px-3.5 py-2 rounded-2xl text-[13.5px] leading-relaxed whitespace-pre-wrap break-words ${
              isMine
                ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white rounded-tr-sm shadow-md shadow-[#0177b5]/20"
                : senderType === "arima"
                  ? "bg-white border border-slate-100 text-slate-700 rounded-tl-sm shadow-sm"
                  : "bg-indigo-50 border border-indigo-100 text-slate-700 rounded-tl-sm"
            }`}
          >
            {renderWithMentions(displayContent)}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageBubble({ attachment }: { attachment: Attachment }) {
  const src = attachment.url
    || (attachment.base64 ? `data:${attachment.mime};base64,${attachment.base64}` : "");
  if (!src) return null;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      <img
        src={src}
        alt="attachment"
        className="w-full h-32 object-cover rounded-xl border border-slate-200 hover:opacity-90 transition-opacity"
      />
    </a>
  );
}

/** Highlight @mentions visually so the recipient sees a clear ping. */
// Render-side scrubber mirrors the server scrubToolNarration so legacy
// messages saved before Phase 17 (with the JSON dumps + "I'll now use X"
// narration) display cleanly without us touching the DB.
const KNOWN_TOOLS = [
  "get_client_profile", "get_recent_meetings", "get_account_intelligence",
  "schedule_meeting", "create_request", "search_meetings",
  "list_open_requests", "send_check_in",
];
function scrubForDisplay(text: string): string {
  if (!text) return text;
  let out = text;
  const escaped = KNOWN_TOOLS.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const toolToken = `(?:\`)?(?:${escaped.join("|")})(?:\`)?`;
  // Fenced blocks with tool names as labels
  out = out.replace(new RegExp("```(?:" + escaped.join("|") + ")[^`]*```", "gi"), "");
  // Fenced JSON / pure-JSON-body blocks
  out = out.replace(/```[a-zA-Z_-]*\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/g, "");
  out = out.replace(/```json[\s\S]*?```/gi, "");
  // Mid-sentence references
  out = out.replace(new RegExp(`\\bI'?(?:ll|m going to) (?:now )?(?:use|call|invoke|run|fire|trigger) (?:the )?${toolToken}(?: tool)?\\b`, "gi"), "Let me check");
  out = out.replace(new RegExp(`\\b(?:using|via|through|with) (?:the )?${toolToken}(?: tool)?\\b`, "gi"), "");
  out = out.replace(new RegExp(`\\bI(?:'ll)? need to (?:use|call|invoke|run) (?:the )?${toolToken}(?: tool)?\\b`, "gi"), "Let me check");
  out = out.replace(new RegExp(`\\b(?:the )?\`(?:${escaped.join("|")})\`(?: tool)?`, "gi"), "");
  out = out.replace(/`[a-z][a-z0-9_]*_[a-z0-9_]+`/g, "");
  // Filler lines
  const filler = [
    /^\s*I'?ll (now )?(?:use|invoke|call|fetch.*using|attempt to call|check via|need to)\b.*$/gim,
    /^\s*Let me (?:check|verify|fetch|look up|pull|grab|see).{0,80}(?:result|details|history|status)?\.?\s*$/gim,
    /^\s*I'?(?:ve|m) (?:attempting|going to) (?:to )?(?:call|invoke|use|run)\b.*$/gim,
    /^\s*I'?ve attempted to .*$/gim,
    /^\s*using the [`']?[a-zA-Z_]+[`']?(?: tool)?\.?\s*$/gim,
    /^\s*To give you (?:an? )?(?:overview|summary|view|look)(?: of [^,]+)?, I'?ll .*$/gim,
  ];
  for (const re of filler) out = out.replace(re, "");
  out = out.replace(/\s+\(\s*\)/g, "");
  out = out.replace(/``\s*``/g, "");
  out = out.replace(/[ \t]+([.,;!?])/g, "$1");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * Tiny, intentionally-limited markdown renderer for chat bubbles.
 * Supports: fenced code blocks (```), inline code (`x`), **bold**, *italic*,
 * autolinks for http/https, and @mentions. No HTML, no XSS surface — everything
 * goes through React text nodes / explicit element wrappers.
 */
function renderWithMentions(text: string): React.ReactNode {
  text = scrubForDisplay(text);
  if (!text) return text;
  const blocks: React.ReactNode[] = [];
  let idx = 0;
  const fenceRe = /```([a-zA-Z_-]*)\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let bidx = 0;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > idx) blocks.push(<span key={`p${bidx++}`}>{renderInline(text.slice(idx, m.index))}</span>);
    const lang = m[1] || "";
    blocks.push(
      <pre key={`code${bidx++}`} className="my-2 rounded-lg bg-slate-900 text-slate-100 text-[11.5px] font-mono leading-relaxed overflow-x-auto px-3 py-2">
        {lang && <div className="text-[9px] uppercase tracking-widest text-slate-400 mb-1">{lang}</div>}
        <code>{m[2].replace(/\n+$/, "")}</code>
      </pre>
    );
    idx = fenceRe.lastIndex;
  }
  if (idx < text.length) blocks.push(<span key={`tail${bidx++}`}>{renderInline(text.slice(idx))}</span>);
  return blocks.length > 0 ? <>{blocks}</> : text;
}

function renderInline(text: string): React.ReactNode {
  // Token grammar order: inline code → bold → italic → links → mentions → plain text.
  // We use a single regex with alternation and walk the matches in order.
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|https?:\/\/[^\s)]+|@\[[^\]]+\]\((?:user|contact):[^)]+\)|@[a-zA-Z0-9_.-]+)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`") && t.endsWith("`")) {
      out.push(<code key={`i${k++}`} className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-[12px] font-mono">{t.slice(1, -1)}</code>);
    } else if (t.startsWith("**") && t.endsWith("**")) {
      out.push(<strong key={`i${k++}`}>{t.slice(2, -2)}</strong>);
    } else if (t.startsWith("*") && t.endsWith("*")) {
      out.push(<em key={`i${k++}`}>{t.slice(1, -1)}</em>);
    } else if (t.startsWith("http")) {
      out.push(<a key={`i${k++}`} href={t} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 text-[#0177b5]">{t}</a>);
    } else if (t.startsWith("@[")) {
      // Portal mention token: @[Name](user:id) — show as styled chip
      const inner = t.match(/^@\[([^\]]+)\]/)?.[1] || t;
      out.push(<span key={`i${k++}`} className="font-bold text-[#0177b5]">@{inner}</span>);
    } else if (t.startsWith("@")) {
      out.push(<span key={`i${k++}`} className="font-bold underline decoration-dotted underline-offset-2">{t}</span>);
    } else {
      out.push(t);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length > 0 ? <>{out}</> : text;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  // btoa works on binary strings
  return typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}
