"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Loader2, Save, Trash2, Layers, GripVertical, RotateCcw } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";

interface Module {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

export default function AccountModulesPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({}); // id → label

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account-modules");
      if (res.ok) {
        const data = await res.json();
        setModules(data.modules || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const addModule = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setAdding(true);
    try {
      const res = await fetch("/api/account-modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (res.ok) {
        setNewLabel("");
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Failed to add module");
      }
    } finally {
      setAdding(false);
    }
  };

  const saveLabel = async (id: string) => {
    const label = editing[id]?.trim();
    if (!label) return;
    const res = await fetch(`/api/account-modules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (res.ok) {
      setEditing(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } else {
      alert("Failed to save");
    }
  };

  const archive = async (id: string, label: string) => {
    if (!confirm(`Archive "${label}"? It will no longer appear in the account profile dropdown, but existing accounts that already have it remain unaffected.`)) return;
    const res = await fetch(`/api/account-modules/${id}`, { method: "DELETE" });
    if (res.ok) await load();
    else alert("Failed to archive");
  };

  if (!isAdmin) return <div className="max-w-3xl mx-auto p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-indigo-500" />
        <h1 className="text-lg font-black text-slate-900">Account Modules · Master List</h1>
      </div>
      <p className="text-[12px] text-slate-500">
        The list of Tarkie modules that any account can have. This drives the "Tarkie Modules Availed" picker on every account profile. Add modules here once — they immediately appear in the dropdown for every team member.
      </p>

      {/* Add new */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4">
        <p className="text-[11px] font-bold text-slate-800 mb-2">Add a new module</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="e.g. Field Audit"
            onKeyDown={e => { if (e.key === "Enter") addModule(); }}
            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-indigo-300"
          />
          <button
            onClick={addModule}
            disabled={adding || !newLabel.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
      </section>

      {/* Existing modules */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-[11px] font-bold text-slate-800">Active modules ({modules.length})</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        ) : modules.length === 0 ? (
          <p className="text-[12px] text-slate-400 text-center py-8 italic">No modules yet. Add one above.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {modules.map(m => (
              <li key={m.id} className="px-5 py-3 flex items-center gap-3 group">
                <GripVertical className="w-3.5 h-3.5 text-slate-300" />
                <div className="flex-1 min-w-0">
                  {editing[m.id] !== undefined ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editing[m.id]}
                        onChange={e => setEditing(prev => ({ ...prev, [m.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter") saveLabel(m.id); }}
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[12px] outline-none focus:border-indigo-300"
                        autoFocus
                      />
                      <button onClick={() => saveLabel(m.id)} className="p-1 rounded hover:bg-emerald-50 text-emerald-600"><Save className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditing(prev => { const n = { ...prev }; delete n[m.id]; return n; })} className="p-1 rounded hover:bg-slate-100 text-slate-400"><RotateCcw className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <button onClick={() => setEditing(prev => ({ ...prev, [m.id]: m.label }))} className="text-left">
                      <p className="text-[12.5px] font-bold text-slate-800">{m.label}</p>
                      <p className="text-[10px] text-slate-400">slug: <code>{m.slug}</code></p>
                    </button>
                  )}
                </div>
                <button
                  onClick={() => archive(m.id, m.label)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-slate-400 hover:text-rose-600"
                  title="Archive module"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[10px] text-slate-400">
        Archiving a module hides it from new account selections. Accounts that already use that module keep it stored — they just can't pick it again from the dropdown unless you reactivate it (re-add with the same name).
      </p>
    </div>
  );
}
