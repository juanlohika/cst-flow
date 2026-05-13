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

  const reloadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/chat");
      if (!res.ok) return;
      const data = await res.json();
      if (data.session) setSession(data.session);
      setMessages((data.messages || []) as Message[]);
    } catch {}
  }, []);

  // ─── Auth check + initial history ───────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/portal/chat");
        if (!res.ok) {
          router.push("/portal/expired");
          return;
        }
        const data = await res.json();
        setSession(data.session);
        setMessages((data.messages || []) as Message[]);
      } catch {
        router.push("/portal/expired");
      } finally {
        setAuthChecking(false);
        setLoadingHistory(false);
      }
    }
    init();
  }, [router]);

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const logout = async () => {
    if (!confirm("Sign out of ARIMA?")) return;
    try { await fetch("/api/portal/auth/logout", { method: "POST" }); } catch {}
    router.push("/portal/expired");
  };

  if (authChecking || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#0177b5]" />
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
          <button
            onClick={logout}
            className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-[#0177b5] uppercase tracking-widest transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3 h-3" />
            Sign out
          </button>
        </div>
      </header>

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
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message the group… (tip: type @arima to ping the AI)"
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
  const name = m.senderName || (senderType === "arima" ? "ARIMA" : "Unknown");

  const avatarBg =
    senderType === "arima" ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c]" :
    senderType === "internal" ? "bg-gradient-to-br from-indigo-400 to-blue-500" :
    "bg-gradient-to-br from-emerald-400 to-teal-500";

  const chip =
    senderType === "arima" ? { label: "ARIMA", color: "text-[#0177b5] bg-[#F0F4FC] border-[#0177b5]/20" } :
    senderType === "internal" ? { label: "Team", color: "text-indigo-600 bg-indigo-50 border-indigo-100" } :
    { label: "Client", color: "text-emerald-600 bg-emerald-50 border-emerald-100" };

  const initials = name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <div className={`flex items-end gap-1.5 ${isMine ? "justify-end" : "justify-start"}`}>
      {!isMine && (
        <div className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-[10px] font-black shrink-0`}>
          {initials}
        </div>
      )}
      <div className={`max-w-[78%] flex flex-col ${isMine ? "items-end" : "items-start"}`}>
        <div className="flex items-center gap-1.5 mb-0.5 px-1">
          <span className="text-[10px] font-bold text-slate-500">{name}</span>
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border ${chip.color}`}>
            {chip.label}
          </span>
          {m.senderChannel === "telegram" && (
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider" title="Sent from Telegram">via TG</span>
          )}
        </div>

        {m.attachments && m.attachments.length > 0 && (
          <div className="grid grid-cols-2 gap-1 mb-1 max-w-[280px]">
            {m.attachments.map((a, i) => (
              <ImageBubble key={i} attachment={a} />
            ))}
          </div>
        )}

        {m.content && (
          <div
            className={`px-3.5 py-2 rounded-2xl text-[13.5px] leading-relaxed whitespace-pre-wrap break-words ${
              isMine
                ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white rounded-tr-sm shadow-md shadow-[#0177b5]/20"
                : senderType === "arima"
                  ? "bg-white border border-slate-100 text-slate-700 rounded-tl-sm shadow-sm"
                  : "bg-indigo-50 border border-indigo-100 text-slate-700 rounded-tl-sm"
            }`}
          >
            {renderWithMentions(m.content)}
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
function renderWithMentions(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(@[a-zA-Z0-9_.-]+)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(
      <span key={m.index} className="font-bold underline decoration-dotted underline-offset-2">{m[1]}</span>
    );
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : text;
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
