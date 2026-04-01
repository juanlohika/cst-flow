"use client";

import { useState, useEffect, Suspense, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import SmartMic from "@/components/ui/SmartMic";
import { ArrowUp, Loader2, Download, Copy, Check, Save, FileText, Paperclip, X, MessageSquare, Send, Sparkles, FileDown } from "lucide-react";
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
  const [exportingToPdf, setExportingToPdf] = useState(false);
  
  // Interactive Review States
  const [comments, setComments] = useState<{ id: string; text: string; segmentIndex: number }[]>([]);
  const [activeCommentIndex, setActiveCommentIndex] = useState<number | null>(null);
  const [newComment, setNewComment] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Read context from query params
  const accountId = searchParams.get("accountId");
  const loadId = searchParams.get("loadId");

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Load existing work
  useEffect(() => {
    if (loadId && session?.user) {
      fetch("/api/works/" + loadId).then(r => r.json()).then(data => {
        if (data.data) { 
          setBrdContent(data.data); 
          setSavedId(data.id); 
          // Attempt to restore message context if available (future enhancement)
        }
      }).catch(console.error);
    }
  }, [loadId, session]);

  // Auto-resize chat textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  const handleTranscription = (text: string) => {
    setPrompt((prev) => (prev ? prev + " " + text : text));
  };

  const saveToCloud = async () => {
    if (!session?.user) { alert("Please sign in to save."); return; }
    if (!brdContent) { alert("Generate a BRD first."); return; }
    
    // Use the first user message or project title as default
    const title = messages.find(m => m.role === "user")?.content?.slice(0, 60) || "Business Requirements Document";
    
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
      if (res.ok) { 
        setSavedId(data.id); 
        alert("Saved successfully!"); 
      } else {
        alert("Save failed: " + data.error);
      }
    } catch (err: any) {
      alert("Error saving: " + err.message);
    } finally {
      setSaving(false);
    }
  };

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

  const generateBrd = async (customPrompt?: string) => {
    const finalPrompt = customPrompt || prompt;
    if (!finalPrompt.trim() && pendingAttachments.length === 0) return;
    
    const userMessage = finalPrompt;
    const attachmentNames = pendingAttachments.map(a => a.name);
    const newMessages: any[] = [...messages, { 
      role: "user", 
      content: userMessage,
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
          attachments: currentAttachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
        }),
      });
      const data = await res.json();
      if (res.ok && data.content) {
        setBrdContent(data.content);
        setMessages([...newMessages, { role: "model", content: "I have updated the BRD document with your latest feedback!" }]);
        setComments([]); // Clear comments after refinement
      }
    } catch (err) {
      alert("Error generating BRD.");
    } finally {
      setLoading(false);
    }
  };

  const refineWithComments = () => {
    if (comments.length === 0) return;
    const commentSummary = comments.map(c => `- Section ${c.segmentIndex + 1}: ${c.text}`).join("\n");
    const refinePrompt = `Please refine the current BRD based on the following specific feedback:\n\n${commentSummary}`;
    generateBrd(refinePrompt);
  };

  const addComment = () => {
    if (!newComment.trim() || activeCommentIndex === null) return;
    setComments([...comments, { id: Date.now().toString(), text: newComment, segmentIndex: activeCommentIndex }]);
    setNewComment("");
    setActiveCommentIndex(null);
  };

  const exportDocxFile = async () => {
    if (!brdContent) return;
    setExportingToDocx(true);
    try {
      const res = await fetch("/api/brd/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: brdContent, title: "Business_Requirements_Document", format: 'docx' }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Business_Requirements_Document.docx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Export failed.");
    } finally {
      setExportingToDocx(false);
    }
  };

  const exportPdfFile = () => {
    if (!brdContent) return;
    window.print();
  };

  // Split content into segments for interactive commenting
  const segments = brdContent.split("\n\n");

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-slate-50 font-inter">
      {/* Sidebar: Chat Panel (Hide during print) */}
      <div className="w-[380px] border-r bg-white flex flex-col shadow-xl z-20 transition-all no-print">
        <div className="p-6 border-b shrink-0">
          <div className="flex items-center gap-2 mb-1">
             <div className="bg-primary text-white p-1 rounded-md shadow-sm"><FileText size={16}/></div>
             <h1 className="text-xl font-bold tracking-tight text-slate-800">BRD Maker App</h1>
          </div>
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-widest mt-2">
            The Tarkie Requirements Hub
          </p>
          {session?.user && (
            <button 
              onClick={saveToCloud} 
              disabled={saving || !brdContent} 
              className="mt-3 flex items-center gap-1.5 text-[10px] font-black uppercase text-primary hover:underline disabled:opacity-40"
            >
              <Save size={12} /> {saving ? "Saving..." : savedId ? "Update Cloud" : "Save to Cloud"}
            </button>
          )}
        </div>

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 styled-scroll bg-slate-50/30">
          {messages.length === 0 && (
             <div className="bg-primary/5 border border-primary/10 rounded-2xl p-6 text-sm text-slate-600 leading-relaxed">
               Welcome! Tell me about the project, and I will generate the **BRD V.0** for you.
             </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}>
               <div className={`p-4 text-[13px] leading-relaxed max-w-[90%] shadow-sm ${msg.role === "user" ? "bg-primary text-white rounded-2xl rounded-tr-sm" : "bg-white border rounded-2xl rounded-tl-sm text-slate-700"}`}>
                 {msg.content}
               </div>
            </div>
          ))}
          {loading && (
             <div className="flex flex-col gap-2 items-start animate-pulse">
                <div className="bg-white border rounded-2xl p-4 flex items-center gap-3 shadow-sm">
                   <Loader2 className="h-4 w-4 animate-spin text-primary" />
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Drafting intelligence...</span>
                </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area (Smart & Expandable) */}
        <div className="p-4 border-t bg-white shrink-0 shadow-[0_-4px_12px_rgba(0,0,0,0.03)]">
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {pendingAttachments.map((att, idx) => (
                <div key={idx} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-slate-50 border text-[10px] font-bold text-slate-500">
                  <Paperclip className="w-3 h-3" /> <span className="truncate max-w-[80px]">{att.name}</span>
                  <button onClick={() => setPendingAttachments(p => p.filter((_, i) => i !== idx))} className="hover:text-red-500"><X size={12}/></button>
                </div>
              ))}
            </div>
          )}

          <div className="relative group">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generateBrd(); }}}
              placeholder="Suggest improvements or describe goals..."
              disabled={loading}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50 resize-none min-h-[50px] styled-scroll font-medium"
            />
            <button 
              className="absolute right-2 bottom-2 h-9 w-9 flex items-center justify-center rounded-xl bg-primary text-white hover:shadow-lg hover:translate-y-[-1px] active:translate-y-[0px] transition-all disabled:opacity-50" 
              onClick={() => generateBrd()}
              disabled={loading || (!prompt.trim() && pendingAttachments.length === 0)}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>

          <div className="flex items-center justify-between mt-3 px-1">
            <div className="flex items-center gap-4">
              <SmartMic onTranscription={handleTranscription} disabled={loading} />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 hover:text-primary transition-colors"
              >
                <Paperclip size={14} /> Attach File
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
            </div>
            {comments.length > 0 && (
                <button onClick={refineWithComments} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-black uppercase shadow-sm hover:bg-amber-600 transition-all">
                   <Sparkles size={12}/> Refine with {comments.length} Comments
                </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Document Viewer (Collaborative Review) */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-white/40 backdrop-blur-3xl lg:visible">
        <div className="h-14 border-b bg-white/80 backdrop-blur-md px-6 flex items-center justify-between z-10 no-print">
           <div className="flex items-center gap-4">
              <span className="font-bold text-sm text-slate-800 tracking-tight">BRD Maker App</span>
              <div className="h-4 w-px bg-slate-200" />
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Draft Mode v1.0
              </div>
           </div>
           <div className="flex gap-2">
             <button onClick={exportDocxFile} disabled={exportingToDocx} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-all border border-slate-200">
                {exportingToDocx ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>} Export DOCX
             </button>
             <button onClick={exportPdfFile} disabled={exportingToPdf} className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:shadow-lg transition-all shadow-md">
                {exportingToPdf ? <Loader2 size={14} className="animate-spin"/> : <FileDown size={14}/>} Export PDF
             </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-12 styled-scroll brd-document-container">
           {brdContent ? (
             <div className="w-full max-w-4xl mx-auto bg-white shadow-[0_32px_64px_rgba(0,0,0,0.08)] border border-slate-100 rounded-2xl p-16 relative brd-document-printable">
                {segments.map((segment, idx) => (
                  <div 
                    key={idx} 
                    className="brd-segment group mb-4 text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-inter"
                    onClick={() => setActiveCommentIndex(idx)}
                  >
                    <div className="brd-comment-marker"><MessageSquare size={14}/></div>
                    {segment}
                    
                    {/* Inline Comment Box */}
                    {activeCommentIndex === idx && (
                      <div className="absolute left-0 right-0 top-full mt-2 brd-comment-box shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                         <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Revision Note</div>
                         <textarea 
                           autoFocus
                           className="w-full h-20 p-2 text-xs border rounded-lg focus:ring-1 focus:ring-primary outline-none"
                           placeholder="What should be changed here?"
                           value={newComment}
                           onChange={e => setNewComment(e.target.value)}
                         />
                         <div className="flex justify-end gap-2 mt-2">
                           <button onClick={() => setActiveCommentIndex(null)} className="text-[10px] font-bold text-slate-400 px-2">Cancel</button>
                           <button onClick={addComment} className="bg-primary text-white text-[10px] font-bold py-1 px-3 rounded-md">Add Comment</button>
                         </div>
                      </div>
                    )}

                    {/* Show existing comments for this segment */}
                    {comments.filter(c => c.segmentIndex === idx).map(c => (
                       <div key={c.id} className="mt-2 ml-4 flex items-start gap-2 bg-amber-50 border-l-2 border-amber-400 p-2 rounded-r-md">
                          <MessageSquare size={10} className="text-amber-500 mt-1"/>
                          <span className="text-[11px] font-medium text-amber-800 italic">{c.text}</span>
                          <button onClick={(e) => { e.stopPropagation(); setComments(cs => cs.filter(x => x.id !== c.id))}} className="ml-auto text-amber-300 hover:text-amber-600"><X size={10}/></button>
                       </div>
                    ))}
                  </div>
                ))}
             </div>
           ) : (
             <div className="flex flex-col items-center justify-center h-full text-slate-300 opacity-50 select-none">
                <FileText size={80} className="mb-6 opacity-10" strokeWidth={1}/>
                <p className="text-lg font-bold tracking-tight">Generate your first draft to start the review.</p>
                <p className="text-xs uppercase font-black tracking-widest mt-2">AI-Powered Documentation Hub</p>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
