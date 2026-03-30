"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import GlobalBar from "@/components/layout/GlobalBar";
import AuthGuard from "@/components/auth/AuthGuard";
import SmartMic from "@/components/ui/SmartMic";
import {
  Paintbrush,
  ArrowUp,
  Loader2,
  Copy,
  Check,
  Save,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  Paperclip,
  FileText,
} from "lucide-react";

interface Message {
  role: "user" | "model";
  content: string;
  attachmentNames?: string[];
}

interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64 (no data-url prefix)
  preview?: string; // data-url for images only
}

interface SavedWork {
  id: string;
  title: string;
  data: string;
  appType: string;
}

interface Account {
  id: string;
  companyName: string;
}

const ACCEPTED_TYPES = "image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function MockupPage() {
  return (
    <AuthGuard>
      <MockupContent />
    </AuthGuard>
  );
}

function MockupContent() {
  const { data: session } = useSession();

  // Chat state
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  // Attachments for the current message
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);

  // Preview state
  const [htmlContent, setHtmlContent] = useState("");

  // Design skill loaded from DB (category: "mockup")
  const [designSkill, setDesignSkill] = useState<string | undefined>(undefined);

  // BRD context
  const [brdContextOpen, setBrdContextOpen] = useState(false);
  const [brds, setBrds] = useState<SavedWork[]>([]);
  const [selectedBrdId, setSelectedBrdId] = useState("");
  const selectedBrd = brds.find((b) => b.id === selectedBrdId) || null;

  // Toolbar state
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  // Save modal state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveAccountId, setSaveAccountId] = useState("");
  const [saveStatus, setSaveStatus] = useState("open");
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load active design skill for mockup category
  useEffect(() => {
    fetch("/api/skills?category=mockup&activeOnly=true")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setDesignSkill(data[0].content);
      })
      .catch(() => {});
  }, []);

  // Load accounts for save modal
  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAccounts(data); })
      .catch(() => {});
  }, []);

  // Load BRDs on mount
  useEffect(() => {
    fetch("/api/works?appType=brd")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBrds(data);
        else if (Array.isArray(data?.works)) setBrds(data.works);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleTranscription = (text: string) => {
    setPrompt((prev) => (prev ? prev + " " + text : text));
  };

  // ── File handling ─────────────────────────────────────────────────────────

  const readFileAsBase64 = (file: File): Promise<{ data: string; preview?: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        // Strip the data-url prefix to get raw base64
        const base64 = dataUrl.split(",")[1];
        const preview = file.type.startsWith("image/") ? dataUrl : undefined;
        resolve({ data: base64, preview });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (const file of files) {
      try {
        const { data, preview } = await readFileAsBase64(file);
        newAttachments.push({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          data,
          preview,
        });
      } catch {
        // skip unreadable files
      }
    }

    setPendingAttachments((prev) => [...prev, ...newAttachments]);
    // Reset input so same file can be re-attached
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (idx: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const trimmed = prompt.trim();
    if ((!trimmed && pendingAttachments.length === 0) || loading) return;

    const displayText = trimmed || (pendingAttachments.length > 0 ? `[${pendingAttachments.map(a => a.name).join(", ")}]` : "");
    const userMessage: Message = {
      role: "user",
      content: displayText,
      attachmentNames: pendingAttachments.length > 0 ? pendingAttachments.map((a) => a.name) : undefined,
    };
    const newMessages: Message[] = [...messages, userMessage];
    setMessages(newMessages);
    setPrompt("");

    // Capture and clear pending attachments before the async call
    const attachmentsToSend = pendingAttachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }));
    setPendingAttachments([]);
    setLoading(true);

    try {
      const res = await fetch("/api/mockup/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed || "Generate a mockup based on the attached file(s).",
          messages: newMessages.map(({ role, content }) => ({ role, content })),
          brdContext: selectedBrd?.data,
          designSkill,
          attachments: attachmentsToSend,
          // Pass existing HTML so follow-up requests iterate rather than restart
          previousHtml: htmlContent || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.html) {
        setHtmlContent(data.html);
        setMessages([
          ...newMessages,
          { role: "model", content: "Mockup generated ✓" },
        ]);
      } else {
        setMessages([
          ...newMessages,
          {
            role: "model",
            content: "Error: " + (data.error || "Failed to generate mockup."),
          },
        ]);
      }
    } catch (err: any) {
      setMessages([
        ...newMessages,
        { role: "model", content: "Network error: " + err.message },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle paste — intercept image pastes from clipboard
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return; // let normal text paste proceed

    e.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        const name = `pasted-image-${Date.now()}.png`;
        setPendingAttachments((prev) => [
          ...prev,
          { name, mimeType: file.type || "image/png", data: base64, preview: dataUrl },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  // ── Toolbar ───────────────────────────────────────────────────────────────

  const handleCopyHtml = () => {
    if (!htmlContent) return;
    navigator.clipboard.writeText(htmlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInNewTab = () => {
    if (!htmlContent) return;
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const openSaveModal = () => {
    if (!htmlContent) return;
    const firstUserMsg = messages.find((m) => m.role === "user");
    setSaveTitle(firstUserMsg?.content?.slice(0, 60) || "Untitled Mockup");
    setSaveAccountId("");
    setSaveStatus("open");
    setShowSaveModal(true);
  };

  const handleSave = async () => {
    if (!saveTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appType: "mockup",
          title: saveTitle.trim(),
          data: htmlContent,
          clientProfileId: saveAccountId || null,
          status: saveStatus,
        }),
      });
      if (res.ok) {
        setShowSaveModal(false);
        setSavedMsg(true);
        setTimeout(() => setSavedMsg(false), 2000);
      } else {
        const data = await res.json();
        alert("Save failed: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setPrompt("");
    setHtmlContent("");
    setPendingAttachments([]);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <GlobalBar breadcrumbs={[{ label: "Mockup Maker", href: "/mockup" }]} />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ─────────────────────────────────────────── */}
        <div className="w-[380px] flex-shrink-0 flex flex-col bg-surface-default border-r border-border-default overflow-hidden">

          {/* BRD Context section */}
          <div className="border-b border-border-default">
            <button
              onClick={() => setBrdContextOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-secondary hover:bg-surface-muted transition-colors"
            >
              <span>BRD Context</span>
              {brdContextOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {brdContextOpen && (
              <div className="px-3 pb-3">
                <select
                  value={selectedBrdId}
                  onChange={(e) => setSelectedBrdId(e.target.value)}
                  className="w-full text-[11px] rounded-md border border-border-default bg-surface-subtle px-2 py-1.5 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">No BRD context</option>
                  {brds.map((b) => (
                    <option key={b.id} value={b.id}>{b.title}</option>
                  ))}
                </select>
                {selectedBrd && (
                  <p className="mt-1.5 text-[10px] text-text-secondary leading-snug line-clamp-2 italic">
                    {selectedBrd.data?.slice(0, 100)}…
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 flex flex-col">
            {messages.length === 0 && !loading && (
              <div className="self-start bg-surface-muted text-text-secondary rounded-xl rounded-tl-sm px-3 py-2 text-[11px] max-w-[85%]">
                Describe a UI screen, attach a screenshot or document, and I'll generate a high-fidelity HTML mockup.
              </div>
            )}

            {messages.map((msg, idx) =>
              msg.role === "user" ? (
                <div key={idx} className="self-end flex flex-col items-end gap-1 max-w-[85%]">
                  {/* Attachment chips on user messages */}
                  {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {msg.attachmentNames.map((name, i) => (
                        <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium">
                          <Paperclip className="w-2.5 h-2.5" />
                          {name.length > 20 ? name.slice(0, 18) + "…" : name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="bg-primary text-white rounded-xl rounded-tr-sm px-3 py-2 text-[11px] break-words">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={idx} className="self-start bg-surface-muted text-text-secondary rounded-xl rounded-tl-sm px-3 py-2 text-[11px] max-w-[85%]">
                  {msg.content}
                </div>
              )
            )}

            {loading && (
              <div className="self-start bg-surface-muted text-text-secondary rounded-xl rounded-tl-sm px-3 py-2 text-[11px] max-w-[85%] flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0 text-primary" />
                Generating mockup…
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-border-default p-3 space-y-2">

            {/* Pending attachment chips */}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingAttachments.map((att, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-md border border-border-default bg-surface-subtle text-[10px] text-text-secondary max-w-full">
                    {att.preview ? (
                      <img src={att.preview} alt={att.name} className="w-5 h-5 object-cover rounded" />
                    ) : att.mimeType === "application/pdf" ? (
                      <FileText className="w-3 h-3 text-red-500 shrink-0" />
                    ) : (
                      <FileText className="w-3 h-3 text-blue-500 shrink-0" />
                    )}
                    <span className="truncate max-w-[120px]">{att.name}</span>
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="p-0.5 rounded hover:bg-surface-muted text-text-secondary hover:text-text-primary transition-colors shrink-0"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea + send */}
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={3}
                placeholder="Describe a screen, paste a screenshot, or attach a file…"
                disabled={loading}
                className="w-full rounded-md border border-border-default bg-surface-subtle pl-3 py-2 pr-10 text-[11px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 resize-none"
              />
              <button
                onClick={handleSend}
                disabled={loading || (!prompt.trim() && pendingAttachments.length === 0)}
                title="Send"
                className="absolute right-2 bottom-2 h-7 w-7 flex items-center justify-center rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* Bottom toolbar: mic + attach + clear */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SmartMic onTranscription={handleTranscription} disabled={loading} />

                {/* Attach file button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title="Attach image, PDF, or Word document"
                  className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
                >
                  <Paperclip className="w-3 h-3" />
                  Attach
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              <button
                onClick={handleClear}
                disabled={loading}
                className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
                title="Clear chat and preview"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-surface-subtle overflow-hidden relative">
          {/* iframe preview */}
          <div className="flex-1 overflow-hidden">
            {htmlContent ? (
              <iframe
                srcDoc={htmlContent}
                sandbox="allow-scripts"
                className="w-full h-full border-0"
                title="Mockup preview"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-text-secondary opacity-50">
                <div className="w-16 h-16 rounded-2xl bg-surface-default border border-border-default shadow flex items-center justify-center">
                  <Paintbrush className="w-7 h-7 text-primary" />
                </div>
                <p className="text-[11px] font-medium">Describe a screen or attach a file to generate</p>
                <p className="text-[10px]">Supports screenshots, PDFs, and Word documents</p>
              </div>
            )}
          </div>

          {/* Toolbar */}
          {htmlContent && (
            <div className="border-t border-border-default bg-surface-default px-4 py-2 flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleCopyHtml}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-md border border-border-default bg-surface-subtle hover:bg-surface-muted transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied!" : "Copy HTML"}
              </button>

              <button
                onClick={handleOpenInNewTab}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-md border border-border-default bg-surface-subtle hover:bg-surface-muted transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Open in new tab
              </button>

              <button
                onClick={openSaveModal}
                disabled={saving}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-md border border-border-default bg-surface-subtle hover:bg-surface-muted transition-colors disabled:opacity-50"
              >
                {savedMsg ? (
                  <Check className="w-3 h-3 text-green-600" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                {savedMsg ? "Saved!" : "Save mockup"}
              </button>
            </div>
          )}
        </div>
      </div>
      {/* ── Save Modal ──────────────────────────────────────────── */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface-default rounded-xl shadow-xl border border-border-default w-[420px] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
              <h2 className="text-[13px] font-semibold text-text-primary">Save Mockup</h2>
              <button onClick={() => setShowSaveModal(false)} className="text-text-secondary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">Mockup Name</label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  className="w-full rounded-md border border-border-default bg-surface-subtle px-3 py-2 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Untitled Mockup"
                  autoFocus
                />
              </div>

              {/* Account */}
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">Link to Account <span className="text-text-muted font-normal">(optional)</span></label>
                <select
                  value={saveAccountId}
                  onChange={(e) => setSaveAccountId(e.target.value)}
                  className="w-full rounded-md border border-border-default bg-surface-subtle px-3 py-2 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">No account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.companyName}</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-[11px] font-medium text-text-secondary mb-1">Status</label>
                <div className="flex gap-2 flex-wrap">
                  {(["open", "for_approval", "approved", "rejected"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSaveStatus(s)}
                      className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                        saveStatus === s
                          ? STATUS_PILL_ACTIVE[s]
                          : "border-border-default text-text-secondary hover:bg-surface-muted"
                      }`}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border-default flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1.5 text-[12px] rounded-md border border-border-default text-text-secondary hover:bg-surface-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !saveTitle.trim()}
                className="px-4 py-1.5 text-[12px] font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  for_approval: "For Approval",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_PILL_ACTIVE: Record<string, string> = {
  open: "border-blue-300 bg-blue-50 text-blue-700",
  for_approval: "border-amber-300 bg-amber-50 text-amber-700",
  approved: "border-green-300 bg-green-50 text-green-700",
  rejected: "border-red-300 bg-red-50 text-red-700",
};
