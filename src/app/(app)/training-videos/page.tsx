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

function ttsProgressLabel(p: { phase?: string; done?: number; total?: number } | null): string {
  if (!p) return "Generating";
  if (p.phase === "extracting-frames") return "Extracting keyframes…";
  if (p.phase === "generating-script") return "Writing narration…";
  if (p.phase === "tts" || typeof p.done === "number") {
    return `Generating voiceover (${p.done ?? 0}/${p.total ?? 0})`;
  }
  return "Generating";
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
  const [status, setStatus] = useState<"draft" | "uploading" | "generating" | "ready" | "rendering" | "rendered" | "error">("draft");
  const [finalMp4Url, setFinalMp4Url] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [ttsProgress, setTtsProgress] = useState<{ phase?: string; done?: number; total?: number; current?: { order: number; status: "ok" | "error"; error?: string } } | null>(null);
  // Direct-to-Drive upload progress (percent 0-100) when uploading screen recordings.
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [prompt, setPrompt] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sourceMode, setSourceMode] = useState<"pptx" | "video">("pptx");
  const [userPromptForUpload, setUserPromptForUpload] = useState("");
  const [titleForUpload, setTitleForUpload] = useState("");
  const [sending, setSending] = useState(false);
  const [regeneratingScene, setRegeneratingScene] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [rendering, setRendering] = useState(false);
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

  // Poll TTS progress while generating. We hit a tiny endpoint that just
  // returns the ttsProgress JSON column — the create/regenerate routes
  // write into it after each scene's TTS call.
  useEffect(() => {
    const shouldPoll = videoId && (status === "generating" || regeneratingScene !== null);
    if (!shouldPoll) {
      if (ttsProgress) setTtsProgress(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/training-videos/${videoId}/progress`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setTtsProgress(data.ttsProgress || null);
      } catch {}
    };
    tick();
    const handle = window.setInterval(tick, 2500);
    return () => { cancelled = true; window.clearInterval(handle); };
  }, [videoId, status, regeneratingScene]);

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
        setFinalMp4Url(v.finalMp4DriveUrl || null);
        setRenderError(v.renderError || null);
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
    setFinalMp4Url(null);
    setRenderError(null);
    router.replace("/training-videos");
  };

  const renderMp4 = async () => {
    if (!videoId) return;
    setRendering(true);
    setRenderError(null);
    setStatus("rendering");
    try {
      const res = await fetch(`/api/training-videos/${videoId}/render-mp4`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Render failed");
      setFinalMp4Url(data.mp4DriveUrl);
      setStatus("rendered");
    } catch (e: any) {
      setRenderError(e?.message || String(e));
      setStatus("ready");
    } finally {
      setRendering(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (sourceMode === "pptx" && !lower.endsWith(".pptx")) {
      setError("PPTX mode expects a .pptx file");
      return;
    }
    if (sourceMode === "video" && !lower.endsWith(".mp4") && !lower.endsWith(".mov")) {
      setError("Screen recording mode expects an .mp4 or .mov file");
      return;
    }
    setPendingFile(file);
    if (!titleForUpload) {
      setTitleForUpload(file.name.replace(/\.(pptx|mp4|mov)$/i, "").replace(/[_-]+/g, " "));
    }
  };

  const upload = async () => {
    if (!pendingFile) { setError("Pick a file first"); return; }
    if (!titleForUpload.trim()) { setError("Give it a title"); return; }
    setSending(true);
    setError(null);

    if (sourceMode === "video") {
      // Screen recordings can be hundreds of MB — bypass Cloud Run's 32MB
      // request cap by uploading directly to Drive's resumable upload URL.
      await uploadScreenRecording();
    } else {
      // PPTX is small (typically <5MB) — multipart form upload is fine.
      await uploadPptx();
    }
  };

  const uploadPptx = async () => {
    if (!pendingFile) return;
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
        { role: "user", content: `Uploaded ${pendingFile!.name}${userPromptForUpload ? ` — ${userPromptForUpload}` : ""}`, attachmentNames: [pendingFile!.name] },
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

  const uploadScreenRecording = async () => {
    if (!pendingFile) return;
    setStatus("uploading");
    setUploadProgress(0);
    try {
      // 1. Init: server mints a Drive access token + creates the DB row
      const initRes = await fetch("/api/training-videos/upload-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleForUpload,
          fileName: pendingFile.name,
          fileSize: pendingFile.size,
          userPrompt: userPromptForUpload.trim() || undefined,
          voice,
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData?.error || "Upload init failed");
      setVideoId(initData.videoId);
      setTitle(titleForUpload);
      router.replace(`/training-videos?resume=${initData.videoId}`);

      // 2. Upload directly to Drive's multipart endpoint. The browser sends
      // the metadata + bytes together; Drive returns the new file id.
      const driveFileId = await uploadToDriveMultipart({
        accessToken: initData.accessToken,
        parentFolderId: initData.parentFolderId,
        fileName: initData.fileName,
        mimeType: pendingFile.type || "video/mp4",
        file: pendingFile,
        onProgress: pct => setUploadProgress(pct),
      });
      setUploadProgress(100);

      // 3. Finalize: server kicks off extract-frames → script → TTS
      setStatus("generating");
      const finRes = await fetch("/api/training-videos/upload-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: initData.videoId, driveFileId }),
      });
      const finData = await finRes.json();
      if (!finRes.ok) throw new Error(finData?.error || "Pipeline failed after upload");
      setContent(finData.content);
      setVoiceFolderUrl(finData.videoFolderUrl || null);
      setMessages([
        { role: "user", content: `Uploaded ${pendingFile.name}${userPromptForUpload ? ` — ${userPromptForUpload}` : ""}`, attachmentNames: [pendingFile.name] },
        { role: "assistant", content: finData.reply || "Done — review the scenes on the right." },
      ]);
      setStatus("ready");
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatus("error");
    } finally {
      setUploadProgress(null);
      setSending(false);
    }
  };

  // Upload a file to Drive's multipart endpoint. The browser builds the
  // multipart body itself: a JSON metadata part + the binary file part.
  // This endpoint supports CORS when called with an Authorization header
  // (same path Drive's own JS SDK uses). XHR gives us upload progress.
  const uploadToDriveMultipart = (args: {
    accessToken: string;
    parentFolderId: string;
    fileName: string;
    mimeType: string;
    file: File;
    onProgress: (pct: number) => void;
  }): Promise<string> => new Promise((resolve, reject) => {
    const boundary = `cstboundary${Date.now()}${Math.random().toString(36).slice(2)}`;
    const metadata = JSON.stringify({
      name: args.fileName,
      mimeType: args.mimeType,
      parents: [args.parentFolderId],
    });
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${args.mimeType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    // Assemble the body as a Blob so the browser sets Content-Length and
    // streams it efficiently.
    const body = new Blob([head, args.file, tail]);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", true);
    xhr.setRequestHeader("Authorization", `Bearer ${args.accessToken}`);
    xhr.setRequestHeader("Content-Type", `multipart/related; boundary=${boundary}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        args.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (!data?.id) return reject(new Error("Drive returned no file id"));
          resolve(data.id);
        } catch (e: any) {
          reject(new Error(`Bad JSON from Drive: ${e?.message}`));
        }
      } else {
        reject(new Error(`Drive upload failed (HTTP ${xhr.status}): ${xhr.responseText?.slice(0, 300)}`));
      }
    };
    xhr.onerror = () => reject(new Error("Drive upload network error"));
    xhr.send(body);
  });

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
                <div className="font-bold text-slate-800 mb-1">
                  {sourceMode === "pptx" ? "Upload a PowerPoint deck" : "Upload a screen recording"}
                </div>
                {sourceMode === "pptx"
                  ? "I'll read every slide, generate narration scripts in Tarkie's voice, and produce voiceover audio for each scene."
                  : "I'll analyze the recording, segment it into logical scenes, write a fresh narration, and produce TTS voiceover that replaces the original audio."}
              </div>

              <div className="flex gap-2 rounded-lg bg-slate-100 p-1">
                <button
                  onClick={() => { setSourceMode("pptx"); setPendingFile(null); }}
                  className={`flex-1 px-3 py-1.5 rounded-md text-[12px] font-bold transition ${sourceMode === "pptx" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                >
                  PowerPoint
                </button>
                <button
                  onClick={() => { setSourceMode("video"); setPendingFile(null); }}
                  className={`flex-1 px-3 py-1.5 rounded-md text-[12px] font-bold transition ${sourceMode === "video" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                >
                  Screen recording
                </button>
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
                <label className="text-[11px] font-bold text-slate-700">
                  {sourceMode === "pptx" ? "PowerPoint file (.pptx)" : "Screen recording (.mp4 / .mov)"}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={sourceMode === "pptx"
                    ? ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    : ".mp4,.mov,video/mp4,video/quicktime"}
                  onChange={handleFile}
                  className="mt-1 w-full text-[12px]"
                />
                {pendingFile && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    <Paperclip className="w-2.5 h-2.5 inline -mt-0.5" /> {pendingFile.name} · {(pendingFile.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                )}
                {sourceMode === "video" && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    Max 500MB. Use the existing audio? Not yet — original audio is replaced by TTS narration.
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
            {status === "uploading" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold">
                <Loader2 className="w-3 h-3 animate-spin" />
                {uploadProgress !== null ? `Uploading (${uploadProgress}%)` : "Uploading"}
              </span>
            )}
            {status === "generating" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold">
                <Loader2 className="w-3 h-3 animate-spin" />
                {ttsProgressLabel(ttsProgress)}
              </span>
            )}
            {status === "ready" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                <CheckCircle2 className="w-3 h-3" /> Ready
              </span>
            )}
            {status === "rendering" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold">
                <Loader2 className="w-3 h-3 animate-spin" /> Rendering MP4
              </span>
            )}
            {status === "rendered" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-[10px] font-bold">
                <CheckCircle2 className="w-3 h-3" /> MP4 ready
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {voiceFolderUrl && (
              <a href={voiceFolderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-bold hover:border-violet-300">
                <ExternalLink className="w-3.5 h-3.5" /> Drive folder
              </a>
            )}
            {finalMp4Url && (
              <a href={finalMp4Url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-300 bg-violet-50 text-violet-700 text-[11px] font-bold hover:bg-violet-100">
                <Play className="w-3.5 h-3.5" /> Open MP4
              </a>
            )}
            <button
              onClick={downloadBundle}
              disabled={!videoId || !content || downloading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-bold hover:border-violet-300 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
              {downloading ? "Bundling…" : "Bundle"}
            </button>
            <button
              onClick={renderMp4}
              disabled={!videoId || !content || rendering || status === "rendering"}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 text-white text-[11px] font-bold hover:bg-violet-600 disabled:opacity-50"
            >
              {rendering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorPlay className="w-3.5 h-3.5" />}
              {rendering ? "Rendering (1-3 min)…" : finalMp4Url ? "Re-render MP4" : "Render MP4"}
            </button>
          </div>
        </div>
        {renderError && (
          <div className="bg-rose-50 border-b border-rose-200 px-6 py-2 text-[12px] text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div><strong>Render failed:</strong> {renderError}</div>
          </div>
        )}

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
                  videoId={videoId!}
                  scene={scene}
                  regenerating={regeneratingScene === scene.order}
                  onRegenerate={() => regenerateSceneAudio(scene.order)}
                  onSceneUpdated={(updated) => {
                    setContent(c => {
                      if (!c) return c;
                      return { ...c, scenes: c.scenes.map(s => s.order === updated.order ? updated : s) };
                    });
                  }}
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
  videoId,
  scene,
  regenerating,
  onRegenerate,
  onSceneUpdated,
}: {
  videoId: string;
  scene: TrainingScene;
  regenerating: boolean;
  onRegenerate: () => void;
  onSceneUpdated: (s: TrainingScene) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftScript, setDraftScript] = useState(scene.narrationScript);
  const [draftTitle, setDraftTitle] = useState(scene.title);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // If parent updates the scene (e.g. after audio regen), reset draft to match
  useEffect(() => {
    if (!editing) {
      setDraftScript(scene.narrationScript);
      setDraftTitle(scene.title);
    }
  }, [scene.narrationScript, scene.title, editing]);

  const startEdit = () => {
    setDraftScript(scene.narrationScript);
    setDraftTitle(scene.title);
    setEditing(true);
    setSaveError(null);
  };
  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
  };
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/training-videos/${videoId}/scenes/${scene.order}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          narrationScript: draftScript,
          title: draftTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      onSceneUpdated(data.scene);
      setEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const dirty = editing && (draftScript !== scene.narrationScript || draftTitle !== scene.title);
  const audioStale = scene.edited && !scene.audioDriveUrl;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Scene {scene.order}{scene.sourceSlideNumber ? ` · slide ${scene.sourceSlideNumber}` : ""}
            {scene.edited && <span className="ml-2 text-violet-600">· edited</span>}
          </div>
          {editing ? (
            <input
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              disabled={saving}
              className="mt-0.5 w-full text-[14px] font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-violet-400"
            />
          ) : (
            <div className="text-[14px] font-bold text-slate-800 mt-0.5">{scene.title}</div>
          )}
        </div>
        <div className="text-[10px] text-slate-400 shrink-0">
          {scene.audioDurationSec ? `${scene.audioDurationSec.toFixed(1)}s` : "—"}
        </div>
      </div>

      {editing ? (
        <textarea
          value={draftScript}
          onChange={e => setDraftScript(e.target.value)}
          disabled={saving}
          rows={Math.max(3, draftScript.split("\n").length)}
          className="w-full text-[13px] text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed focus:outline-none focus:border-violet-400 resize-y"
        />
      ) : (
        <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap">{scene.narrationScript}</p>
      )}

      {scene.aiNote && !editing && (
        <div className="mt-2 text-[10px] text-slate-400 italic">{scene.aiNote}</div>
      )}

      {saveError && (
        <div className="mt-2 rounded bg-rose-50 border border-rose-200 px-2 py-1 text-[11px] text-rose-700">{saveError}</div>
      )}

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {editing ? (
          <>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 text-white text-[11px] font-bold hover:bg-violet-600 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
            <span className="text-[10px] text-slate-400 italic ml-auto">
              Audio will need a regen after saving.
            </span>
          </>
        ) : (
          <>
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
              <span className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> No audio{audioStale ? " — stale after edit" : ""}
              </span>
            )}
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-violet-600 disabled:opacity-50"
            >
              {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {regenerating ? "Regenerating…" : "Regenerate audio"}
            </button>
            <button
              onClick={startEdit}
              className="text-[11px] font-bold text-slate-500 hover:text-violet-600 ml-auto"
            >
              Edit script
            </button>
          </>
        )}
      </div>
    </div>
  );
}
