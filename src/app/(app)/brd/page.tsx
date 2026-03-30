"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import SmartMic from "@/components/ui/SmartMic";
import { ArrowUp, Loader2, Download, Copy, Check, Save, FileText, Paperclip, X } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";

export default function BRDPage() {
  return (
    <AuthGuard>
      <Suspense>
        <BRDContent />
      </Suspense>
    </AuthGuard>
  );
}

function BRDContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "model", content: string, attachmentNames?: string[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{ name: string; mimeType: string; data: string; preview?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [brdContent, setBrdContent] = useState("");
  const [copied, setCopied] = useState(false);
  const [exportingToDocx, setExportingToDocx] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Read account context from query params (set when navigating from Accounts hub)
  const accountId = searchParams.get("accountId");

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Load existing work if loadId is present
  useEffect(() => {
    const loadId = searchParams.get("loadId");
    if (loadId && session?.user) {
      fetch("/api/works/" + loadId).then(r => r.json()).then(data => {
        if (data.data) { 
          setBrdContent(data.data); 
          setSavedId(data.id); 
        }
      }).catch(console.error);
    }
  }, [searchParams, session]);

  const saveToCloud = async () => {
    if (!session?.user) { alert("Please sign in to save."); return; }
    if (!brdContent) { alert("Generate a BRD first."); return; }
    const title = messages[0]?.content?.slice(0, 60) || "Untitled BRD";
    setSaving(true);
    try {
      const payload: any = { id: savedId, appType: "brd", title, data: brdContent };
      if (accountId) payload.clientProfileId = accountId;
      const res = await fetch("/api/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) { setSavedId(data.id); alert("Saved to cloud!"); }
      else alert("Save failed: " + data.error);
    } catch (err: any) { alert("Error: " + err.message); }
    finally { setSaving(false); }
  };

  const handleTranscription = (text: string) => {
    setPrompt((prev) => (prev ? prev + " " + text : text));
  };

  // ── Attachment Handling ───────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        setPendingAttachments((prev) => [...prev, {
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          data: base64,
          preview: file.type.startsWith("image/") ? dataUrl : undefined
        }]);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const images = items.filter(item => item.type.startsWith("image/"));
    if (images.length === 0) return;

    e.preventDefault();
    images.forEach(item => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        setPendingAttachments(prev => [...prev, {
          name: `pasted-image-${Date.now()}.png`,
          mimeType: file.type || "image/png",
          data: base64,
          preview: dataUrl
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (idx: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const generateBrd = async () => {
    if (!prompt.trim() && pendingAttachments.length === 0) return;
    
    // customInstruction stays for backwards compat, but server now fetches from DB
    const customInstruction = localStorage.getItem("prompt_brd");

    const userMessage = prompt;
    const attachmentNames = pendingAttachments.map(a => a.name);
    const newMessages: any[] = [...messages, { 
      role: "user", 
      content: userMessage || (attachmentNames.length > 0 ? `[Attached: ${attachmentNames.join(", ")}]` : ""),
      attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined
    }];
    
    setMessages(newMessages);
    const currentAttachments = [...pendingAttachments];
    setPendingAttachments([]);
    setPrompt("");

    setLoading(true);
    try {
      const res = await fetch("/api/brd/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          prompt: userMessage, 
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          systemInstruction: customInstruction,
          attachments: currentAttachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
        }),
      });
      const data = await res.json();
      if (res.ok && data.content) {
        setBrdContent(data.content);
        setMessages([...newMessages, { role: "model", content: "I have updated the BRD document based on your latest instructions!" }]);
      } else {
        alert("Backend Error: " + (data.error || "Failed to generate BRD."));
      }
    } catch (err: any) {
      console.error(err);
      alert("Network Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(brdContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportDocxFile = async () => {
    if (!brdContent) return;
    setExportingToDocx(true);
    try {
      const res = await fetch("/api/brd/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: brdContent, title: "Business_Requirements_Document" }),
      });
      if (!res.ok) throw new Error("Export failed");
      
      // Download the returned blob
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Business_Requirements_Document.docx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Error generating DOCX: " + err.message);
    } finally {
      setExportingToDocx(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar: Chat / Dictation Area */}
      <div className="w-1/3 border-r bg-card flex flex-col shadow-lg z-10">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold tracking-tight">BRD Maker</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dictate process objectives and roles, and the AI will auto-write a full structured requirements document.
          </p>
          {session?.user && (
            <button onClick={saveToCloud} disabled={saving || !brdContent} className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:underline disabled:opacity-40">
              <Save className="h-3 w-3" /> {saving ? "Saving..." : savedId ? "Update Cloud" : "Save to Cloud"}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30 flex flex-col">
          <div className="bg-background shadow-sm border rounded-xl p-4 max-w-[85%] text-sm leading-relaxed self-start">
            I am your Business Analyst. Tell me about the app or process you need to document, and I will write the BRD!
          </div>

          {messages.map((msg: any, idx) => (
            <div key={idx} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {msg.attachmentNames && (
                <div className="flex flex-wrap gap-1 justify-end px-2">
                  {msg.attachmentNames.map((name: string, i: number) => (
                    <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-medium border border-primary/20">
                      <Paperclip className="w-2.5 h-2.5" /> {name}
                    </span>
                  ))}
                </div>
              )}
              <div 
                className={`p-4 text-sm leading-relaxed max-w-[85%] border shadow-sm ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm" : "bg-background rounded-2xl rounded-tl-sm"}`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
             <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 max-w-[85%] text-sm animate-pulse flex items-center gap-3 self-start">
               <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
               Drafting comprehensive business documents...
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t bg-background space-y-3">
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((att, idx) => (
                <div key={idx} className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded bg-muted border border-border-default text-[10px] text-text-secondary">
                  {att.preview ? (
                    <img src={att.preview} className="w-4 h-4 object-cover rounded" />
                  ) : <FileText className="w-3.5 h-3.5" />}
                  <span className="truncate max-w-[100px]">{att.name}</span>
                  <button onClick={() => removeAttachment(idx)} className="p-0.5 hover:bg-surface-muted rounded text-text-secondary">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                 if (e.key === "Enter" && !e.shiftKey) {
                   e.preventDefault();
                   generateBrd();
                 }
              }}
              onPaste={handlePaste}
              rows={3}
              placeholder="Describe goals, paste screenshot, or attach file..."
              disabled={loading}
              className="w-full rounded-2xl border bg-muted/30 pl-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 resize-none min-h-[50px]"
            />
            <button 
              className="absolute right-2 bottom-2 h-9 w-9 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-md disabled:opacity-50" 
              onClick={generateBrd}
              disabled={loading || (!prompt.trim() && pendingAttachments.length === 0)}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SmartMic onTranscription={handleTranscription} disabled={loading} />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary hover:text-primary transition-colors disabled:opacity-40"
              >
                <Paperclip className="w-3.5 h-3.5" /> Attach File
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Document Area */}
      <div className="flex-1 w-2/3 bg-slate-50 relative flex flex-col items-center py-8 overflow-y-auto">
        {brdContent ? (
          <div className="w-[85%] max-w-4xl bg-white shadow-lg border rounded-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300">
            {/* Toolbar */}
            <div className="flex items-center justify-between border-b px-6 py-3 bg-slate-50/80 backdrop-blur top-0 sticky z-20">
               <span className="font-semibold text-sm text-slate-600">Document Editor</span>
               <div className="flex gap-2">
                 <button onClick={copyToClipboard} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-md hover:bg-slate-100 transition-colors">
                   {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />} 
                   {copied ? "Copied!" : "Copy Markdown"}
                 </button>
                 <button onClick={exportDocxFile} disabled={exportingToDocx} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-md hover:bg-slate-100 transition-colors disabled:opacity-50">
                   {exportingToDocx ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 text-blue-600" />} 
                   {exportingToDocx ? "Exporting..." : "Export .docx"}
                 </button>
               </div>
            </div>
            {/* The editable document */}
            <textarea
              value={brdContent}
              onChange={(e) => setBrdContent(e.target.value)}
              className="w-full h-[600px] min-h-[max(calc(100vh-250px),_600px)] p-8 outline-none resize-none font-mono text-sm leading-relaxed text-slate-800 bg-white"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60">
             <div className="w-32 h-32 border-4 border-dashed rounded-xl mb-4 flex items-center justify-center">
                <span className="font-mono text-4xl">BRD</span>
             </div>
             <p className="font-medium tracking-wide">Generate a document to start editing.</p>
          </div>
        )}
      </div>
    </div>
  );
}
