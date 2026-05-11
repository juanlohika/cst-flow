"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Heart, ArrowUp, Loader2, Sparkles } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface Message {
  role: "user" | "model";
  content: string;
}

export default function ArimaPage() {
  return (
    <AuthGuard>
      <ArimaContent />
    </AuthGuard>
  );
}

function ArimaContent() {
  const { data: session } = useSession();
  useBreadcrumbs([{ label: "AI Intelligence" }, { label: "ARIMA" }]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  const sendMessage = async () => {
    const text = prompt.trim();
    if (!text || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setPrompt("");
    setLoading(true);

    try {
      const res = await fetch("/api/arima/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages([
          ...newMessages,
          { role: "model", content: `**Error:** ${data.error || "Failed to generate a response."}` },
        ]);
      } else {
        setMessages([...newMessages, { role: "model", content: data.content }]);
      }
    } catch (err: any) {
      setMessages([
        ...newMessages,
        { role: "model", content: `**Network error:** ${err.message || "Please try again."}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const userName = session?.user?.name?.split(" ")[0] || "there";

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-rose-50/30 via-white to-white">
      {/* Header */}
      <div className="px-8 pt-6 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/30">
            <Heart className="w-5 h-5 text-white" fill="white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-800 tracking-tight">ARIMA</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              AI Relationship Manager · Phase 1 Preview
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-20">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-xl shadow-rose-500/30 mb-4">
                <Heart className="w-8 h-8 text-white" fill="white" />
              </div>
              <h2 className="text-xl font-black text-slate-800 mb-1">Hi {userName}, I'm ARIMA.</h2>
              <p className="text-sm font-semibold text-slate-500 mb-6 max-w-md">
                Your AI Relationship Manager. I help with check-ins, capturing requests,
                and coordinating with your CST team. A human teammate is always behind me
                for anything sensitive.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-xl">
                {[
                  "Walk me through what you do",
                  "What can you help me with?",
                  "Tell me about Tarkie",
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => setPrompt(suggestion)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:border-rose-300 hover:text-rose-600 transition-all flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3 h-3 opacity-50" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-slate-900 text-white rounded-tr-sm shadow-sm"
                    : "bg-white border border-slate-100 text-slate-700 rounded-tl-sm shadow-sm"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
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
      </div>

      {/* Composer */}
      <div className="px-4 sm:px-8 pb-6 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 bg-white border border-slate-200 rounded-3xl shadow-sm p-2 focus-within:border-rose-300 transition-colors">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message ARIMA..."
              rows={1}
              disabled={loading}
              className="flex-1 resize-none outline-none border-none bg-transparent px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300 max-h-[200px]"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !prompt.trim()}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 ${
                prompt.trim() && !loading
                  ? "bg-gradient-to-br from-rose-400 to-pink-500 text-white shadow-md shadow-rose-500/30 hover:scale-105"
                  : "bg-slate-100 text-slate-300"
              }`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center mt-2">
            ARIMA is an AI · For sensitive matters, a human teammate will follow up
          </p>
        </div>
      </div>
    </div>
  );
}
