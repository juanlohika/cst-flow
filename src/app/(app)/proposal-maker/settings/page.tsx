"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Loader2, Save, AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, Settings, FileText, BookOpen,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface SettingsRecord {
  id: string;
  proposalsRootFolderId: string;
  templateDriveFileId: string | null;
  templateDriveFileName: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export default function ProposalMakerSettingsPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const { data: session } = useSession();
  useBreadcrumbs([
    { label: "Proposal Maker", href: "/proposal-maker" },
    { label: "Settings" },
  ]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalsRootLink, setProposalsRootLink] = useState("");
  const [templateLink, setTemplateLink] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/proposal-maker/settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data?.settings || null);
        if (data?.settings?.proposalsRootFolderId) {
          setProposalsRootLink(`https://drive.google.com/drive/folders/${data.settings.proposalsRootFolderId}`);
        }
        if (data?.settings?.templateDriveFileId) {
          setTemplateLink(`https://drive.google.com/file/d/${data.settings.templateDriveFileId}/view`);
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
        body: JSON.stringify({ proposalsRootLink, templateLink }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save.");
      setSettings(data?.settings || null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return <div className="p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-500" /> Proposal Maker · Settings
          </h1>
          <p className="text-[12px] text-slate-500 mt-1">
            Drive folder + Word template config. Edit ARIMA's behavior via <a href="/admin/skills" className="underline">/admin/skills</a> (filter by category=proposal).
          </p>
        </div>
        <ForceLink href="/proposal-maker" className="text-[12px] text-indigo-700 hover:underline">
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

      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-[13px] font-black uppercase tracking-widest text-slate-500">Drive Configuration</h2>

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
            Generated PDFs are filed under <code>this folder / &lt;Account Name&gt; / &lt;date&gt; — &lt;account&gt; — &lt;title&gt; (v#).pdf</code>. Folder must be shared with the service account as Editor.
          </p>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-slate-400" /> Proposal template (.docx)
          </label>
          <input
            value={templateLink}
            onChange={e => setTemplateLink(e.target.value)}
            placeholder="https://docs.google.com/document/d/… (or Drive .docx link)"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:border-indigo-300"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Your branded Word template, with the 5 placeholders inserted (see guide below). Generated proposals are produced by filling these placeholders. The template must be shared with the service account as Editor.
          </p>
          <button onClick={() => setShowGuide(s => !s)} className="text-[11px] text-indigo-600 hover:underline mt-2 inline-flex items-center gap-1">
            <BookOpen className="w-3 h-3" /> {showGuide ? "Hide" : "Show"} template marker guide
          </button>
          {showGuide && <TemplateMarkerGuide />}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving || !proposalsRootLink.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 text-white text-[12px] font-bold hover:bg-indigo-600 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Verify
          </button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : settings ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-[13px] flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <p className="font-bold text-emerald-900">Configured</p>
            <p className="text-emerald-800 mt-1">
              <a href={`https://drive.google.com/drive/folders/${settings.proposalsRootFolderId}`} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Open Proposals folder in Drive
              </a>
            </p>
            {settings.templateDriveFileId ? (
              <p className="text-emerald-800 mt-1">
                <a href={`https://drive.google.com/file/d/${settings.templateDriveFileId}/view`} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Template: {settings.templateDriveFileName || "(unnamed)"}
                </a>
              </p>
            ) : (
              <p className="text-amber-700 mt-1 text-[12px]">
                <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-1" /> Template not yet configured. PDF export will fail until you add one.
              </p>
            )}
            <p className="text-[11px] text-emerald-700 mt-1">Last updated {new Date(settings.updatedAt).toLocaleString()}</p>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500">
          Not configured yet. Paste the Drive links above and click <strong>Save &amp; Verify</strong>.
        </section>
      )}
    </div>
  );
}

function TemplateMarkerGuide() {
  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4 text-[12px] text-slate-700 space-y-3">
      <p className="text-[13px] font-bold text-indigo-900">Template marker guide (one-time setup, ~15 minutes)</p>
      <p>
        Open your existing proposal template in Microsoft Word. You'll add 5 placeholders. After editing, save as .docx and re-upload to Drive (right-click the file in Drive → <em>Manage versions</em> → <em>Upload new version</em>) so the file ID stays the same.
      </p>

      <div className="space-y-3">
        <Step n={1} title="Client name reference (top of page 1)">
          Below the "A Proposal For:" line, insert a centered, bold paragraph with this exact text:
          <Code>{`{{client_company_name}}`}</Code>
          The twincom logo image itself can stay — team can manually paste the real client logo over it after the PDF is generated.
        </Step>

        <Step n={2} title="Version Tracking table">
          Replace the existing data row's 5 cells with these exact placeholders (one per cell):
          <table className="w-full text-[11px] mt-2 border border-slate-200">
            <thead className="bg-slate-50">
              <tr><Th>Ver</Th><Th>Date</Th><Th>Prepared By</Th><Th>Submitted To</Th><Th>Description</Th></tr>
            </thead>
            <tbody>
              <tr><Td><code>{`{{version_v}}`}</code></Td><Td><code>{`{{version_date}}`}</code></Td><Td><code>{`{{version_prepared_by}}`}</code></Td><Td><code>{`{{version_submitted_to}}`}</code></Td><Td><code>{`{{version_description}}`}</code></Td></tr>
            </tbody>
          </table>
        </Step>

        <Step n={3} title="Body content — the big one">
          Delete everything between the Version Tracking table and the Acceptance/Signoff table — Project Objectives, Scope, Investment, Estimated Timeline, even the Confidentiality Clause and Validity. Replace with a single placeholder on its own line:
          <Code>{`{{@body_content}}`}</Code>
          <p className="mt-2">
            <strong>Important:</strong> the <code>@</code> prefix tells docxtemplater to insert generated Word XML (paragraphs, headings, bullets, the cost table, the timeline table) instead of escaping it as text.
          </p>
          <p className="mt-2 text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded">
            <strong>If you want to keep Confidentiality + Validity fixed</strong>, leave them after <code>{`{{@body_content}}`}</code> but before the Signoff table. ARIMA will skip those sections in the generated body.
          </p>
        </Step>

        <Step n={4} title="Acceptance / Signoff table — Client (left) column">
          In the left column's cells, keep the labels and add placeholders only after them:
          <ul className="list-disc ml-5 mt-1">
            <li>Header cell: <code>{`{{client_company_name}}`}</code></li>
            <li>Signature: leave blank</li>
            <li>Name: <code>{`Name: {{client_signatory_name}}`}</code></li>
            <li>Designation: <code>{`Designation: {{client_signatory_title}}`}</code></li>
            <li>Date: leave blank (physical signature)</li>
          </ul>
        </Step>

        <Step n={5} title="Acceptance / Signoff table — MOI (right) column">
          Same pattern:
          <ul className="list-disc ml-5 mt-1">
            <li>Header cell: <code>MobileOptima Inc.</code> (no placeholder, this is always you)</li>
            <li>Signature: leave blank</li>
            <li>Name: <code>{`Name: {{moi_signatory_name}}`}</code></li>
            <li>Designation: <code>{`Designation: {{moi_signatory_title}}`}</code></li>
            <li>Date: <code>{`Date: {{proposal_date}}`}</code></li>
          </ul>
        </Step>
      </div>

      <div className="mt-3 rounded-lg bg-white border border-amber-200 p-3 text-amber-900">
        <p className="font-bold text-[12px]">Word tips</p>
        <ul className="list-disc ml-5 mt-1 text-[11px] space-y-0.5">
          <li>Type each <code>{`{{tag}}`}</code> in one continuous typing motion. If your cursor moves mid-tag (autocorrect, mouse click), Word might split it across XML runs — that breaks docxtemplater. Retype if so.</li>
          <li>Turn off Word's autocorrect temporarily (Word → Preferences → AutoCorrect → uncheck "Replace text as you type") to be safe.</li>
          <li>The <code>{`{`}</code> and <code>{`}`}</code> braces must be straight ASCII, not smart curly quotes.</li>
          <li>Once edited, save the file. Drive → right-click your existing template → "Manage versions" → "Upload new version". Keeps the same Drive ID.</li>
        </ul>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 p-3">
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 rounded-full bg-indigo-500 text-white text-[11px] font-black flex items-center justify-center shrink-0">{n}</div>
        <div className="flex-1">
          <div className="text-[12px] font-bold text-slate-800">{title}</div>
          <div className="text-[11px] text-slate-600 mt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <pre className="bg-slate-900 text-slate-100 text-[11px] font-mono p-2 rounded mt-2 overflow-x-auto">{children}</pre>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="border border-slate-200 px-2 py-1 text-left font-bold text-[10px] text-slate-600">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="border border-slate-200 px-2 py-1">{children}</td>;
}
