"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, AlertTriangle, CheckCircle2, Mail, Edit2, Trash2, X, Save } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useSession } from "next-auth/react";

interface Campaign {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetScope: string | null;
  closesAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Target {
  id: string;
  rmUserId: string;
  rmName: string | null;
  rmEmail: string | null;
  clientProfileId: string;
  companyName: string | null;
  emailSentAt: string | null;
  emailError: string | null;
  submittedAt: string | null;
  submittedAssessmentId: string | null;
}
interface RmGroup {
  rmUserId: string;
  rmName: string | null;
  rmEmail: string | null;
  accounts: Array<{ id: string; name: string }>;
}

export default function CampaignDetailPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";
  const id = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [preview, setPreview] = useState<{ rmGroups: RmGroup[]; totalRms: number; totalAccounts: number; accountsMissingPrimaryRm: Array<{ id: string; companyName: string; industry: string }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editClosesAt, setEditClosesAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/assessment-campaigns/${id}`);
      if (res.ok) {
        const data = await res.json();
        setCampaign(data.campaign);
        setTargets(data.targets || []);
        setEditTitle(data.campaign.title);
        setEditDescription(data.campaign.description || "");
        setEditClosesAt(data.campaign.closesAt ? data.campaign.closesAt.slice(0, 10) : "");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/admin/assessment-campaigns/${id}/preview`);
      if (res.ok) setPreview(await res.json());
    } finally {
      setPreviewLoading(false);
    }
  }, [id]);

  useEffect(() => { if (isAdmin && id) { load(); loadPreview(); } }, [isAdmin, id, load, loadPreview]);

  const saveEdit = async () => {
    const res = await fetch(`/api/admin/assessment-campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle.trim(),
        description: editDescription.trim(),
        closesAt: editClosesAt || null,
      }),
    });
    if (res.ok) {
      setEditing(false);
      await load();
      await loadPreview();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err?.error || "Save failed");
    }
  };

  const deleteCampaign = async () => {
    if (!confirm(`Delete the campaign "${campaign?.title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/admin/assessment-campaigns/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/admin/assessment-campaigns");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err?.error || "Delete failed");
    }
  };

  const publish = async () => {
    if (!preview || preview.totalAccounts === 0) {
      alert("Nothing to publish — no (RM, account) pairs match. Set Primary RM on the in-scope accounts first.");
      return;
    }
    const msg = preview.accountsMissingPrimaryRm.length > 0
      ? `Publishing will email ${preview.totalRms} RM(s) about ${preview.totalAccounts} account(s).\n\n⚠ ${preview.accountsMissingPrimaryRm.length} in-scope account(s) have no Primary RM and will be skipped.\n\nContinue?`
      : `Publishing will email ${preview.totalRms} RM(s) about ${preview.totalAccounts} account(s).\n\nContinue?`;
    if (!confirm(msg)) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/admin/assessment-campaigns/${id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Publish failed");
      } else {
        let summary = `Published.\n\nRMs emailed: ${data.rmCount}\nAccounts in queue: ${data.accountCount}\nEmails sent: ${data.emailsSent}\nEmails failed: ${data.emailsFailed}`;
        if (data.errors?.length) summary += `\n\nIssues:\n${data.errors.join("\n")}`;
        alert(summary);
        await load();
      }
    } finally {
      setPublishing(false);
    }
  };

  if (!isAdmin) return <div className="max-w-3xl mx-auto p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;
  if (loading || !campaign) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }

  const isDraft = campaign.status === "draft";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <Link href="/admin/assessment-campaigns" className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-indigo-600">
        <ArrowLeft className="w-3 h-3" /> Back to campaigns
      </Link>

      {/* Header */}
      <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        {!editing ? (
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h1 className="text-[18px] font-black text-slate-900">{campaign.title}</h1>
              {campaign.description && <p className="text-[12px] text-slate-600 mt-1 whitespace-pre-wrap">{campaign.description}</p>}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                <span>Status: <span className="text-slate-800">{campaign.status}</span></span>
                {campaign.closesAt && <span>Deadline: <span className="text-slate-800">{new Date(campaign.closesAt).toLocaleDateString()}</span></span>}
                {campaign.publishedAt && <span>Published: <span className="text-slate-800">{new Date(campaign.publishedAt).toLocaleString()}</span></span>}
              </div>
            </div>
            {isDraft && (
              <div className="flex items-center gap-1">
                <button onClick={() => setEditing(true)} className="p-1.5 text-slate-400 hover:text-indigo-600"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={deleteCampaign} className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] font-bold outline-none focus:border-indigo-300" />
            <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300" />
            <input type="date" value={editClosesAt} onChange={e => setEditClosesAt(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300" />
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600">Cancel</button>
              <button onClick={saveEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-[11px] font-black uppercase tracking-widest"><Save className="w-3 h-3" /> Save</button>
            </div>
          </div>
        )}
      </section>

      {/* DRAFT: preview + publish */}
      {isDraft && (
        <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-black text-slate-800">Preview — who'll be notified</h2>
            <button onClick={loadPreview} disabled={previewLoading} className="text-[10px] font-bold text-slate-500 hover:text-indigo-600">
              {previewLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Refresh"}
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            Target scope is currently <strong>all active accounts</strong> (v1 — scope editor will be added later). Each Primary RM gets one email digesting all their accounts.
          </p>

          {!preview ? (
            <div className="text-center py-6"><Loader2 className="w-4 h-4 animate-spin text-slate-400 inline" /></div>
          ) : preview.totalAccounts === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>No (RM, account) pairs found. Make sure at least one account has a Primary RM set via the account detail page or bulk import.</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="RMs to email" value={preview.totalRms} />
                <Stat label="Accounts in queue" value={preview.totalAccounts} />
              </div>
              <div className="border border-slate-100 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">RM</th>
                      <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Accounts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rmGroups.map(g => (
                      <tr key={g.rmUserId} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <p className="font-bold text-slate-800">{g.rmName || "—"}</p>
                          <p className="text-[10px] text-slate-400">{g.rmEmail || "no email"}</p>
                        </td>
                        <td className="px-3 py-2">
                          <p className="text-[11px] text-slate-700">{g.accounts.map(a => a.name).join(", ")}</p>
                          <p className="text-[9px] text-slate-400">{g.accounts.length} account{g.accounts.length === 1 ? "" : "s"}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.accountsMissingPrimaryRm.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800">
                  <p className="font-bold flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {preview.accountsMissingPrimaryRm.length} account{preview.accountsMissingPrimaryRm.length === 1 ? "" : "s"} have no Primary RM
                  </p>
                  <p className="text-[10px]">These will be skipped: {preview.accountsMissingPrimaryRm.map(a => a.companyName).join(", ")}</p>
                  <p className="text-[10px] mt-1">Set Primary RM on each account before publishing (account detail → Access Control → star icon).</p>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end pt-2 border-t border-slate-100">
            <button
              onClick={publish}
              disabled={publishing || !preview || preview.totalAccounts === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
            >
              {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Publish & Send Emails
            </button>
          </div>
        </section>
      )}

      {/* PUBLISHED: targets list */}
      {!isDraft && (
        <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-[13px] font-black text-slate-800">Queue · {targets.length} entries</h2>
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
              <span className="text-emerald-700">✓ {targets.filter(t => t.submittedAt).length} submitted</span>
              <span className="text-slate-500">⌛ {targets.filter(t => !t.submittedAt).length} pending</span>
            </div>
          </div>
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Account</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">RM</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Email</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase text-[9px] tracking-widest">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {targets.map(t => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link href={`/accounts/${t.clientProfileId}`} className="text-indigo-700 font-bold hover:underline">{t.companyName || "—"}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{t.rmName || "—"}</td>
                  <td className="px-3 py-2">
                    {t.emailError ? (
                      <span className="text-rose-600" title={t.emailError}>✗ failed</span>
                    ) : t.emailSentAt ? (
                      <span className="text-emerald-600">✓ {formatDate(t.emailSentAt)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {t.submittedAt ? (
                      <span className="text-emerald-700 font-bold">✓ {formatDate(t.submittedAt)}</span>
                    ) : (
                      <span className="text-slate-400">pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="text-lg font-black text-slate-900">{value}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return iso; }
}
