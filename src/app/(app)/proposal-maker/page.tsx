"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  FileText, Settings, Loader2, AlertTriangle, ExternalLink, Sparkles,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface TemplateMeta {
  driveFileName: string | null;
  driveFileId: string;
  syncStatus: "pending" | "extracted" | "error";
}

export default function ProposalMakerPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  useBreadcrumbs([{ label: "Proposal Maker" }]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [template, setTemplate] = useState<TemplateMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/proposal-maker/settings");
        if (res.ok) {
          const data = await res.json();
          setTemplate(data?.template || null);
        } else if (res.status !== 403) {
          setError((await res.json())?.error || "Failed to load template state.");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" /> Proposal Maker
          </h1>
          <p className="text-[12px] text-slate-500 mt-1">
            Generate client-facing proposals from your branded template. Auto-files to per-account Drive folders.
          </p>
        </div>
        {isAdmin && (
          <ForceLink href="/proposal-maker/settings" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[12px] font-bold hover:border-indigo-300">
            <Settings className="w-4 h-4" /> Settings
          </ForceLink>
        )}
      </div>

      {/* Template state */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : isAdmin && (!template || template.syncStatus !== "extracted") ? (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="text-[13px] text-amber-900">
            <p className="font-bold">Set up the template before generating proposals</p>
            <p className="mt-1">Open <ForceLink href="/proposal-maker/settings" className="underline">Settings</ForceLink> and paste your template's Drive link.</p>
          </div>
        </div>
      ) : !template ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-600">
          The proposal template isn't set up yet. An admin needs to configure it.
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-[13px] flex items-start gap-3">
          <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <p className="text-emerald-900"><strong>Active template:</strong> {template.driveFileName || "(unnamed)"}</p>
            <a href={`https://drive.google.com/file/d/${template.driveFileId}/view`} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-700 hover:underline inline-flex items-center gap-1 mt-0.5">
              <ExternalLink className="w-3 h-3" /> Open in Drive
            </a>
          </div>
        </div>
      )}

      {/* Coming-next teaser */}
      <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h2 className="text-[14px] font-black text-slate-900">Generation UI is coming soon</h2>
            <p className="text-[12px] text-slate-600 mt-1">
              Phase F.1 ships the foundation: Drive template wiring, per-account folder auto-creation, and the audit log. The form for entering proposal inputs (objectives, SOW, deliverables, cost, etc.) lands in F.2, and the ARIMA <code>create_proposal</code> tool lands in F.3.
            </p>
            <p className="text-[12px] text-slate-600 mt-2">
              For now, admins can use <ForceLink href="/proposal-maker/settings" className="underline">Settings</ForceLink> to load the template and confirm it parses cleanly.
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-900">
          {error}
        </div>
      )}
    </div>
  );
}
