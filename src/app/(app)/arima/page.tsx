"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Heart, ArrowUp, Loader2, Sparkles, Plus, MessageCircle,
  Trash2, Inbox, MessageSquare, Search,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface Message {
  role: "user" | "model" | "assistant";
  content: string;
}

interface ConversationListItem {
  id: string;
  title: string | null;
  status: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  channel: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  clientName?: string | null;
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

  const isAdmin = (session?.user as any)?.role === "admin";

  const [view, setView] = useState<"chat" | "inbox">("chat");

  // CHAT view state
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingConvList, setLoadingConvList] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // INBOX view state
  const [inboxConvs, setInboxConvs] = useState<ConversationListItem[]>([]);
  const [inboxSelected, setInboxSelected] = useState<ConversationListItem | null>(null);
  const [inboxMessages, setInboxMessages] = useState<any[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxSearch, setInboxSearch] = useState("");

  // ─── Conversation list (mine) ────────────────────────────────────
  const fetchMyConversations = useCallback(async () => {
    setLoadingConvList(true);
    try {
      const res = await fetch("/api/arima/conversations?scope=mine");
      if (res.ok) {
        const data = await res.json();
        setConversations(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load conversations", err);
    } finally {
      setLoadingConvList(false);
    }
  }, []);

  useEffect(() => {
    fetchMyConversations();
  }, [fetchMyConversations]);

  // ─── Load a specific conversation's messages ─────────────────────
  const loadConversation = async (id: string) => {
    setLoadingConv(true);
    setActiveConvId(id);
    try {
      const res = await fetch(`/api/arima/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        const msgs: Message[] = (data.messages || []).map((m: any) => ({
          role: m.role === "assistant" ? "model" : (m.role === "user" ? "user" : "model"),
          content: m.content,
        }));
        setMessages(msgs);
      }
    } catch (err) {
      console.error("Failed to load conversation", err);
    } finally {
      setLoadingConv(false);
    }
  };

  // ─── Auto-scroll + textarea autosize ─────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  // ─── New chat ────────────────────────────────────────────────────
  const newChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setPrompt("");
  };

  // ─── Send a message ──────────────────────────────────────────────
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
        body: JSON.stringify({
          messages: newMessages,
          conversationId: activeConvId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages([
          ...newMessages,
          { role: "model", content: `**Error:** ${data.error || "Failed to generate a response."}` },
        ]);
      } else {
        setMessages([...newMessages, { role: "model", content: data.content }]);
        if (!activeConvId && data.conversationId) {
          setActiveConvId(data.conversationId);
        }
        // Refresh the list so the new title/lastMessageAt is reflected
        fetchMyConversations();
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

  // ─── Delete a conversation ───────────────────────────────────────
  const deleteConversation = async (id: string) => {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/arima/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (activeConvId === id) newChat();
        fetchMyConversations();
      }
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  };

  // ─── INBOX (admin) ───────────────────────────────────────────────
  const fetchInbox = useCallback(async () => {
    if (!isAdmin) return;
    setInboxLoading(true);
    try {
      const res = await fetch("/api/arima/conversations?scope=team");
      if (res.ok) {
        const data = await res.json();
        setInboxConvs(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load inbox", err);
    } finally {
      setInboxLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (view === "inbox") fetchInbox();
  }, [view, fetchInbox]);

  const openInboxConv = async (conv: ConversationListItem) => {
    setInboxSelected(conv);
    setInboxMessages([]);
    try {
      const res = await fetch(`/api/arima/conversations/${conv.id}`);
      if (res.ok) {
        const data = await res.json();
        setInboxMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Failed to load inbox conv", err);
    }
  };

  const filteredInbox = inboxConvs.filter(c => {
    const q = inboxSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.title || "").toLowerCase().includes(q) ||
      (c.ownerName || "").toLowerCase().includes(q) ||
      (c.ownerEmail || "").toLowerCase().includes(q) ||
      (c.clientName || "").toLowerCase().includes(q)
    );
  });

  const userName = session?.user?.name?.split(" ")[0] || "there";
  const formatTime = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return d.toLocaleDateString();
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-rose-50/30 via-white to-white">
      {/* Header with view tabs */}
      <div className="px-6 sm:px-8 pt-5 pb-2 border-b border-slate-100 flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/30">
            <Heart className="w-5 h-5 text-white" fill="white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-800 tracking-tight">ARIMA</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              AI Relationship Manager · Phase 2
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-100/60 p-1 rounded-xl">
          <button
            onClick={() => setView("chat")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
              view === "chat" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            Chat
          </button>
          {isAdmin && (
            <button
              onClick={() => setView("inbox")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                view === "inbox" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Inbox className="w-3 h-3" />
              Inbox
            </button>
          )}
        </div>
      </div>

      {view === "chat" ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar: conversation list */}
          <aside className="w-64 shrink-0 border-r border-slate-100 bg-white/60 flex flex-col">
            <div className="p-3 border-b border-slate-100">
              <button
                onClick={newChat}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-br from-rose-400 to-pink-500 text-white text-[11px] font-black uppercase tracking-widest shadow-sm shadow-rose-500/30 hover:scale-[1.02] transition-transform"
              >
                <Plus className="w-3.5 h-3.5" />
                New Chat
              </button>
            </div>

            <div className="flex-1 overflow-auto thin-scrollbar px-2 py-2">
              {loadingConvList && conversations.length === 0 && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
                </div>
              )}
              {!loadingConvList && conversations.length === 0 && (
                <div className="text-center py-8 px-4">
                  <MessageCircle className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    No conversations yet
                  </p>
                </div>
              )}
              <div className="space-y-1">
                {conversations.map(conv => {
                  const active = conv.id === activeConvId;
                  return (
                    <div
                      key={conv.id}
                      className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                        active ? "bg-rose-50" : "hover:bg-slate-50"
                      }`}
                      onClick={() => loadConversation(conv.id)}
                    >
                      <MessageCircle
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? "text-rose-500" : "text-slate-300"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-[11px] font-bold truncate ${
                            active ? "text-rose-700" : "text-slate-700"
                          }`}
                          title={conv.title || "Untitled"}
                        >
                          {conv.title || "Untitled"}
                        </p>
                        <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                          {formatTime(conv.lastMessageAt)} · {conv.messageCount} msgs
                        </p>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-300 hover:text-red-500"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Chat surface */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
              <div className="max-w-3xl mx-auto space-y-4">
                {messages.length === 0 && !loadingConv && (
                  <div className="flex flex-col items-center justify-center text-center py-16">
                    <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-xl shadow-rose-500/30 mb-4">
                      <Heart className="w-8 h-8 text-white" fill="white" />
                    </div>
                    <h2 className="text-xl font-black text-slate-800 mb-1">
                      Hi {userName}, I'm ARIMA.
                    </h2>
                    <p className="text-sm font-semibold text-slate-500 mb-6 max-w-md">
                      Your AI Relationship Manager. I help with check-ins, capturing
                      requests, and coordinating with your CST team. A human teammate is
                      always behind me for anything sensitive.
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

                {loadingConv && (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-5 h-5 animate-spin text-rose-400" />
                  </div>
                )}

                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
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
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ArrowUp className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center mt-2">
                  ARIMA is an AI · For sensitive matters, a human teammate will follow up
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* INBOX VIEW (admin) */
        <div className="flex-1 flex overflow-hidden">
          {/* Inbox list */}
          <div className="w-80 shrink-0 border-r border-slate-100 bg-white/60 flex flex-col">
            <div className="p-3 border-b border-slate-100">
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                <Search className="w-3.5 h-3.5 text-slate-300" />
                <input
                  value={inboxSearch}
                  onChange={e => setInboxSearch(e.target.value)}
                  placeholder="Search conversations..."
                  className="flex-1 bg-transparent text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto thin-scrollbar px-2 py-2">
              {inboxLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
                </div>
              )}
              {!inboxLoading && filteredInbox.length === 0 && (
                <div className="text-center py-12 px-4">
                  <Inbox className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    No conversations yet
                  </p>
                </div>
              )}
              <div className="space-y-1">
                {filteredInbox.map(conv => {
                  const active = conv.id === inboxSelected?.id;
                  return (
                    <button
                      key={conv.id}
                      onClick={() => openInboxConv(conv)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        active ? "bg-rose-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <p
                        className={`text-[11px] font-bold truncate mb-0.5 ${
                          active ? "text-rose-700" : "text-slate-700"
                        }`}
                        title={conv.title || "Untitled"}
                      >
                        {conv.title || "Untitled"}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[9px] font-semibold text-slate-500 truncate">
                          {conv.ownerName || conv.ownerEmail || "unknown user"}
                          {conv.clientName ? ` · ${conv.clientName}` : ""}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
                          {formatTime(conv.lastMessageAt)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Inbox detail */}
          <div className="flex-1 overflow-auto">
            {!inboxSelected ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-8">
                <Inbox className="w-12 h-12 text-slate-200 mb-3" />
                <p className="text-sm font-bold text-slate-500 mb-1">Select a conversation</p>
                <p className="text-[11px] font-semibold text-slate-400 max-w-sm">
                  Review what your team and clients have been discussing with ARIMA.
                </p>
              </div>
            ) : (
              <div className="px-6 sm:px-8 py-6 max-w-3xl mx-auto">
                <div className="mb-5">
                  <h2 className="text-base font-black text-slate-800 tracking-tight mb-1">
                    {inboxSelected.title || "Untitled"}
                  </h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {inboxSelected.ownerName || inboxSelected.ownerEmail}
                    {inboxSelected.clientName ? ` · ${inboxSelected.clientName}` : ""}
                    {" · "}
                    {inboxSelected.channel} · {inboxSelected.messageCount} msgs
                  </p>
                </div>
                <div className="space-y-3">
                  {inboxMessages.map((m: any) => (
                    <div
                      key={m.id}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          m.role === "user"
                            ? "bg-slate-900 text-white rounded-tr-sm"
                            : "bg-white border border-slate-100 text-slate-700 rounded-tl-sm"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
