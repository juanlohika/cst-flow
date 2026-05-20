"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  FileText, Settings, Loader2, AlertTriangle, Sparkles, Plus,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface AccessibleAccount {
  id: string;
  companyName: string;
  clientCode: string | null;
  tier: string | null;
}

export default function ProposalMakerPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const { data: session } = useSession();
  const router = useRouter();
  useBreadcrumbs([{ label: "Proposal Maker" }]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [accounts, setAccounts] = useState<AccessibleAccount[]>([]);
  const [settingsConfigured, setSettingsConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Form state
  const [clientProfileId, setClientProfileId] = useState("");
  const [title, setTitle] = useState("");
  const [isAddendum, setIsAddendum] = useState(false);
  const [scopeNotes, setScopeNotes] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [standardRate, setStandardRate] = useState("");
  const [discountedRate, setDiscountedRate] = useState("");
  const [combinedRate, setCombinedRate] = useState("");
  const [guaranteedUsers, setGuaranteedUsers] = useState("");
  const [timelineNotes, setTimelineNotes] = useState("");
  const [clientSigName, setClientSigName] = useState("");
  const [clientSigTitle, setClientSigTitle] = useState("");

  useEffect(() => {
    (async () => {
      try {
        // 1. accessible accounts (admin = all, RM = membership-scoped via list-with-flags)
        const accRes = await fetch("/api/admin/telegram-bindings");   // re-use this — returns accounts + bind keys, we just need account list
        if (accRes.ok) {
          const data = await accRes.json();
          const list = Array.isArray(data?.accounts)
            ? data.accounts.map((row: any) => row.account)
            : [];
          setAccounts(list);
        } else if (accRes.status === 403) {
          // fall back: try the more general accessible-accounts route if available
          setAccounts([]);
        }

        // 2. settings configured?
        if (isAdmin) {
          const sRes = await fetch("/api/proposal-maker/settings");
          if (sRes.ok) {
            const data = await sRes.json();
            setSettingsConfigured(!!data?.settings?.proposalsRootFolderId);
          }
        } else {
          // Non-admins can't check settings; assume configured and let create fail loudly if not
          setSettingsConfigured(true);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const submit = async () => {
    if (!clientProfileId) { setError("Select an account first."); return; }
    if (!title.trim()) { setError("Title is required."); return; }
    if (!scopeNotes.trim()) { setError("Describe the scope."); return; }
    if (!totalCost.trim()) { setError("Total cost is required."); return; }

    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/proposal-maker/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientProfileId,
          title,
          isAddendum,
          scopeNotes,
          totalCost,
          standardRate: standardRate.trim() || undefined,
          discountedRate: discountedRate.trim() || undefined,
          combinedRate: combinedRate.trim() || undefined,
          guaranteedUsers: guaranteedUsers.trim() || undefined,
          timelineNotes: timelineNotes.trim() || undefined,
          clientSignatoryName: clientSigName.trim() || undefined,
          clientSignatoryTitle: clientSigTitle.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed");
      router.push(`/proposal-maker/${data.id}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" /> Proposal Maker
          </h1>
          <p className="text-[12px] text-slate-500 mt-1">
            ARIMA drafts a Tarkie-branded proposal from your notes. Preview, regenerate, export to PDF.
          </p>
        </div>
        {isAdmin && (
          <ForceLink href="/proposal-maker/settings" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[12px] font-bold hover:border-indigo-300">
            <Settings className="w-4 h-4" /> Settings
          </ForceLink>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : isAdmin && !settingsConfigured ? (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="text-[13px] text-amber-900">
            <p className="font-bold">Set up the Drive folder first</p>
            <p className="mt-1">Open <ForceLink href="/proposal-maker/settings" className="underline">Settings</ForceLink> to configure where proposals are filed.</p>
          </div>
        </div>
      ) : (
        <section className="rounded-2xl border border-indigo-100 bg-white p-6 space-y-4">
          <div className="flex items-center gap-2 text-indigo-700">
            <Sparkles className="w-4 h-4" />
            <h2 className="text-[14px] font-black">New Proposal</h2>
          </div>

          {/* Account picker */}
          <div>
            <Label>Account</Label>
            <select value={clientProfileId} onChange={e => setClientProfileId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white">
              <option value="">Pick an account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.companyName}{a.tier ? ` · T${a.tier}` : ""}</option>)}
            </select>
          </div>

          <Row>
            <Field label="Title">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Manpower Costing Module Addendum" className="input" />
            </Field>
            <Field label="Type">
              <label className="flex items-center gap-2 mt-2 text-[13px]">
                <input type="checkbox" checked={isAddendum} onChange={e => setIsAddendum(e.target.checked)} /> This is an addendum
              </label>
            </Field>
          </Row>

          <div>
            <Label>Scope notes (the AI writes the proper sections from this)</Label>
            <textarea value={scopeNotes} onChange={e => setScopeNotes(e.target.value)} rows={5} placeholder="Describe what's being delivered, key configuration details, integration points, expected outcomes…" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] resize-y" />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-widest font-black text-slate-500">Cost (required)</div>
            <Field label="Total cost (e.g. P12,000.00 + VAT)">
              <input value={totalCost} onChange={e => setTotalCost(e.target.value)} placeholder="P12,000.00 + VAT" className="input" />
            </Field>
            <Row>
              <Field label="Standard rate (optional)"><input value={standardRate} onChange={e => setStandardRate(e.target.value)} placeholder="P100 + VAT" className="input" /></Field>
              <Field label="Discounted rate (optional)"><input value={discountedRate} onChange={e => setDiscountedRate(e.target.value)} placeholder="P75.00 + VAT" className="input" /></Field>
            </Row>
            <Row>
              <Field label="Combined rate (for addendums)"><input value={combinedRate} onChange={e => setCombinedRate(e.target.value)} placeholder="P300.00 + VAT" className="input" /></Field>
              <Field label="Guaranteed users"><input value={guaranteedUsers} onChange={e => setGuaranteedUsers(e.target.value)} placeholder="30 Users" className="input" /></Field>
            </Row>
          </div>

          <div>
            <Label>Timeline notes (optional)</Label>
            <textarea value={timelineNotes} onChange={e => setTimelineNotes(e.target.value)} rows={3} placeholder="e.g. Standard rollout, target Go-Live by July 6, 2026" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] resize-y" />
          </div>

          <Row>
            <Field label="Client signatory name"><input value={clientSigName} onChange={e => setClientSigName(e.target.value)} placeholder="Wilson Ngo" className="input" /></Field>
            <Field label="Client signatory title"><input value={clientSigTitle} onChange={e => setClientSigTitle(e.target.value)} placeholder="COO" className="input" /></Field>
          </Row>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-[12px] text-rose-900">{error}</div>
          )}

          <button onClick={submit} disabled={generating} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-500 text-white text-[13px] font-bold hover:bg-indigo-600 disabled:opacity-50">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {generating ? "Drafting (this takes 20-40s)…" : "Draft Proposal"}
          </button>
        </section>
      )}

      <style jsx>{`
        :global(.input) {
          margin-top: 4px;
          width: 100%;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid #E2E8F0;
          font-size: 13px;
        }
        :global(.input:focus) { outline: none; border-color: #A5B4FC; }
      `}</style>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] font-bold text-slate-700">{children}</label>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex-1 min-w-[200px]"><Label>{label}</Label>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}
