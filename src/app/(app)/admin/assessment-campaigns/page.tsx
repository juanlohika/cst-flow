"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Mail, Users, CheckCircle2, AlertTriangle, Send, ChevronRight } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useSession } from "next-auth/react";

interface Campaign {
  id: string;
  title: string;
  description: string | null;
  status: string;
  closesAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  rmCount: number;
  accountCount: number;
  submittedCount: number;
  emailsSent: number;
  emailsFailed: number;
}

export default function AssessmentCampaignsPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [closesAt, setClosesAt] = useState("");

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/assessment-campaigns");
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data?.campaigns || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!title.trim()) { alert("Title is required"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/assessment-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          closesAt: closesAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data?.error || "Failed to create campaign"); return; }
      router.push(`/admin/assessment-campaigns/${data.id}`);
    } finally {
      setCreating(false);
    }
  };

  if (!isAdmin) {
    return <div className="max-w-3xl mx-auto p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="w-5 h-5 text-indigo-500" />
        <h1 className="text-lg font-black text-slate-900">Account Health · Assessment Campaigns</h1>
      </div>
      <p className="text-[12px] text-slate-500">
        Send a batch of Health Assessment invites to every Primary RM. RMs get an email with their account queue and a link to /assessments. Use it before major company milestones (board meetings, V5 rollout, quarterly reviews).
      </p>

      {/* Create */}
      <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <h2 className="text-[13px] font-black text-slate-800 mb-3">New campaign</h2>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Q2 2026 Account Health Check"
              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">Description (optional, shown in email body)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Short context for the RMs — why we're running this campaign now."
              rows={2}
              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300 resize-y"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">Deadline (optional)</label>
            <input
              type="date"
              value={closesAt}
              onChange={e => setClosesAt(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={create}
              disabled={creating || !title.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create Draft
            </button>
          </div>
        </div>
      </section>

      {/* List */}
      <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-[13px] font-black text-slate-800">All campaigns</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        ) : campaigns.length === 0 ? (
          <p className="text-[12px] text-slate-400 text-center py-8 italic">No campaigns yet. Create one above.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase tracking-widest text-[9px]">Title</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase tracking-widest text-[9px]">Status</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase tracking-widest text-[9px]">RMs</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase tracking-widest text-[9px]">Accounts</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase tracking-widest text-[9px]">Submitted</th>
                <th className="text-left px-3 py-2 font-black text-slate-500 uppercase tracking-widest text-[9px]">Emails</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/admin/assessment-campaigns/${c.id}`} className="text-indigo-700 font-bold hover:underline">{c.title}</Link>
                    <p className="text-[10px] text-slate-400">{formatDate(c.createdAt)}</p>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                  <td className="px-3 py-2 text-slate-700 font-bold">{c.rmCount}</td>
                  <td className="px-3 py-2 text-slate-700 font-bold">{c.accountCount}</td>
                  <td className="px-3 py-2">
                    <span className="text-slate-700 font-bold">{c.submittedCount}</span>
                    <span className="text-slate-400">/{c.accountCount}</span>
                  </td>
                  <td className="px-3 py-2">
                    {c.emailsSent > 0 && <span className="text-emerald-600 font-bold">{c.emailsSent} sent</span>}
                    {c.emailsFailed > 0 && <span className="text-rose-600 font-bold ml-2">{c.emailsFailed} failed</span>}
                    {c.emailsSent === 0 && c.emailsFailed === 0 && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/assessment-campaigns/${c.id}`} className="text-slate-400 hover:text-indigo-600">
                      <ChevronRight className="w-4 h-4 inline" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    draft: { bg: "bg-slate-100 text-slate-600", label: "Draft" },
    published: { bg: "bg-emerald-100 text-emerald-700", label: "Published" },
    closed: { bg: "bg-amber-100 text-amber-700", label: "Closed" },
    archived: { bg: "bg-slate-50 text-slate-400", label: "Archived" },
  };
  const m = map[status] || map.draft;
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${m.bg}`}>{m.label}</span>;
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; }
}
