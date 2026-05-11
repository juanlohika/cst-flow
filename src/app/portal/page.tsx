"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Heart, ArrowUp, Loader2, Sparkles, LogOut, Building2, CheckCircle2,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  id?: string;
}

interface PortalSession {
  contactId: string;
  contactName: string;
  contactEmail: string;
  clientProfileId: string;
  clientName: string;
  clientCode: string | null;
}

export default function PortalChatPage() {
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [capturedToast, setCapturedToast] = useState<{ title: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Auth check + history load ───────────────────────────────────
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
        const msgs: Message[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }));
        setMessages(msgs);
      } catch {
        router.push("/portal/expired");
      } finally {
        setAuthChecking(false);
        setLoadingHistory(false);
      }
    }
    init();
  }, [router]);

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

  const sendMessage = async () => {
    const text = prompt.trim();
    if (!text || sending) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setPrompt("");
    setSending(true);

    try {
      const res = await fetch("/api/portal/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages([
          ...newMessages,
          { role: "assistant", content: `⚠️ ${data.error || "Couldn't send message. Please try again."}` },
        ]);
      } else {
        setMessages([...newMessages, { role: "assistant", content: data.content }]);
        if (data.capturedRequest) {
          setCapturedToast({ title: data.capturedRequest.title });
          setTimeout(() => setCapturedToast(null), 5000);
        }
      }
    } catch (err: any) {
      setMessages([
        ...newMessages,
        { role: "assistant", content: `⚠️ Network error. Check your connection and try again.` },
      ]);
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
    try {
      await fetch("/api/portal/auth/logout", { method: "POST" });
    } catch {}
    router.push("/portal/expired");
  };

  if (authChecking || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* HEADER */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-md shadow-rose-500/30 shrink-0">
              <Heart className="w-4 h-4 text-white" fill="white" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-black text-slate-800 tracking-tight truncate">ARIMA</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">
                {session.clientName}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-rose-500 uppercase tracking-widest transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3 h-3" />
            Sign out
          </button>
        </div>
      </header>

      {/* MESSAGES */}
      <main className="flex-1 overflow-auto px-4 sm:px-6 py-4 pb-32">
        <div className="max-w-3xl mx-auto space-y-3">
          {loadingHistory && messages.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-rose-300" />
            </div>
          )}

          {!loadingHistory && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-xl shadow-rose-500/30 mb-4">
                <Heart className="w-8 h-8 text-white" fill="white" />
              </div>
              <h2 className="text-lg font-black text-slate-800 mb-1">
                Hi {session.contactName.split(" ")[0]}!
              </h2>
              <p className="text-[13px] font-semibold text-slate-500 mb-5 max-w-sm">
                I'm ARIMA — your AI Relationship Manager. I can capture requests, schedule meetings, and answer general questions. A human teammate is always behind me for anything sensitive.
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center max-w-xs">
                {[
                  "What can you help me with?",
                  "Can we schedule a call?",
                  "I'd like to request a change",
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => setPrompt(s)}
                    className="px-3 py-1.5 rounded-full text-[10px] font-bold text-slate-600 bg-white border border-slate-200 hover:border-rose-300 hover:text-rose-600 transition-all flex items-center gap-1"
                  >
                    <Sparkles className="w-2.5 h-2.5 opacity-50" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            // Strip the "[Name]: " prefix the API adds before sending to AI
            const display = m.role === "user"
              ? m.content.replace(/^\[[^\]]+\]:\s*/, "")
              : m.content;

            return (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-rose-500 to-pink-500 text-white rounded-tr-sm shadow-md shadow-rose-500/20"
                      : "bg-white border border-slate-100 text-slate-700 rounded-tl-sm shadow-sm"
                  }`}
                >
                  {display}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm shadow-sm px-4 py-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* COMPOSER */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-3xl p-2 focus-within:border-rose-300 transition-colors">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message ARIMA…"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none outline-none border-none bg-transparent px-2 py-1.5 text-[14px] text-slate-700 placeholder:text-slate-300 max-h-[160px]"
            />
            <button
              onClick={sendMessage}
              disabled={sending || !prompt.trim()}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 ${
                prompt.trim() && !sending
                  ? "bg-gradient-to-br from-rose-400 to-pink-500 text-white shadow-md shadow-rose-500/30 hover:scale-105"
                  : "bg-slate-200 text-slate-400"
              }`}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center mt-1.5">
            ARIMA is AI · A human follows up on sensitive matters
          </p>
        </div>
      </div>

      {/* CAPTURED-REQUEST TOAST */}
      {capturedToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white border border-emerald-200 rounded-2xl shadow-xl px-4 py-3 z-20 animate-in fade-in slide-in-from-bottom-3 duration-200 max-w-sm">
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
