"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import AuthGuard from "@/components/auth/AuthGuard";
import { Loader2, Plus, Presentation, FileText, Clock } from "lucide-react";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

export default function PresentationsPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="w-6 h-6 animate-spin text-[#2162F9]" /></div>}>
        <PresentationsContent />
      </Suspense>
    </AuthGuard>
  );
}

function PresentationsContent() {
  const { data: session } = useSession();
  const router = useRouter();
  const [presentations, setPresentations] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);

  useBreadcrumbs([{ label: "Presentations" }]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [presRes, tplRes, accRes] = await Promise.all([
        fetch("/api/presentations"),
        fetch("/api/presentations/templates"),
        fetch("/api/accounts"),
      ]);
      if (presRes.ok) setPresentations(await presRes.json());
      if (tplRes.ok) setTemplates(await tplRes.json());
      if (accRes.ok) setAccounts(await accRes.json());
    } catch (err) {
      console.error("Failed to load presentations:", err);
    } finally {
      setLoading(false);
    }
  };

  const createPresentation = async (name: string, templateId?: string, accountId?: string) => {
    try {
      const res = await fetch("/api/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, templateId, clientProfileId: accountId }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowNewModal(false);
        router.push(`/presentations/${data.id}`);
      } else {
        const err = await res.json();
        console.error("API error:", err);
      }
    } catch (err) {
      console.error("Failed to create presentation:", err);
    }
  };

  const statusColors: Record<string, string> = {
    draft: "bg-amber-100 text-amber-700",
    in_meeting: "bg-blue-100 text-blue-700",
    pending_approval: "bg-purple-100 text-purple-700",
    approved: "bg-emerald-100 text-emerald-700",
    archived: "bg-slate-100 text-slate-500",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <Loader2 className="w-6 h-6 animate-spin text-[#2162F9]" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-y-auto bg-slate-50 p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <div className="bg-[#2162F9] text-white p-2 rounded-xl shadow-lg">
                <Presentation size={20} />
              </div>
              Presentation Builder
            </h1>
            <p className="text-sm text-slate-500 mt-1">Create AI-powered presentation decks for client meetings</p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 bg-[#2162F9] text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:shadow-lg hover:translate-y-[-1px] transition-all"
          >
            <Plus size={16} /> New Presentation
          </button>
        </div>

        {/* Presentation Grid */}
        {presentations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-300">
            <Presentation size={80} className="mb-6 opacity-20" strokeWidth={1} />
            <p className="text-lg font-bold text-slate-400">No presentations yet</p>
            <p className="text-sm text-slate-400 mt-1">Create your first deck to get started</p>
            <button
              onClick={() => setShowNewModal(true)}
              className="mt-6 flex items-center gap-2 bg-[#2162F9] text-white px-6 py-3 rounded-xl font-bold text-sm hover:shadow-lg transition-all"
            >
              <Plus size={16} /> Create Presentation
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {presentations.map((pres) => (
              <Link
                key={pres.id}
                href={`/presentations/${pres.id}`}
                className="bg-white border border-slate-200 rounded-2xl p-6 cursor-pointer hover:shadow-xl hover:translate-y-[-2px] transition-all group block"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="bg-[#2162F9]/10 p-3 rounded-xl group-hover:bg-[#2162F9]/20 transition-colors">
                    <FileText size={20} className="text-[#2162F9]" />
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${statusColors[pres.status] || "bg-slate-100 text-slate-500"}`}>
                    {pres.status?.replace("_", " ")}
                  </span>
                </div>
                <h3 className="font-bold text-slate-900 text-sm mb-1 truncate">{pres.name}</h3>
                <p className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Clock size={10} />
                  {new Date(pres.createdAt).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* New Presentation Modal */}
      {showNewModal && (
        <NewPresentationModal
          templates={templates}
          accounts={accounts}
          onClose={() => setShowNewModal(false)}
          onCreate={createPresentation}
        />
      )}
    </div>
  );
}

function NewPresentationModal({ templates, accounts, onClose, onCreate }: {
  templates: any[];
  accounts: any[];
  onClose: () => void;
  onCreate: (name: string, templateId?: string, accountId?: string) => void;
}) {
  const [name, setName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await onCreate(name, selectedTemplate || undefined, selectedAccount || undefined);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-slate-900 mb-6">New Presentation</h2>

        <div className="space-y-5">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">
              Presentation Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Kick-Off Meeting — Accutech"
              className="w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-[#2162F9]/20 focus:border-[#2162F9] outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">
              Template
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:border-[#2162F9] transition-colors has-[:checked]:border-[#2162F9] has-[:checked]:bg-[#2162F9]/5">
                <input
                  type="radio"
                  name="template"
                  value=""
                  checked={!selectedTemplate}
                  onChange={() => setSelectedTemplate("")}
                  className="accent-[#2162F9]"
                />
                <span className="text-sm font-medium text-slate-700">Blank (no template)</span>
              </label>
              {templates.map((tpl) => (
                <label
                  key={tpl.id}
                  className="flex items-center gap-3 p-3 border rounded-xl cursor-pointer hover:border-[#2162F9] transition-colors has-[:checked]:border-[#2162F9] has-[:checked]:bg-[#2162F9]/5"
                >
                  <input
                    type="radio"
                    name="template"
                    value={tpl.id}
                    checked={selectedTemplate === tpl.id}
                    onChange={() => setSelectedTemplate(tpl.id)}
                    className="accent-[#2162F9]"
                  />
                  <div>
                    <span className="text-sm font-bold text-slate-800">{tpl.name}</span>
                    {tpl.description && (
                      <p className="text-[11px] text-slate-400 mt-0.5">{tpl.description}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">
              Account (optional)
            </label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-[#2162F9]/20 focus:border-[#2162F9] outline-none bg-white"
            >
              <option value="">No account linked</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.companyName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="flex items-center gap-2 bg-[#2162F9] text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:shadow-lg transition-all disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create Presentation
          </button>
        </div>
      </div>
    </div>
  );
}
