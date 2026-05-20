"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowUp, Loader2, FileText, Paperclip, X, Sparkles, Settings, FileDown,
  ExternalLink, AlertTriangle, CheckCircle2,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import ProposalDocument from "@/components/proposal/ProposalDocument";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import type { ProposalContent } from "@/lib/proposal/types";

interface ChatBubble {
  role: "user" | "assistant";
  content: string;
  attachmentNames?: string[];
}

interface PendingAttachment {
  name: string;
  mimeType: string;
  data: string;   // base64
}

export default function ProposalMakerPage() {
  return (
    <AuthGuard>
      <Suspense><Content /></Suspense>
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  useBreadcrumbs([{ label: "Proposal Maker" }]);
  const isAdmin = (session?.user as any)?.role === "admin";

  // Resumable conversation — if ?resume=<id> in URL, load that draft
  const resumeId = searchParams.get("resume");

  const [proposalId, setProposalId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [content, setContent] = useState<ProposalContent | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "exported">("draft");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  // Load resumable draft
  useEffect(() => {
    if (!resumeId) return;
    (async () => {
      try {
        const res = await fetch(`/api/proposal-maker/${resumeId}`);
        const data = await res.json();
        if (res.ok && data.proposal) {
          setProposalId(data.proposal.id);
          setAccountName(data.proposal.clientName || null);
          setStatus(data.proposal.status === "exported" ? "exported" : "draft");
          setPdfUrl(data.proposal.pdfDriveUrl || null);
          setContent(data.proposal.content || null);
          try {
            const msgs = data.proposal.messages ? JSON.parse(data.proposal.messages) : [];
            setMessages(Array.isArray(msgs) ? msgs : []);
          } catch {}
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [resumeId]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (!f.type.startsWith("image/")) {
        alert(`Only images are supported. Skipping ${f.name}.`);
        continue;
      }
      const data = await fileToBase64(f);
      setPending(p => [...p, { name: f.name, mimeType: f.type, data }]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const send = async () => {
    if (!prompt.trim() && pending.length === 0) return;
    const userMsg: ChatBubble = {
      role: "user",
      content: prompt,
      attachmentNames: pending.length > 0 ? pending.map(p => p.name) : undefined,
    };
    const optimisticHistory = [...messages, userMsg];
    setMessages(optimisticHistory);
    const sentText = prompt;
    const sentAttachments = pending;
    setPrompt("");
    setPending([]);
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/proposal-maker/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          message: sentText,
          attachments: sentAttachments.map(a => ({ name: a.name, mimeType: a.mimeType, data: a.data })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Chat failed");
      // Update from server response
      if (data.proposalId && !proposalId) {
        setProposalId(data.proposalId);
        // Update URL so refresh resumes the same conversation
        router.replace(`/proposal-maker?resume=${data.proposalId}`);
      }
      if (data.accountName && !accountName) setAccountName(data.accountName);
      if (data.updatedContent) setContent(data.updatedContent);
      setMessages([...optimisticHistory, { role: "assistant", content: data.reply || "" }]);
    } catch (e: any) {
      setError(e?.message || String(e));
      // Roll back the optimistic user message? Keep it — user can see what they sent.
      setMessages([...optimisticHistory, { role: "assistant", content: `❌ ${e?.message || "Error"}` }]);
    } finally {
      setSending(false);
    }
  };

  const exportPdf = async () => {
    if (!proposalId) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposal-maker/${proposalId}/export-pdf`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Export failed");
      setStatus("exported");
      setPdfUrl(data.pdfDriveUrl);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setExporting(false);
    }
  };

  const startNew = () => {
    setProposalId(null);
    setMessages([]);
    setContent(null);
    setAccountName(null);
    setStatus("draft");
    setPdfUrl(null);
    setError(null);
    router.replace("/proposal-maker");
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-slate-50">
      {/* Left: chat panel */}
      <div className="w-[380px] border-r bg-white flex flex-col shadow-xl z-20">
        <div className="p-5 border-b shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-indigo-500 text-white p-1 rounded-md shadow-sm"><FileText size={16} /></div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800">Proposal Maker</h1>
          </div>
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-widest mt-1.5">
            {accountName ? `Account: ${accountName}` : "Chat with ARIMA to draft"}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={startNew} className="text-[10px] font-black uppercase text-indigo-600 hover:underline">
              + New Proposal
            </button>
            {isAdmin && (
              <ForceLink href="/proposal-maker/settings" className="text-[10px] font-black uppercase text-slate-400 hover:text-indigo-600 hover:underline flex items-center gap-1">
                <Settings size={11} /> Settings
              </ForceLink>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30">
          {messages.length === 0 && !sending && (
            <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-5 text-[13px] text-slate-600 leading-relaxed">
              <div className="font-bold text-slate-800 mb-1">Hi — I'm ARIMA.</div>
              Tell me about the proposal. Include the client account name, project type, and any cost info you have. I'll draft it on the right.
              <div className="mt-3 text-[11px] text-slate-500">
                Example: <em>"Draft a proposal for MX, addendum for the manpower costing module. P75 discounted rate, 30 guaranteed users, total P12,000 + VAT. Signatory is Wilson Ngo (COO)."</em>
              </div>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`p-3 text-[13px] leading-relaxed max-w-[92%] shadow-sm ${
                msg.role === "user"
                  ? "bg-indigo-500 text-white rounded-2xl rounded-tr-sm"
                  : "bg-white border rounded-2xl rounded-tl-sm text-slate-700"
              }`}>
                {msg.content}
              </div>
              {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                <div className="text-[10px] text-slate-400 flex flex-wrap gap-1">
                  {msg.attachmentNames.map((n, i) => <span key={i}><Paperclip className="w-2.5 h-2.5 inline -mt-0.5" /> {n}</span>)}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex flex-col gap-2 items-start animate-pulse">
              <div className="bg-white border rounded-2xl p-3 flex items-center gap-3 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Drafting…</span>
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-900">
              <AlertTriangle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t bg-white shrink-0">
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {pending.map((att, idx) => (
                <div key={idx} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-slate-50 border text-[10px] font-bold text-slate-500">
                  <Paperclip className="w-3 h-3" /> <span className="truncate max-w-[100px]">{att.name}</span>
                  <button onClick={() => setPending(p => p.filter((_, i) => i !== idx))} className="hover:text-rose-500">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Tell ARIMA what to draft or refine…"
              disabled={sending}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-4 py-3 pr-12 text-[13px] focus:outline-none focus:border-indigo-300 focus:bg-white transition-all disabled:opacity-50 resize-none min-h-[50px]"
            />
            <button
              onClick={send}
              disabled={sending || (!prompt.trim() && pending.length === 0)}
              className="absolute right-2 bottom-2 h-9 w-9 flex items-center justify-center rounded-xl bg-indigo-500 text-white hover:shadow-lg active:scale-95 transition-all disabled:opacity-50"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="text-[10px] font-black uppercase text-slate-400 hover:text-indigo-600 transition-colors flex items-center gap-1"
            >
              <Paperclip size={12} /> Attach Image
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
        </div>
      </div>

      {/* Right: preview panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 border-b bg-white px-6 flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-bold text-sm text-slate-800 tracking-tight">Preview</span>
            {accountName && (
              <>
                <div className="h-4 w-px bg-slate-200" />
                <span className="text-[12px] text-slate-600">{accountName}</span>
              </>
            )}
            {status === "exported" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                <CheckCircle2 className="w-3 h-3" /> Exported
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-bold hover:border-indigo-300">
                <ExternalLink className="w-3.5 h-3.5" /> Open PDF
              </a>
            )}
            <button
              onClick={exportPdf}
              disabled={!proposalId || !content || exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 text-white text-[11px] font-bold hover:bg-indigo-600 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              {exporting ? "Exporting…" : (pdfUrl ? "Re-export" : "Export PDF")}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {content ? (
            <div className="bg-white shadow-lg rounded-xl overflow-hidden max-w-5xl mx-auto">
              <ProposalDocument content={content} showAiNotes={true} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <Sparkles className="w-12 h-12 text-indigo-300 mx-auto mb-4" />
                <h2 className="text-lg font-bold text-slate-800 mb-2">No proposal yet</h2>
                <p className="text-[13px] text-slate-500">
                  Chat with ARIMA on the left. As soon as it has enough to draft, the proposal will render here. You can refine it through the conversation.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      // strip the "data:<mime>;base64," prefix
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
