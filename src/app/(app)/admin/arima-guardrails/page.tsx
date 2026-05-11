"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Shield, Loader2, Plus, Trash2, X, AlertTriangle, Ban, Bell, Clock,
  Volume2, Activity, Lock, CheckCircle2,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

type GuardrailType =
  | "forbidden_topic"
  | "forbidden_phrase"
  | "escalation_trigger"
  | "off_hours_message"
  | "rate_limit"
  | "required_disclosure";

interface Guardrail {
  id: string;
  type: GuardrailType;
  label: string;
  pattern: string;
  description: string | null;
  enabled: boolean;
  isBuiltIn: boolean;
  priority: number;
}

const TYPE_META: Record<GuardrailType, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  forbidden_topic: {
    label: "Forbidden Topics",
    description: "If user mentions any keyword, ARIMA refuses + escalates.",
    icon: <Ban className="w-4 h-4" />,
    color: "rose",
  },
  forbidden_phrase: {
    label: "Forbidden Phrases",
    description: "Phrases ARIMA must NEVER use in its own output.",
    icon: <Volume2 className="w-4 h-4" />,
    color: "amber",
  },
  escalation_trigger: {
    label: "Escalation Triggers",
    description: "Keywords that auto-notify the internal team for review.",
    icon: <Bell className="w-4 h-4" />,
    color: "blue",
  },
  off_hours_message: {
    label: "Off-Hours Behavior",
    description: "Auto-reply outside business hours (JSON config).",
    icon: <Clock className="w-4 h-4" />,
    color: "slate",
  },
  rate_limit: {
    label: "Rate Limits",
    description: "Anti-abuse caps (JSON config).",
    icon: <Activity className="w-4 h-4" />,
    color: "slate",
  },
  required_disclosure: {
    label: "Required Disclosures",
    description: "Mandatory behaviors ARIMA must always do.",
    icon: <CheckCircle2 className="w-4 h-4" />,
    color: "emerald",
  },
};

export default function ArimaGuardrailsPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  useBreadcrumbs([
    { label: "Admin", href: "/admin" },
    { label: "ARIMA Guardrails" },
  ]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [rules, setRules] = useState<Guardrail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newRule, setNewRule] = useState<{ type: GuardrailType; label: string; pattern: string; description: string }>({
    type: "forbidden_topic",
    label: "",
    pattern: "",
    description: "",
  });

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/arima-guardrails");
      if (res.ok) setRules(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchRules();
  }, [isAdmin, fetchRules]);

  const updateRule = async (id: string, patch: Partial<Guardrail>) => {
    await fetch(`/api/admin/arima-guardrails/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    fetchRules();
  };

  const deleteRule = async (id: string, label: string) => {
    if (!confirm(`Delete the "${label}" guardrail? (Built-ins can be disabled but not deleted.)`)) return;
    const res = await fetch(`/api/admin/arima-guardrails/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete");
    }
    fetchRules();
  };

  const createRule = async () => {
    if (!newRule.label.trim() || !newRule.pattern.trim()) return;
    await fetch("/api/admin/arima-guardrails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRule),
    });
    setNewRule({ type: "forbidden_topic", label: "", pattern: "", description: "" });
    setShowAdd(false);
    fetchRules();
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-bold text-slate-500">Admin only</p>
      </div>
    );
  }

  // Group rules by type
  const grouped = (Object.keys(TYPE_META) as GuardrailType[]).map(type => ({
    type,
    meta: TYPE_META[type],
    rules: rules.filter(r => r.type === type),
  }));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center shadow-md">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-black text-slate-800 tracking-tight">ARIMA Guardrails</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Safety rules ARIMA enforces on every conversation
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700"
        >
          <Plus className="w-3 h-3" />
          Add guardrail
        </button>
      </header>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[11px] text-amber-900">
          <p className="font-bold mb-1">How guardrails work</p>
          <ul className="space-y-0.5 list-disc list-inside text-[11px]">
            <li><strong>Forbidden topics</strong> and <strong>escalation triggers</strong> are matched against the user's INPUT — if found, ARIMA refuses or notifies the team.</li>
            <li><strong>Forbidden phrases</strong> and <strong>required disclosures</strong> are injected into ARIMA's system prompt so it shapes its OUTPUT.</li>
            <li>Disabled rules are stored but never applied. Built-in rules can be disabled but not deleted.</li>
          </ul>
        </div>
      </div>

      {loading && <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest">New guardrail</p>
            <button onClick={() => setShowAdd(false)} className="text-slate-300 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Type</label>
            <select
              value={newRule.type}
              onChange={e => setNewRule({ ...newRule, type: e.target.value as GuardrailType })}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 outline-none"
            >
              {(Object.keys(TYPE_META) as GuardrailType[]).map(t => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">{TYPE_META[newRule.type].description}</p>
          </div>
          <input
            value={newRule.label}
            onChange={e => setNewRule({ ...newRule, label: e.target.value })}
            placeholder="Short admin-facing label (e.g. 'Refund requests')"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
          />
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
              Pattern{["forbidden_topic", "escalation_trigger"].includes(newRule.type) ? " (comma-separated keywords)" : ["off_hours_message", "rate_limit"].includes(newRule.type) ? " (JSON config)" : ""}
            </label>
            <textarea
              value={newRule.pattern}
              onChange={e => setNewRule({ ...newRule, pattern: e.target.value })}
              rows={3}
              placeholder={
                newRule.type === "forbidden_topic" ? "refund, chargeback, billing dispute"
                : newRule.type === "off_hours_message" ? '{"timezone":"Asia/Manila","startHour":9,"endHour":18,"days":[1,2,3,4,5],"outsideMessage":"..."}'
                : newRule.type === "required_disclosure" ? "When refusing, always mention a human teammate will follow up."
                : "the pattern…"
              }
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
            />
          </div>
          <input
            value={newRule.description}
            onChange={e => setNewRule({ ...newRule, description: e.target.value })}
            placeholder="Why this exists (audit trail, optional)"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] font-semibold text-slate-700 placeholder:text-slate-300 outline-none focus:border-rose-300"
          />
          <button
            onClick={createRule}
            disabled={!newRule.label.trim() || !newRule.pattern.trim()}
            className="w-full px-3 py-2 rounded-xl bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest hover:bg-rose-600 disabled:opacity-50"
          >
            Create guardrail
          </button>
        </div>
      )}

      {/* Grouped lists */}
      {!loading && grouped.map(g => (
        <Section
          key={g.type}
          meta={g.meta}
          rules={g.rules}
          onToggle={(id, enabled) => updateRule(id, { enabled })}
          onDelete={(id, label) => deleteRule(id, label)}
        />
      ))}
    </div>
  );
}

function Section({
  meta, rules, onToggle, onDelete,
}: {
  meta: { label: string; description: string; icon: React.ReactNode; color: string };
  rules: Guardrail[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string, label: string) => void;
}) {
  if (rules.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <div className="text-slate-500">{meta.icon}</div>
        <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest flex-1">
          {meta.label} ({rules.length})
        </h3>
      </div>
      <p className="px-5 py-2 text-[11px] text-slate-500 border-b border-slate-50">
        {meta.description}
      </p>
      <div className="divide-y divide-slate-100">
        {rules.map(r => (
          <div key={r.id} className="p-4 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <p className="text-[12px] font-bold text-slate-800">{r.label}</p>
                {r.isBuiltIn && (
                  <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                    built-in
                  </span>
                )}
              </div>
              {r.description && (
                <p className="text-[11px] text-slate-500 mb-2">{r.description}</p>
              )}
              <pre className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-[10px] font-mono text-slate-600 overflow-auto max-h-32 whitespace-pre-wrap break-all">
{r.pattern}
              </pre>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Enabled</span>
                <button
                  onClick={() => onToggle(r.id, !r.enabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${r.enabled ? "bg-emerald-500" : "bg-slate-200"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-transform ${r.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                </button>
              </label>
              {!r.isBuiltIn && (
                <button
                  onClick={() => onDelete(r.id, r.label)}
                  className="p-1.5 text-slate-300 hover:text-rose-500"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
