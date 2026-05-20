"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Loader2, RefreshCw, Save, AlertTriangle, CheckCircle2, ExternalLink,
  FileText, FolderOpen, Settings,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface TemplateRecord {
  id: string;
  driveFileId: string;
  driveFileName: string | null;
  driveFolderId: string | null;
  proposalsRootFolderId: string | null;
  extractedSpec: string | null;
  rawHtmlPreview: string | null;
  syncStatus: "pending" | "extracted" | "error";
  syncError: string | null;
  lastSyncedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export default function ProposalMakerSettingsPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  useBreadcrumbs([
    { label: "Proposal Maker", href: "/proposal-maker" },
    { label: "Settings" },
  ]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [template, setTemplate] = useState<TemplateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [prototyping, setPrototyping] = useState(false);
  const [prototypeResult, setPrototypeResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateLink, setTemplateLink] = useState("");
  const [proposalsRootLink, setProposalsRootLink] = useState("");
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proposal-maker/settings");
      if (res.ok) {
        const data = await res.json();
        setTemplate(data?.template || null);
        if (data?.template?.driveFileId) {
          setTemplateLink(`https://drive.google.com/file/d/${data.template.driveFileId}/view`);
        }
        if (data?.template?.proposalsRootFolderId) {
          setProposalsRootLink(`https://drive.google.com/drive/folders/${data.template.proposalsRootFolderId}`);
        }
      } else {
        setError((await res.json())?.error || "Failed to load.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/proposal-maker/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateLink, proposalsRootLink }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save.");
      setTemplate(data?.template || null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const resync = async () => {
    setResyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/proposal-maker/settings/resync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to resync.");
      setTemplate(data?.template || null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setResyncing(false);
    }
  };

  const runPrototype = async () => {
    setPrototyping(true);
    setPrototypeResult(null);
    setError(null);
    try {
      const res = await fetch("/api/proposal-maker/prototype-generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Prototype failed");
      setPrototypeResult(data);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setPrototyping(false);
    }
  };

  if (!isAdmin) return <div className="p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  const outline = template?.extractedSpec ? safeJson(template.extractedSpec) : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-500" /> Proposal Maker · Settings
          </h1>
          <p className="text-[12px] text-slate-500 mt-1">
            Configure the active proposal template + the Drive folder where generated proposals are filed.
          </p>
        </div>
        <ForceLink href="/proposal-maker" className="text-[12px] text-indigo-700 hover:underline flex items-center gap-1">
          ← Back to Proposal Maker
        </ForceLink>
      </div>

      {error && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <div className="text-[13px] text-rose-900">
            <p className="font-bold">Something went wrong</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Inputs */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-[13px] font-black uppercase tracking-widest text-slate-500">Drive Configuration</h2>

        <div>
          <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-slate-400" /> Template file
          </label>
          <input
            value={templateLink}
            onChange={e => setTemplateLink(e.target.value)}
            placeholder="https://docs.google.com/document/d/…/edit"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-300"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Paste the Drive share link for your proposal template (.docx or Google Doc). The file must be shared with the service account.
          </p>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" /> Proposals root folder
          </label>
          <input
            value={proposalsRootLink}
            onChange={e => setProposalsRootLink(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-300"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Generated proposals get filed under <code>this folder / &lt;Account Name&gt; / &lt;date&gt; — &lt;account&gt; — &lt;title&gt;.docx</code>.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving || !templateLink.trim() || !proposalsRootLink.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 text-white text-[12px] font-bold hover:bg-indigo-600 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Verify
          </button>
          {template?.driveFileId && (
            <button onClick={resync} disabled={resyncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[12px] font-bold hover:border-indigo-300 disabled:opacity-50">
              {resyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Re-sync
            </button>
          )}
        </div>
      </section>

      {/* Current state */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : template ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-[13px] font-black uppercase tracking-widest text-slate-500">Current Template</h2>
            <SyncBadge status={template.syncStatus} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400">File</div>
              <div className="text-slate-800 font-medium truncate">{template.driveFileName || "(no name)"}</div>
              <a href={`https://drive.google.com/file/d/${template.driveFileId}/view`} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 hover:underline inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Open in Drive
              </a>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400">Last sync</div>
              <div className="text-slate-800 font-medium">{template.lastSyncedAt ? new Date(template.lastSyncedAt).toLocaleString() : "—"}</div>
            </div>
          </div>
          {template.syncError && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-900">
              <strong>Note:</strong> {template.syncError}
            </div>
          )}
          {outline && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[12px] space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-black">Detected structure</div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Paragraphs" value={outline.paragraphCount} />
                <Stat label="Tables" value={outline.tableCount} />
                <Stat label="Bullet lists" value={outline.bulletListCount} />
                <Stat label="Images" value={outline.images} />
              </div>
              {Array.isArray(outline.headings) && outline.headings.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-black mt-2">Headings</div>
                  <ul className="mt-1 space-y-0.5">
                    {outline.headings.map((h: any, i: number) => (
                      <li key={i} className="text-slate-700">
                        <span className="text-[10px] font-mono text-slate-400 mr-2">H{h.level}</span>{h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(outline.placeholderTags) && outline.placeholderTags.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-black mt-2">Placeholder tags found</div>
                  <ul className="mt-1 space-y-0.5">
                    {outline.placeholderTags.map((t: string, i: number) => (
                      <li key={i} className="font-mono text-[11px] text-indigo-700">{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {template.rawHtmlPreview && (
            <div>
              <button onClick={() => setShowHtmlPreview(v => !v)} className="text-[11px] text-slate-500 hover:underline">
                {showHtmlPreview ? "Hide" : "Show"} extracted HTML preview
              </button>
              {showHtmlPreview && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4 max-h-[400px] overflow-y-auto text-[12px] [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-1.5 [&_th]:border [&_th]:border-slate-200 [&_th]:p-1.5"
                  dangerouslySetInnerHTML={{ __html: template.rawHtmlPreview }}
                />
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500">
          No template configured yet. Paste a Drive link above and click <strong>Save &amp; Verify</strong>.
        </section>
      )}

      {template && template.syncStatus === "extracted" && (
        <section className="rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/40 to-white p-5 space-y-3">
          <div>
            <h2 className="text-[13px] font-black uppercase tracking-widest text-indigo-700">Phase F.2 — AI Prototype</h2>
            <p className="text-[12px] text-slate-600 mt-1">
              Generate a sample proposal using the current template + a hardcoded Manpower Costing scenario. AI judges what to fill where — no template markup required. Use this to evaluate output quality before committing to the full build.
            </p>
          </div>
          <button onClick={runPrototype} disabled={prototyping}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 text-white text-[12px] font-bold hover:bg-indigo-600 disabled:opacity-50">
            {prototyping ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {prototyping ? "Generating (this can take 20-40s)…" : "Run AI Prototype"}
          </button>

          {prototypeResult && (
            <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-2 text-[12px]">
              {prototypeResult.ok ? (
                <>
                  <div className="flex items-center gap-2 text-emerald-700 font-bold">
                    <CheckCircle2 className="w-4 h-4" /> Generated
                  </div>
                  <div>
                    <a href={prototypeResult.driveUrl} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline inline-flex items-center gap-1 break-all">
                      <ExternalLink className="w-3 h-3 shrink-0" /> {prototypeResult.fileName}
                    </a>
                  </div>
                  <div className="text-slate-500">
                    Operations applied: <strong className="text-slate-800">{prototypeResult.operationsApplied}</strong>
                    {prototypeResult.operationsSkipped?.length > 0 && (
                      <> · skipped: <strong className="text-amber-700">{prototypeResult.operationsSkipped.length}</strong></>
                    )}
                  </div>
                  {prototypeResult.aiResponse?.summary && (
                    <div className="rounded bg-slate-50 p-2 text-slate-600">
                      <strong>AI summary:</strong> {prototypeResult.aiResponse.summary}
                    </div>
                  )}
                  {prototypeResult.operationsSkipped?.length > 0 && (
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-amber-700 hover:underline">Show {prototypeResult.operationsSkipped.length} skipped op(s)</summary>
                      <ul className="mt-1 space-y-1 ml-4 list-disc">
                        {prototypeResult.operationsSkipped.map((s: any, i: number) => (
                          <li key={i}>
                            <code className="text-slate-600">{s.op.op}</code> — {s.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <div className="text-rose-700">{prototypeResult.error || "Generation failed"}</div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SyncBadge({ status }: { status: string }) {
  if (status === "extracted") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-bold">
      <CheckCircle2 className="w-3 h-3" /> Extracted
    </span>
  );
  if (status === "error") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 text-[11px] font-bold">
      <AlertTriangle className="w-3 h-3" /> Error
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[11px] font-bold">Pending</span>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-slate-800 font-bold">{value}</div>
    </div>
  );
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
