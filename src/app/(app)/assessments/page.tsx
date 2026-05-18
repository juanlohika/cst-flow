"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Loader2, CheckCircle2, ArrowRight, Calendar, AlertTriangle, Sparkles } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";

interface PendingItem {
  id: string;
  campaignId: string;
  campaignTitle: string;
  closesAt: string | null;
  accountId: string;
  companyName: string | null;
  industry: string | null;
}
interface SubmittedItem extends PendingItem {
  submittedAt: string | null;
}

export default function AssessmentsQueuePage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [submitted, setSubmitted] = useState<SubmittedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/assessments/queue");
      if (res.ok) {
        const data = await res.json();
        setPending(data.pending || []);
        setSubmitted(data.submitted || []);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-indigo-500" />
        <h1 className="text-lg font-black text-slate-900">My Assessment Queue</h1>
      </div>
      <p className="text-[12px] text-slate-500">
        Health Assessments your team has asked you to complete as the Primary RM. Each assessment takes about 5 minutes.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        </div>
      ) : pending.length === 0 && submitted.length === 0 ? (
        <section className="bg-white border border-slate-100 rounded-2xl p-8 text-center">
          <Sparkles className="w-6 h-6 text-slate-300 mx-auto mb-2" />
          <p className="text-[13px] font-bold text-slate-700">All clear</p>
          <p className="text-[11px] text-slate-500 mt-1">
            You don't have any pending assessments. When an admin publishes a campaign, the accounts where you're tagged as Primary RM will appear here.
          </p>
        </section>
      ) : (
        <>
          {/* Pending */}
          <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-black text-slate-800">Pending</h2>
                <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[9px] font-black uppercase tracking-widest border border-rose-100">
                  {pending.length}
                </span>
              </div>
            </div>
            {pending.length === 0 ? (
              <p className="text-[12px] text-slate-400 text-center py-6 italic">No pending assessments — nice work.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pending.map(item => (
                  <PendingRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>

          {/* Submitted */}
          {submitted.length > 0 && (
            <section className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <h2 className="text-[13px] font-black text-slate-800">Submitted</h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-widest border border-emerald-100">
                  {submitted.length}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {submitted.map(item => (
                  <SubmittedRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PendingRow({ item }: { item: PendingItem }) {
  const deadline = item.closesAt ? new Date(item.closesAt) : null;
  const overdueOrSoon = deadline && (deadline.getTime() - Date.now()) < 3 * 24 * 60 * 60 * 1000;
  return (
    <li className="px-5 py-3 hover:bg-slate-50 group">
      <Link href={`/accounts/${item.accountId}`} className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[13px] text-slate-800 truncate group-hover:text-indigo-700">{item.companyName || "—"}</p>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
            <span>{item.campaignTitle}</span>
            {item.industry && <><span>·</span><span>{item.industry}</span></>}
            {deadline && (
              <>
                <span>·</span>
                <span className={overdueOrSoon ? "text-rose-600 font-bold flex items-center gap-1" : ""}>
                  {overdueOrSoon && <AlertTriangle className="w-3 h-3" />}
                  Due {deadline.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </>
            )}
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500" />
      </Link>
    </li>
  );
}

function SubmittedRow({ item }: { item: SubmittedItem }) {
  return (
    <li className="px-5 py-2.5">
      <Link href={`/accounts/${item.accountId}`} className="flex items-center gap-3">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[12px] text-slate-700 truncate">{item.companyName || "—"}</p>
          <p className="text-[10px] text-slate-400">
            {item.campaignTitle}
            {item.submittedAt && ` · submitted ${new Date(item.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
          </p>
        </div>
      </Link>
    </li>
  );
}
