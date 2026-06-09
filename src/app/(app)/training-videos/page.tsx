"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowUp, Loader2, MonitorPlay, Paperclip, X, Settings, FileDown,
  ExternalLink, AlertTriangle, CheckCircle2, Play, RefreshCw, Sparkles,
  ChevronDown,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import type { TrainingVideoContent, TrainingScene } from "@/lib/training-video/types";
import { GEMINI_VOICES } from "@/lib/training-video/types";

interface ChatBubble {
  role: "user" | "assistant";
  content: string;
  attachmentNames?: string[];
}

export default function TrainingVideosPage() {
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
  useBreadcrumbs([{ label: "Training Videos" }]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const resumeId = searchParams.get("resume");

  const [videoId, setVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<TrainingVideoContent | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [voice, setVoice] = useState("Charon");
  const [voiceFolderUrl, setVoiceFolderUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "generating" | "ready" | "error">("draft");

  const [prompt, setPrompt] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [userPromptForUpload, setUserPromptForUpload] = useState("");
  const [titleForUpload, setTitleForUpload] = useState("");
  const [sending, setSending] = useState(false);
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  // Resume
  useEffect(() => {
    if (!resumeId) return;
    (async () => {
      try {
        const res = await fetch(`/api/training-videos/${resumeId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load");
        const v = data.video;
        setVideoId(v.id);
        setTitle(v.title);
        setContent(v.content);
        setMessages(Array.isArray(v.messages) ? v.messages : []);
        setVoice(v.voice);
        setStatus(v.status);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
  }, [resumeId]);

  const startNew = () => {
    setVideoId(null);
    setTitle("");
    setContent(null);
    setMessages([]);
    setError(null);
    setPendingFile(null);
    setUserPromptForUpload("");
    setTitleForUpload("");
    setStatus("draft");
    setVoiceFolderUrl(null);
    router.replace("/training-videos");
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      setError("Only .pptx files supported in v1");
      return;
    }
    setPendingFile(file);
    if (!titleForUpload) {
      // Derive a default title from the filename
      setTitleForUpload(file.name.replace(/\.pptx$/i, "").replace(/[_-]+/g, " "));
    }
  };

  const upload = async () => {
    if (!pendingFile) { setError("Pick a PPTX file first"); return; }
    if (!titleForUpload.trim()) { setError("Give it a title"); return; }
    setSending(true);
    setError(null);
    setStatus("generating");
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("title", titleForUpload);
      if (userPromptForUpload.trim()) formData.append("userPrompt", userPromptForUpload);
      formData.append("voice", voice);

      const res = await fetch("/api/training-videos/create", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");

      setVideoId(data.videoId);
      setTitle(titleForUpload);
      setContent(data.content);
      setVoiceFolderUrl(data.videoFolderUrl || null);
      setMessages([
        { role: "user", content: `Uploaded ${pendingFile.name}${userPromptForUpload ? ` — ${userPromptForUpload}` : ""}`, attachmentNames: [pendingFile.name] },
        { role: "assistant", content: data.reply || "Done — review the scenes on the right." },
      ]);
      setStatus("ready");
      router.replace(`/training-videos?resume=${data.videoId}`);
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus("error");
    } finally {
      setSending(false);
    }
  };

  const sendChat = async () => {
    if (!videoId || !prompt.trim()) return;
    const userMsg: ChatBubble = { role: "user", content: prompt };
    setMessages(m => [...m, userMsg]);
    const sentText = prompt;
    setPrompt("");
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/training-videos/${videoId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: sentText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Chat failed");
      if (data.content) setContent(data.content);
      setMessages(m => [...m, { role: "assistant", content: data.reply || "" }]);
    } catch (e: any) {
      setError(e?.message || String(e));
      setMessages(m => [...m, { role: "assistant", content: `❌ ${e?.message || "Error"}` }]);
    } finally {
      setSending(false);
    }
  };

  const regenerateSceneAudio = async (sceneOrder: number) => {
    if (!videoId) return;
    setRegeneratingScene(sceneOrder);
    setError(null);
    try {
      const res = await fetch(`/api/training-videos/${videoId}/regenerate-audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneOrder }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Regeneration failed");
      if (data.content) setContent(data.content);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRegeneratingScene(null);
    }
  };

  const downloadBundle = async () => {
    if (!videoId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/training-videos/${videoId}/bundle`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error || "Bundle download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "training-bundle"}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-slate-50">
      {/* Left: chat / upload */}
      <div className="w-[400px] border-r bg-white flex flex-col shadow-xl z-20">
        <div className="p-5 border-b shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-violet-500 text-white p-1 rounded-md shadow-sm"><MonitorPlay size={16} /></div>
            <h1 className="text-lg font-bold tracking-tight text-slate-800">Training Videos</h1>
          </div>
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-widest mt-1.5">
            {title ? title : "Upload a PowerPoint to start"}
          </p>
          <div className="mt-3 flex items-center gap-3">
            {videoId && (
              <button onClick={startNew} className="text-[10px] font-black uppercase text-violet-600 hover:underline">
                + New Video
              </button>
            )}
            {isAdmin && (
              <ForceLink href="/training-videos/settings" className="text-[10px] font-black uppercase text-slate-400 hover:text-violet-600 hover:underline flex items-center gap-1">
                <Settings size={11} /> Settings
              </ForceLink>
            )}
          </div>
        </div>

        {/* Messages or upload form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30">
          {!videoId ? (
            <div className="space-y-3">
              <div className="bg-violet-50/60 border border-violet-100 rounded-2xl p-5 text-[13px] text-slate-600 leading-relaxed">
                <div className="font-bold text-slate-800 mb-1">Upload a PowerPoint deck</div>
                I'll read every slide, generate narration scripts in Tarkie's voice, and produce voiceover audio for each scene. You'll get a bundle ready for CapCut / Descript / iMovie.
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700">Title</label>
                <input
                  value={titleForUpload}
                  onChange={e => setTitleForUpload(e.target.value)}
                  placeholder="e.g. Tarkie Check-In Tutorial"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:border-violet-300"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700">Optional guidance prompt</label>
                <textarea
                  value={userPromptForUpload}
                  onChange={e => setUserPromptForUpload(e.target.value)}
                  rows={3}
                  placeholder="e.g. Audience is new field promoters. Keep under 90 seconds total. Emphasize the check-in button."
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] resize-y"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                  Voice <ChevronDown size={11} className="text-slate-400" />
                </label>
                <select
                  value={voice}
                  onChange={e => setVoice(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white"
                >
                  {GEMINI_VOICES.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.label}{v.recommended ? " — recommended" : ""}{v.description ? ` (${v.description})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700">PowerPoint file (.pptx)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={handleFile}
                  className="mt-1 w-full text-[12px]"
                />
                {pendingFile && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    <Paperclip className="w-2.5 h-2.5 inline -mt-0.5" /> {pendingFile.name} · {(pendingFile.size / 1024).toFixed(0)} KB
                  </p>
                )}
              </div>

              <button
                onClick={upload}
                disabled={sending || !pendingFile || !titleForUpload.trim()}
                className="w-full px-4 py-3 rounded-xl bg-violet-500 text-white text-[13px] font-bold hover:bg-violet-600 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {sending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating (this can take 1-3 min)…</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Generate Script + Voiceover</>
                )}
              </button>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div className={`p-3 text-[13px] leading-relaxed max-w-[92%] shadow-sm ${
                    msg.role === "user"
                      ? "bg-violet-500 text-white rounded-2xl rounded-tr-sm"
                      : "bg-white border rounded-2xl rounded-tl-sm text-slate-700"
                  }`}>
                    {msg.content}
                  </div>
                  {msg.attachmentNames && msg.attachmentNames.length > 0 && (
                    <div className="text-[10px] text-slate-400">
                      <Paperclip className="w-2.5 h-2.5 inline -mt-0.5" /> {msg.attachmentNames.join(", ")}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex flex-col items-start animate-pulse">
                  <div className="bg-white border rounded-2xl p-3 flex items-center gap-3 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Thinking…</span>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-900">
              <AlertTriangle className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat input (only when video exists) */}
        {videoId && (
          <div className="p-4 border-t bg-white shrink-0">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder="Refine the script… e.g. 'make scene 3 more energetic'"
                disabled={sending}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 pl-4 py-3 pr-12 text-[13px] focus:outline-none focus:border-violet-300 focus:bg-white transition-all disabled:opacity-50 resize-none min-h-[50px]"
              />
              <button
                onClick={sendChat}
                disabled={sending || !prompt.trim()}
                className="absolute right-2 bottom-2 h-9 w-9 flex items-center justify-center rounded-xl bg-violet-500 text-white hover:shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: scenes panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 border-b bg-white px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-bold text-sm text-slate-800 tracking-tight">Scenes</span>
            {content && (
              <span className="text-[12px] text-slate-500">
                {content.scenes.length} scene{content.scenes.length === 1 ? "" : "s"}
              </span>
            )}
            {status === "generating" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold">
                <Loader2 className="w-3 h-3 animate-spin" /> Generating
              </span>
            )}
            {status === "ready" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                <CheckCircle2 className="w-3 h-3" /> Ready
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {voiceFolderUrl && (
              <a href={voiceFolderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-bold hover:border-violet-300">
                <ExternalLink className="w-3.5 h-3.5" /> Drive folder
              </a>
            )}
            <button
              onClick={downloadBundle}
              disabled={!videoId || !content || downloading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 text-white text-[11px] font-bold hover:bg-violet-600 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              {downloading ? "Bundling…" : "Download Bundle"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {!content ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <Sparkles className="w-12 h-12 text-violet-300 mx-auto mb-4" />
                <h2 className="text-lg font-bold text-slate-800 mb-2">No script yet</h2>
                <p className="text-[13px] text-slate-500">
                  Upload a PowerPoint on the left. As soon as it's processed, every scene appears here with its narration, audio, and caption.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-3">
              {content.aiNotes && (content.aiNotes.summary || content.aiNotes.missing.length > 0) && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-[12px]">
                  {content.aiNotes.summary && <p className="text-slate-700 italic mb-2">{content.aiNotes.summary}</p>}
                  {content.aiNotes.missing.length > 0 && (
                    <div>
                      <div className="font-bold text-rose-700 mb-1">Needs your input:</div>
                      <ul className="list-disc ml-5 space-y-0.5 text-rose-800">
                        {content.aiNotes.missing.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {content.scenes.map(scene => (
                <SceneCard
                  key={scene.order}
                  scene={scene}
                  regenerating={regeneratingScene === scene.order}
                  onRegenerate={() => regenerateSceneAudio(scene.order)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SceneCard({
  scene,
  regenerating,
  onRegenerate,
}: {
  scene: TrainingScene;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Scene {scene.order}{scene.sourceSlideNumber ? ` · slide ${scene.sourceSlideNumber}` : ""}
          </div>
          <div className="text-[14px] font-bold text-slate-800 mt-0.5">{scene.title}</div>
        </div>
        <div className="text-[10px] text-slate-400 shrink-0">
          {scene.audioDurationSec ? `${scene.audioDurationSec.toFixed(1)}s` : "—"}
        </div>
      </div>

      <p className="text-[13px] text-slate-700 leading-relaxed">{scene.narrationScript}</p>

      {scene.aiNote && (
        <div className="mt-2 text-[10px] text-slate-400 italic">{scene.aiNote}</div>
      )}

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {scene.audioDriveUrl ? (
          <a
            href={scene.audioDriveUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-[11px] font-bold text-violet-700 hover:bg-violet-100"
          >
            <Play className="w-3 h-3" /> Play audio
          </a>
        ) : (
          <span className="text-[11px] text-amber-700">No audio yet</span>
        )}
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-violet-600 disabled:opacity-50"
        >
          {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {regenerating ? "Regenerating…" : "Regenerate audio"}
        </button>
      </div>
    </div>
  );
}
