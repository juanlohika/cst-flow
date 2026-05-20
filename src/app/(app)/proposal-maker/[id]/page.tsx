"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2, ArrowLeft, ExternalLink, FileText, CheckCircle2, AlertTriangle,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import ProposalDocument from "@/components/proposal/ProposalDocument";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import type { ProposalContent } from "@/lib/proposal/types";

interface ProposalRow {
  id: string;
  clientProfileId: string;
  title: string;
  versionNumber: number;
  status: string;
  pdfDriveFileId: string | null;
  pdfDriveUrl: string | null;
  exportedAt: string | null;
  generatedAt: string;
  clientName: string | null;
  content: ProposalContent | null;
}

export default function ProposalDetailPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  useBreadcrumbs([
    { label: "Proposal Maker", href: "/proposal-maker" },
    { label: "Draft" },
  ]);

  const [proposal, setProposal] = useState<ProposalRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/proposal-maker/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load");
        setProposal(data.proposal);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const exportPdf = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposal-maker/${id}/export-pdf`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Export failed");
      setProposal(p => p ? { ...p, pdfDriveFileId: data.pdfDriveFileId, pdfDriveUrl: data.pdfDriveUrl, status: "exported", exportedAt: new Date().toISOString() } : p);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  if (error) return <div className="p-6 max-w-3xl mx-auto"><div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-rose-900 text-[13px]">{error}</div></div>;
  if (!proposal || !proposal.content) return <div className="p-6 text-slate-500">Proposal not found.</div>;

  return (
    <div className="bg-slate-50 min-h-screen pb-12">
      <div className="bg-white border-b border-slate-200 px-6 py-3 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <ForceLink href="/proposal-maker" className="inline-flex items-center gap-1.5 text-[12px] text-slate-700 hover:text-indigo-700">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Proposal Maker
          </ForceLink>
          <div className="flex items-center gap-2">
            {proposal.pdfDriveUrl && (
              <a href={proposal.pdfDriveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[12px] font-bold hover:border-indigo-300">
                <ExternalLink className="w-4 h-4" /> Open exported PDF
              </a>
            )}
            <button onClick={exportPdf} disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500 text-white text-[12px] font-bold hover:bg-indigo-600 disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {exporting ? "Generating PDF…" : (proposal.pdfDriveUrl ? "Re-export PDF" : "Export to PDF")}
            </button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto mt-2 flex items-center gap-3 text-[11px] text-slate-500">
          {proposal.status === "exported" ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="w-3 h-3" /> PDF exported {proposal.exportedAt ? new Date(proposal.exportedAt).toLocaleString() : ""}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700 font-bold"><AlertTriangle className="w-3 h-3" /> Draft — not yet exported</span>
          )}
          <span>·</span>
          <span>Version {proposal.versionNumber}</span>
          <span>·</span>
          <span>{proposal.clientName || "Unknown account"}</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-white shadow-lg rounded-xl overflow-hidden">
          <ProposalDocument content={proposal.content} showAiNotes={true} />
        </div>
      </div>
    </div>
  );
}
