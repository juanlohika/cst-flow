"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import ForceLink from "@/components/ui/ForceLink";
import {
  ArrowLeft, Loader2, Activity, CheckCircle2, AlertTriangle, Sparkles,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import AssessmentFormBody, {
  EMPTY_ASSESSMENT, buildAssessmentBody, type AssessmentValue,
} from "@/components/accounts/AssessmentFormBody";
import HealthChip from "@/components/accounts/HealthChip";
import { computeHealth } from "@/lib/accounts/health-score";

interface AccountDetail {
  id: string;
  companyName: string;
  industry: string;
  engagementStatus: string;
  modulesAvailed: string[];
}

interface LatestAssessment {
  satisfaction: number | null;
  ebaDecisionMaker: number | null;
  ebaDecisionMakerNote: string | null;
  ebaAdmin: number | null;
  ebaAdminNote: string | null;
  contactChangeRecent: boolean;
  contactChangeNote: string | null;
  isTarkieSsot: boolean | null;
  thirdPartySsot: string | null;
  v5Readiness: number | null;
  requestedModules: string[];
  responsesJson: string | null;
  submittedAt: string;
  submittedByName: string | null;
}

export default function AssessmentPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.accountId as string;

  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [latest, setLatest] = useState<LatestAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<AssessmentValue>(EMPTY_ASSESSMENT);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acctRes, assessRes] = await Promise.all([
        fetch(`/api/accounts/${accountId}`),
        fetch(`/api/accounts/${accountId}/assessments`),
      ]);
      if (!acctRes.ok) {
        setError("This account isn't accessible to you.");
        return;
      }
      const acctData = await acctRes.json();
      setAccount({
        id: acctData.id,
        companyName: acctData.companyName,
        industry: acctData.industry,
        engagementStatus: acctData.engagementStatus,
        modulesAvailed: Array.isArray(acctData.modulesAvailed) ? acctData.modulesAvailed : [],
      });

      // Pre-fill lastCourtesyCall from the account profile in all cases
      const accountLastCourtesyCall = acctData?.lastCourtesyCall || "";

      if (assessRes.ok) {
        const assessData = await assessRes.json();
        const first = (assessData?.assessments || [])[0];
        if (first) {
          setLatest(first);
          // Pre-fill form with the previous assessment values so the RM
          // can update deltas rather than retyping from scratch.
          const responses = first.responsesJson ? safeJson(first.responsesJson, {}) : {};
          setForm({
            satisfaction: first.satisfaction || "",
            ebaDM: first.ebaDecisionMaker || "",
            ebaDMNote: first.ebaDecisionMakerNote || "",
            ebaAdmin: first.ebaAdmin || "",
            ebaAdminNote: first.ebaAdminNote || "",
            contactChange: !!first.contactChangeRecent,
            contactChangeNote: first.contactChangeNote || "",
            isTarkieSsot: first.isTarkieSsot === true ? "yes" : first.isTarkieSsot === false ? "no" : "",
            thirdPartySsot: first.thirdPartySsot || "",
            v5Readiness: first.v5Readiness || "",
            requestedModules: Array.isArray(first.requestedModules) ? first.requestedModules.join(", ") : "",
            b1: responses.b1_overall_state || "",
            b2: responses.b2_whats_working || "",
            b3: responses.b3_gaps_pain_points || "",
            d3: responses.d3_why_not_ssot || "",
            e1: responses.e1_open_requests || "",
            e4: responses.e4_single_action || "",
            e5: responses.e5_other || "",
            lastCourtesyCall: accountLastCourtesyCall,
          });
        } else if (accountLastCourtesyCall) {
          setForm(prev => ({ ...prev, lastCourtesyCall: accountLastCourtesyCall }));
        }
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load assessment");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!account) return;
    setSubmitting(true);
    try {
      const body = buildAssessmentBody(form);
      const res = await fetch(`/api/accounts/${accountId}/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Submit failed. Please try again.");
        return;
      }

      // If the RM updated lastCourtesyCall, sync it to the account profile
      // and log a history entry. Non-fatal — assessment is already saved.
      if (form.lastCourtesyCall) {
        try {
          await fetch(`/api/accounts/${accountId}/courtesy-calls`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callDate: form.lastCourtesyCall,
              notes: "Logged via Health Assessment submission",
            }),
          });
        } catch { /* non-fatal */ }
      }

      // Redirect back to the queue
      router.push("/assessments?submitted=" + encodeURIComponent(account.companyName));
    } finally {
      setSubmitting(false);
    }
  };

  // Health preview while filling
  const livePreviewHealth = computeHealth({
    satisfaction: typeof form.satisfaction === "number" ? form.satisfaction : null,
    ebaDecisionMaker: typeof form.ebaDM === "number" ? form.ebaDM : null,
    ebaAdmin: typeof form.ebaAdmin === "number" ? form.ebaAdmin : null,
    v5Readiness: typeof form.v5Readiness === "number" ? form.v5Readiness : null,
    isTarkieSsot: form.isTarkieSsot === "yes" ? true : form.isTarkieSsot === "no" ? false : null,
    thirdPartySsot: form.thirdPartySsot || null,
    contactChangeRecent: form.contactChange,
  });
  const anyAnswered =
    !!form.satisfaction || !!form.ebaDM || !!form.ebaAdmin || !!form.v5Readiness ||
    !!form.isTarkieSsot || !!form.b1 || !!form.b2 || !!form.b3 || !!form.e1;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !account) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <ForceLink href="/assessments" className="inline-flex items-center gap-1 text-[12px] font-bold text-slate-500 hover:text-indigo-600 mb-4">
          <ArrowLeft className="w-3 h-3" /> Back to queue
        </ForceLink>
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 text-rose-700">
          <p className="font-bold mb-1">Couldn't load this assessment</p>
          <p className="text-[12px]">{error || "Account not found."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
          <ForceLink href="/assessments" className="inline-flex items-center gap-1 text-[12px] font-bold text-slate-500 hover:text-indigo-600">
            <ArrowLeft className="w-3.5 h-3.5" /> Queue
          </ForceLink>
          <div className="h-4 w-px bg-slate-200" />
          <Activity className="w-4 h-4 text-indigo-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Health Assessment</p>
            <p className="text-[14px] font-black text-slate-900 truncate">{account.companyName}</p>
          </div>
          {anyAnswered && (
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Live preview</span>
              <HealthChip color={livePreviewHealth.color} score={livePreviewHealth.score} reasons={livePreviewHealth.reasons} size="sm" showScore />
            </div>
          )}
        </div>
      </div>

      {/* Intro */}
      <div className="max-w-3xl mx-auto px-6 pt-6">
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-2xl px-5 py-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-bold text-indigo-900 mb-0.5">
                Your honest read on this account
              </p>
              <p className="text-[11.5px] text-indigo-800 leading-relaxed">
                We'll roll your answers up into a CEO-facing summary on submit. Takes about 5 minutes. {latest ? <span className="font-bold">Form is pre-filled from your last assessment</span> : null} — just update what's changed.
              </p>
              {latest && (
                <p className="text-[10px] text-indigo-600 mt-1.5">
                  Last assessed {new Date(latest.submittedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                  {latest.submittedByName ? ` by ${latest.submittedByName}` : ""}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 pb-32 shadow-sm">
          <AssessmentFormBody value={form} onChange={setForm} />
        </div>
      </div>

      {/* Sticky submit bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-10">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-3">
          <div className="hidden sm:block flex-1 text-[11px] text-slate-500">
            {anyAnswered ? (
              <>Preview: <span className="font-bold text-slate-700">{livePreviewHealth.color === "grey" ? "needs more answers" : `${livePreviewHealth.color.toUpperCase()} · score ${livePreviewHealth.score}`}</span></>
            ) : (
              "Fill out the sections above — preview updates as you go."
            )}
          </div>
          <ForceLink
            href="/assessments"
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black uppercase tracking-widest hover:border-rose-300"
          >
            Cancel
          </ForceLink>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white text-[12px] font-black uppercase tracking-widest shadow-md disabled:opacity-50 hover:opacity-95"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Submit Assessment
          </button>
        </div>
      </div>
    </div>
  );
}

function safeJson(raw: string, fb: any): any {
  try { return JSON.parse(raw); } catch { return fb; }
}
