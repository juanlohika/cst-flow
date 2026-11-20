"use client";

/**
 * AI Tools › PDF Compressor.
 *
 * Shrinks scanned PDFs (signed contracts, certificates) with Ghostscript.
 * No AI. Flow: get a signed upload URL → browser uploads straight to the
 * private temp bucket → worker compresses → browser downloads via a signed URL.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileDown, FileText, Loader2, RotateCcw, ShieldCheck, UploadCloud } from "lucide-react";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

const MAX_MB = 200;

type Quality = "small" | "standard" | "high";
type Stage = "idle" | "preparing" | "uploading" | "processing" | "done";

const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: "small", label: "Small · 100 dpi", hint: "Team default. Smallest file, text stays readable." },
  { value: "standard", label: "Standard · 150 dpi", hint: "Sharper. Good for fine print." },
  { value: "high", label: "High · 300 dpi", hint: "For printing or archiving. Larger file." },
];

interface Result {
  fileName: string;
  downloadUrl: string;
  pages: number | null;
  originalBytes: number;
  compressedBytes: number;
  resizedToA4: boolean;
  keptOriginal: boolean;
}

function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void, xhrRef: { current: XMLHttpRequest | null }) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}

export default function PdfCompressorPage() {
  useBreadcrumbs([{ label: "AI Tools", href: "/ai-tools" }, { label: "PDF Compressor" }]);

  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState<Quality>("small");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => () => xhrRef.current?.abort(), []);

  const pick = useCallback((f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!/\.pdf$/i.test(f.name)) return setError("Only PDF files are accepted.");
    if (f.size > MAX_MB * 1024 * 1024) return setError(`This file is larger than ${MAX_MB} MB.`);
    setFile(f);
    setResult(null);
    setStage("idle");
  }, []);

  function reset() {
    xhrRef.current?.abort();
    setFile(null);
    setResult(null);
    setError(null);
    setStage("idle");
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function compress() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      setStage("preparing");
      const { jobId, uploadUrl } = await postJson<{ jobId: string; uploadUrl: string }>(
        "/api/tools/pdf-compress/upload-url",
        { fileName: file.name, size: file.size },
      );
      setStage("uploading");
      await uploadWithProgress(uploadUrl, file, setProgress, xhrRef);
      setStage("processing");
      const r = await postJson<Result>("/api/tools/pdf-compress/compress", { jobId, fileName: file.name, quality });
      setResult(r);
      setStage("done");
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
      setStage("idle");
    }
  }

  const busy = stage === "preparing" || stage === "uploading" || stage === "processing";
  const saved = result ? Math.max(0, 1 - result.compressedBytes / result.originalBytes) : 0;
  const buttonLabel =
    stage === "preparing" ? "Preparing…" :
    stage === "uploading" ? `Uploading ${progress}%` :
    stage === "processing" ? "Compressing…" : "Compress PDF";

  return (
    <div className="container py-10 space-y-6 max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">PDF Compressor</h1>
        <p className="text-sm text-slate-500">
          Shrink scanned PDFs such as signed contracts, so they are easy to email and store. No AI is used.
        </p>
      </header>

      {/* 1. File */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) pick(e.dataTransfer.files?.[0]); }}
        onClick={() => !busy && inputRef.current?.click()}
        className={[
          "rounded-2xl border-2 border-dashed bg-white p-10 flex flex-col items-center justify-center gap-2 text-center transition-colors",
          busy ? "cursor-default opacity-70" : "cursor-pointer hover:border-blue-400 hover:bg-blue-50/40",
          dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300",
        ].join(" ")}
      >
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <>
            <FileText className="w-9 h-9 text-blue-600" />
            <span className="text-sm font-semibold text-slate-900 break-all">{file.name}</span>
            <span className="text-xs text-slate-500">{fmtSize(file.size)} · click or drop to choose another file</span>
          </>
        ) : (
          <>
            <UploadCloud className="w-9 h-9 text-slate-400" />
            <span className="text-sm font-semibold text-slate-900">Drop a PDF here, or click to browse</span>
            <span className="text-xs text-slate-500">PDF only, up to {MAX_MB} MB</span>
          </>
        )}
      </div>

      {/* 2. Quality */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900 mb-3">Quality</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {QUALITIES.map((q) => (
            <button
              key={q.value}
              type="button"
              disabled={busy}
              onClick={() => { setQuality(q.value); if (stage === "done") { setResult(null); setStage("idle"); } }}
              className={[
                "text-left rounded-xl border px-3 py-2.5 transition-colors",
                quality === q.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50",
              ].join(" ")}
            >
              <div className="text-sm font-semibold text-slate-900">{q.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{q.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 3. Action */}
      {stage !== "done" && (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={compress}
            disabled={!file || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {buttonLabel}
          </button>
          {busy && (
            <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={["h-full bg-blue-600 transition-all", stage !== "uploading" ? "animate-pulse" : ""].join(" ")}
                style={{ width: `${stage === "uploading" ? progress : 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* 4. Result */}
      {stage === "done" && result && (
        <div className="rounded-2xl border border-green-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
            <CheckCircle2 className="w-4 h-4" /> Done
          </div>
          {result.keptOriginal ? (
            <p className="text-sm text-slate-700">
              This PDF is already compact. Compressing would not make it smaller, so you get the original back unchanged.
            </p>
          ) : (
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-sm text-slate-400 line-through">{fmtSize(result.originalBytes)}</span>
              <span className="text-3xl font-bold text-slate-900">{fmtSize(result.compressedBytes)}</span>
              <span className="text-sm font-semibold text-green-700">{Math.round(saved * 100)}% smaller</span>
            </div>
          )}
          <div className="text-xs text-slate-500">
            {result.pages ? `${result.pages} pages · ` : ""}
            {QUALITIES.find((q) => q.value === quality)?.label}
            {result.resizedToA4 ? " · oversized phone-scan pages resized to A4" : ""}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={result.downloadUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <FileDown className="w-4 h-4" /> Download
            </a>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="w-4 h-4" /> Compress another
            </button>
          </div>
          <div className="text-xs text-slate-400 break-all">{result.fileName} · download link works for 30 minutes</div>
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Only signed-in CST OS users can use this tool. Files go to a private, temporary Google Cloud folder on our own
          account. The original is deleted as soon as it is compressed, and the result is deleted automatically within a day.
        </span>
      </div>
    </div>
  );
}
