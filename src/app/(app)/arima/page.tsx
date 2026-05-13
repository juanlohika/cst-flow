"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Heart, ArrowUp, Loader2, Sparkles, Plus, MessageCircle,
  Trash2, Inbox, MessageSquare, Search, Building2, X, ChevronDown,
  ClipboardList, AlertCircle, CheckCircle2, Clock, Tag, Filter, Settings,
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
  clientProfileId?: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  clientName?: string | null;
}

interface Account {
  id: string;
  companyName: string;
  industry: string;
  engagementStatus: string;
  clientCode?: string | null;
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

  const [view, setView] = useState<"chat" | "inbox" | "requests">("chat");

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

  // Account picker
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const accountPickerRef = useRef<HTMLDivElement>(null);

  // INBOX view state
  const [inboxConvs, setInboxConvs] = useState<ConversationListItem[]>([]);
  const [inboxSelected, setInboxSelected] = useState<ConversationListItem | null>(null);
  const [inboxMessages, setInboxMessages] = useState<any[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxSearch, setInboxSearch] = useState("");

  // REQUESTS view state
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsSearch, setRequestsSearch] = useState("");
  const [requestsStatus, setRequestsStatus] = useState<string>("all");
  const [requestsPriority, setRequestsPriority] = useState<string>("all");
  const [requestsCategory, setRequestsCategory] = useState<string>("all");
  const [requestsScope, setRequestsScope] = useState<"mine" | "team">("mine");
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [selectedRequestDetail, setSelectedRequestDetail] = useState<any | null>(null);
  const [lastCapturedRequest, setLastCapturedRequest] = useState<any | null>(null);

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

  // Load accounts list once
  useEffect(() => {
    fetch("/api/accounts")
      .then(r => (r.ok ? r.json() : []))
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]));
  }, []);

  // Close account picker on outside click
  useEffect(() => {
    if (!accountPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (accountPickerRef.current && !accountPickerRef.current.contains(e.target as Node)) {
        setAccountPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [accountPickerOpen]);

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
        setSelectedClientId(data.conversation?.clientProfileId || null);
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
    setSelectedClientId(null);
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
          clientProfileId: selectedClientId || undefined,
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
        // If ARIMA captured a request, surface it
        if (data.capturedRequest) {
          setLastCapturedRequest(data.capturedRequest);
          setTimeout(() => setLastCapturedRequest(null), 6000);
        }
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

  // ─── REQUESTS ────────────────────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("scope", requestsScope);
      if (requestsStatus !== "all") params.set("status", requestsStatus);
      if (requestsPriority !== "all") params.set("priority", requestsPriority);
      if (requestsCategory !== "all") params.set("category", requestsCategory);
      if (requestsSearch.trim()) params.set("search", requestsSearch.trim());
      const res = await fetch(`/api/arima/requests?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load requests", err);
    } finally {
      setRequestsLoading(false);
    }
  }, [requestsScope, requestsStatus, requestsPriority, requestsCategory, requestsSearch]);

  useEffect(() => {
    if (view === "requests") fetchRequests();
  }, [view, fetchRequests]);

  const openRequest = async (r: any) => {
    setSelectedRequest(r);
    setSelectedRequestDetail(null);
    try {
      const res = await fetch(`/api/arima/requests/${r.id}`);
      if (res.ok) setSelectedRequestDetail(await res.json());
    } catch (err) {
      console.error("Failed to load request detail", err);
    }
  };

  const updateRequestField = async (id: string, patch: Record<string, any>) => {
    try {
      const res = await fetch(`/api/arima/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        // Update local copies so UI reflects change instantly
        setRequests(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)));
        if (selectedRequest?.id === id) setSelectedRequest((prev: any) => ({ ...prev, ...patch }));
        if (selectedRequestDetail?.request?.id === id) {
          setSelectedRequestDetail((prev: any) => ({
            ...prev,
            request: { ...prev.request, ...patch },
          }));
        }
      }
    } catch (err) {
      console.error("Failed to update request", err);
    }
  };

  const deleteRequest = async (id: string) => {
    if (!confirm("Delete this request? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/arima/requests/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRequests(prev => prev.filter(x => x.id !== id));
        if (selectedRequest?.id === id) {
          setSelectedRequest(null);
          setSelectedRequestDetail(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete request", err);
    }
  };

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
          <button
            onClick={() => setView("requests")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
              view === "requests" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <ClipboardList className="w-3 h-3" />
            Requests
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
          <a
            href="/arima/notifications"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100/60 transition-all"
            title="Notification settings"
            aria-label="Notification settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Captured-request toast */}
      {lastCapturedRequest && view === "chat" && (
        <div className="fixed bottom-24 right-6 z-[200] bg-white border border-emerald-200 rounded-2xl shadow-xl px-4 py-3 animate-in fade-in slide-in-from-bottom-3 duration-200 max-w-sm">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-0.5">
                Request captured
              </p>
              <p className="text-[11px] font-bold text-slate-600 truncate" title={lastCapturedRequest.title}>
                {lastCapturedRequest.title}
              </p>
              <button
                onClick={() => setView("requests")}
                className="mt-1 text-[10px] font-black text-emerald-700 hover:text-emerald-800 uppercase tracking-widest"
              >
                View in Requests →
              </button>
            </div>
            <button onClick={() => setLastCapturedRequest(null)} className="text-slate-300 hover:text-slate-500">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

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
                        {conv.clientName && (
                          <p className="text-[9px] font-bold text-rose-500/80 truncate flex items-center gap-0.5">
                            <Building2 className="w-2.5 h-2.5" />
                            {conv.clientName}
                          </p>
                        )}
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
                {/* Client account picker */}
                <div className="flex items-center justify-center mb-2">
                  <div className="relative" ref={accountPickerRef}>
                    <button
                      onClick={() => setAccountPickerOpen(o => !o)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${
                        selectedClientId
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                      }`}
                      title="Select the client this conversation is about"
                    >
                      <Building2 className="w-3 h-3" />
                      <span className="max-w-[240px] truncate">
                        {(() => {
                          if (!selectedClientId) return "No client linked";
                          const a = accounts.find(a => a.id === selectedClientId);
                          if (!a) return "Unknown";
                          return a.clientCode ? `${a.clientCode} · ${a.companyName}` : a.companyName;
                        })()}
                      </span>
                      {selectedClientId && (
                        <span
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedClientId(null);
                          }}
                          className="ml-0.5 text-rose-400 hover:text-rose-700"
                        >
                          <X className="w-3 h-3" />
                        </span>
                      )}
                      {!selectedClientId && <ChevronDown className="w-3 h-3 opacity-50" />}
                    </button>

                    {accountPickerOpen && (
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden">
                        <div className="p-2 border-b border-slate-100">
                          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-2 py-1.5">
                            <Search className="w-3 h-3 text-slate-300" />
                            <input
                              autoFocus
                              value={accountSearch}
                              onChange={e => setAccountSearch(e.target.value)}
                              placeholder="Search accounts..."
                              className="flex-1 bg-transparent text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none"
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-auto thin-scrollbar py-1">
                          <button
                            onClick={() => {
                              setSelectedClientId(null);
                              setAccountPickerOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-[11px] font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                          >
                            No client (general chat)
                          </button>
                          {accounts
                            .filter(a => {
                              const q = accountSearch.trim().toLowerCase();
                              if (!q) return true;
                              return (
                                a.companyName.toLowerCase().includes(q) ||
                                a.industry?.toLowerCase().includes(q) ||
                                (a.clientCode || "").toLowerCase().includes(q)
                              );
                            })
                            .map(a => (
                              <button
                                key={a.id}
                                onClick={() => {
                                  setSelectedClientId(a.id);
                                  setAccountPickerOpen(false);
                                  setAccountSearch("");
                                }}
                                className={`w-full text-left px-3 py-2 transition-colors ${
                                  a.id === selectedClientId
                                    ? "bg-rose-50"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p
                                    className={`text-[11px] font-bold truncate ${
                                      a.id === selectedClientId ? "text-rose-700" : "text-slate-700"
                                    }`}
                                  >
                                    {a.companyName}
                                  </p>
                                  {a.clientCode && (
                                    <span className="text-[9px] font-black tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                                      {a.clientCode}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">
                                  {a.industry} · {a.engagementStatus}
                                </p>
                              </button>
                            ))}
                          {accounts.length === 0 && (
                            <div className="px-3 py-6 text-center">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                                No accounts available
                              </p>
                              <p className="text-[10px] font-semibold text-slate-400 normal-case tracking-normal">
                                Ask an admin to grant you access to a client account, or create one yourself.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

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
      ) : view === "inbox" ? (
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
                  {inboxMessages.map((m: any) => {
                    const senderType: string = m.senderType || (m.role === "assistant" ? "arima" : "external");
                    const senderName: string = m.senderName || (senderType === "arima" ? "ARIMA" : "Unknown");
                    const isLeftSide = senderType !== "external"; // internal + arima on the left
                    const chip =
                      senderType === "arima" ? { label: "ARIMA", color: "text-rose-600 bg-rose-50 border-rose-100" } :
                      senderType === "internal" ? { label: "Team", color: "text-indigo-600 bg-indigo-50 border-indigo-100" } :
                      { label: "Client", color: "text-emerald-600 bg-emerald-50 border-emerald-100" };
                    let attachments: any[] = [];
                    try { attachments = m.attachments ? JSON.parse(m.attachments) : []; } catch {}
                    return (
                      <div key={m.id} className={`flex ${isLeftSide ? "justify-start" : "justify-end"}`}>
                        <div className={`max-w-[80%] flex flex-col ${isLeftSide ? "items-start" : "items-end"}`}>
                          <div className="flex items-center gap-1.5 mb-1 px-1">
                            <span className="text-[11px] font-bold text-slate-600">{senderName}</span>
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border ${chip.color}`}>
                              {chip.label}
                            </span>
                            {m.senderChannel === "telegram" && (
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">via TG</span>
                            )}
                          </div>
                          {attachments.length > 0 && (
                            <div className="grid grid-cols-2 gap-1 mb-1 max-w-[280px]">
                              {attachments.map((a, i) => {
                                const src = a.url || (a.base64 ? `data:${a.mime};base64,${a.base64}` : "");
                                if (!src) return null;
                                return (
                                  <img key={i} src={src} alt="attachment" className="w-full h-28 object-cover rounded-lg border border-slate-200" />
                                );
                              })}
                            </div>
                          )}
                          {m.content && (
                            <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                              senderType === "external"
                                ? "bg-slate-900 text-white rounded-tr-sm"
                                : senderType === "arima"
                                  ? "bg-white border border-slate-100 text-slate-700 rounded-tl-sm"
                                  : "bg-indigo-50 border border-indigo-100 text-slate-700 rounded-tl-sm"
                            }`}>
                              {m.content}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* REQUESTS VIEW */
        <div className="flex-1 flex overflow-hidden">
          {/* Requests list */}
          <div className="w-[420px] shrink-0 border-r border-slate-100 bg-white/60 flex flex-col">
            {/* Filter bar */}
            <div className="p-3 border-b border-slate-100 space-y-2">
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
                <Search className="w-3.5 h-3.5 text-slate-300" />
                <input
                  value={requestsSearch}
                  onChange={e => setRequestsSearch(e.target.value)}
                  placeholder="Search title or description..."
                  className="flex-1 bg-transparent text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none"
                />
                {requestsSearch && (
                  <button onClick={() => setRequestsSearch("")} className="text-slate-300 hover:text-slate-500">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {isAdmin && (
                  <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded-lg p-0.5">
                    <button
                      onClick={() => setRequestsScope("mine")}
                      className={`px-2 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                        requestsScope === "mine" ? "bg-rose-500 text-white" : "text-slate-500"
                      }`}
                    >
                      Mine
                    </button>
                    <button
                      onClick={() => setRequestsScope("team")}
                      className={`px-2 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                        requestsScope === "team" ? "bg-rose-500 text-white" : "text-slate-500"
                      }`}
                    >
                      Team
                    </button>
                  </div>
                )}
                <select
                  value={requestsStatus}
                  onChange={e => setRequestsStatus(e.target.value)}
                  className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1 uppercase tracking-wider outline-none"
                >
                  <option value="all">All status</option>
                  <option value="new">New</option>
                  <option value="in-progress">In progress</option>
                  <option value="done">Done</option>
                  <option value="archived">Archived</option>
                </select>
                <select
                  value={requestsPriority}
                  onChange={e => setRequestsPriority(e.target.value)}
                  className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1 uppercase tracking-wider outline-none"
                >
                  <option value="all">All priority</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select
                  value={requestsCategory}
                  onChange={e => setRequestsCategory(e.target.value)}
                  className="text-[10px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1 uppercase tracking-wider outline-none"
                >
                  <option value="all">All categories</option>
                  <option value="feature">Feature</option>
                  <option value="bug">Bug</option>
                  <option value="question">Question</option>
                  <option value="config">Config</option>
                  <option value="meeting">Meeting</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto thin-scrollbar px-2 py-2">
              {requestsLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
                </div>
              )}
              {!requestsLoading && requests.length === 0 && (
                <div className="text-center py-12 px-4">
                  <ClipboardList className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    No requests yet
                  </p>
                  <p className="text-[10px] font-semibold text-slate-400">
                    ARIMA captures requests when you chat about specific asks.
                  </p>
                </div>
              )}
              <div className="space-y-1">
                {requests.map((r) => {
                  const active = r.id === selectedRequest?.id;
                  const priColor =
                    r.priority === "urgent" ? "bg-red-100 text-red-700"
                    : r.priority === "high" ? "bg-amber-100 text-amber-700"
                    : r.priority === "low" ? "bg-slate-100 text-slate-500"
                    : "bg-blue-100 text-blue-700";
                  const statusColor =
                    r.status === "done" ? "bg-emerald-100 text-emerald-700"
                    : r.status === "in-progress" ? "bg-amber-100 text-amber-700"
                    : r.status === "archived" ? "bg-slate-100 text-slate-400"
                    : "bg-rose-100 text-rose-700";
                  return (
                    <button
                      key={r.id}
                      onClick={() => openRequest(r)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        active ? "bg-rose-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <p className={`text-[11px] font-bold truncate mb-1 ${active ? "text-rose-700" : "text-slate-700"}`} title={r.title}>
                        {r.title}
                      </p>
                      <div className="flex items-center gap-1 flex-wrap mb-0.5">
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${statusColor}`}>
                          {r.status}
                        </span>
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${priColor}`}>
                          {r.priority}
                        </span>
                        <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          {r.category}
                        </span>
                      </div>
                      <p className="text-[9px] font-semibold text-slate-400 truncate">
                        {r.clientName ? `${r.clientCode || ""}${r.clientCode ? " · " : ""}${r.clientName}` : "(no client)"} · {formatTime(r.createdAt)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Request detail */}
          <div className="flex-1 overflow-auto">
            {!selectedRequest ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-8">
                <ClipboardList className="w-12 h-12 text-slate-200 mb-3" />
                <p className="text-sm font-bold text-slate-500 mb-1">Select a request</p>
                <p className="text-[11px] font-semibold text-slate-400 max-w-sm">
                  ARIMA logs every request automatically when you chat. Track, assign, and close them here.
                </p>
              </div>
            ) : (
              <div className="px-6 sm:px-8 py-6 max-w-3xl mx-auto">
                <div className="mb-5">
                  <h2 className="text-base font-black text-slate-800 tracking-tight mb-1">
                    {selectedRequest.title}
                  </h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Captured by {selectedRequest.capturedByName || selectedRequest.capturedByEmail || "unknown"}
                    {selectedRequest.clientName ? ` · ${selectedRequest.clientCode || ""}${selectedRequest.clientCode ? " · " : ""}${selectedRequest.clientName}` : ""}
                    {" · "}
                    {formatTime(selectedRequest.createdAt)}
                  </p>
                </div>

                {/* Quick controls */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                    <select
                      value={selectedRequest.status}
                      onChange={e => updateRequestField(selectedRequest.id, { status: e.target.value })}
                      className="w-full text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 outline-none"
                    >
                      <option value="new">New</option>
                      <option value="in-progress">In progress</option>
                      <option value="done">Done</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Priority</p>
                    <select
                      value={selectedRequest.priority}
                      onChange={e => updateRequestField(selectedRequest.id, { priority: e.target.value })}
                      className="w-full text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 outline-none"
                    >
                      <option value="urgent">Urgent</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Category</p>
                    <select
                      value={selectedRequest.category}
                      onChange={e => updateRequestField(selectedRequest.id, { category: e.target.value })}
                      className="w-full text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 outline-none"
                    >
                      <option value="feature">Feature</option>
                      <option value="bug">Bug</option>
                      <option value="question">Question</option>
                      <option value="config">Config</option>
                      <option value="meeting">Meeting</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Description */}
                {selectedRequest.description && (
                  <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-5">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Description</p>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {selectedRequest.description}
                    </p>
                  </div>
                )}

                {/* Source conversation */}
                {selectedRequestDetail?.sourceMessages && selectedRequestDetail.sourceMessages.length > 0 && (
                  <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-5">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                      Source Conversation
                    </p>
                    <div className="space-y-2 max-h-80 overflow-auto thin-scrollbar">
                      {selectedRequestDetail.sourceMessages.map((m: any) => (
                        <div
                          key={m.id}
                          className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[85%] px-3 py-2 rounded-xl text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                              m.role === "user"
                                ? "bg-slate-900 text-white rounded-tr-sm"
                                : "bg-slate-50 border border-slate-100 text-slate-700 rounded-tl-sm"
                            }`}
                          >
                            {m.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer actions */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <button
                    onClick={() => deleteRequest(selectedRequest.id)}
                    className="flex items-center gap-1.5 text-[10px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                  {selectedRequest.conversationId && (
                    <button
                      onClick={() => {
                        setView("chat");
                        loadConversation(selectedRequest.conversationId);
                      }}
                      className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 hover:text-rose-700 uppercase tracking-widest"
                    >
                      Open Source Chat
                      <ChevronDown className="w-3 h-3 -rotate-90" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
