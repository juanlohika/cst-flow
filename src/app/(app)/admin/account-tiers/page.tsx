"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Save, Loader2, Layers, AlertTriangle } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";

type TierLabel = "VIP" | "1" | "2" | "3" | "4" | "5";

const FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly (every 30 days)" },
  { value: "every-2-months", label: "Every 2 months (60 days)" },
  { value: "every-3-months", label: "Every 3 months (90 days)" },
  { value: "quarterly", label: "Quarterly (90 days)" },
  { value: "every-6-months", label: "Every 6 months (180 days)" },
  { value: "yearly", label: "Yearly (365 days)" },
];

export default function AccountTiersPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [map, setMap] = useState<Record<TierLabel, string> | null>(null);
  const [defaults, setDefaults] = useState<Record<TierLabel, string> | null>(null);
  const [tierLabels, setTierLabels] = useState<TierLabel[]>(["VIP", "1", "2", "3", "4", "5"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await fetch("/api/admin/account-tiers");
        if (res.ok) {
          const data = await res.json();
          setMap(data.map);
          setDefaults(data.defaults);
          setTierLabels(data.tierLabels);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const save = async () => {
    if (!map) return;
    setSaving(true);
    setSuccess(false);
    try {
      const res = await fetch("/api/admin/account-tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 4000);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    if (!defaults) return;
    if (!confirm("Reset all tiers to default frequencies? You'll still need to click Save.")) return;
    setMap({ ...defaults });
  };

  if (!isAdmin) return <div className="max-w-3xl mx-auto p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-indigo-500" />
        <h1 className="text-lg font-black text-slate-900">Account Tier — Courtesy Call Frequency</h1>
      </div>
      <p className="text-[12px] text-slate-500">
        Sets how often each tier of account should receive a courtesy call. The system uses this to compute compliance (compliant / warning / overdue) on every account based on its tier and last logged call. Per-account overrides can be set on the account detail page.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : !map ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-2 text-rose-700">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <p className="text-[12px]">Failed to load tier mapping.</p>
        </div>
      ) : (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2 font-black text-slate-500 uppercase text-[10px] tracking-widest w-32">Tier</th>
                  <th className="text-left px-4 py-2 font-black text-slate-500 uppercase text-[10px] tracking-widest">Frequency</th>
                  <th className="text-left px-4 py-2 font-black text-slate-500 uppercase text-[10px] tracking-widest w-40">Default</th>
                </tr>
              </thead>
              <tbody>
                {tierLabels.map(tier => (
                  <tr key={tier} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-black uppercase tracking-widest">
                        {tier === "VIP" ? "VIP" : `Tier ${tier}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={map[tier] || ""}
                        onChange={e => setMap({ ...map, [tier]: e.target.value })}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-300"
                      >
                        {FREQUENCY_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-400">
                      {defaults?.[tier] || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={resetToDefaults}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-[11px] font-black uppercase tracking-widest hover:border-rose-300"
            >
              Reset to defaults
            </button>
            <div className="ml-auto flex items-center gap-2">
              {success && <span className="text-[11px] font-bold text-emerald-700">Saved ✓</span>}
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Frequencies
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
