"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  BookOpen, FileText, Newspaper, Boxes, Upload, Plus, Trash2,
  Loader2, AlertTriangle, CheckCircle2, X, Calendar, ChevronRight, RefreshCw,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

type Tab = "documents" | "feed" | "modules";

interface KnowledgeDoc {
  id: string;
  slug: string;
  title: string;
  category: string;
  version: number;
  audience: string;
  sourceMime: string | null;
  sourceBytes: number | null;
  updatedAt: string;
  createdAt: string;
}

interface KnowledgeFeed {
  id: string;
  title: string;
  body: string;
  category: string;
  audience: string;
  publishedAt: string;
  expiresAt: string | null;
}

interface KnowledgeModule {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string;
  whoItsFor: string | null;
  keyFeatures: string | null;
  priceNote: string | null;
  status: string;
  audience: string;
  updatedAt: string;
}

export default function KnowledgeAdminPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";
  useBreadcrumbs([
    { label: "Admin", href: "/admin" },
    { label: "Knowledge" },
  ]);

  const [tab, setTab] = useState<Tab>("documents");
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [feed, setFeed] = useState<KnowledgeFeed[]>([]);
  const [modules, setModules] = useState<KnowledgeModule[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [d, f, m] = await Promise.all([
        fetch("/api/admin/knowledge/documents").then(r => r.ok ? r.json() : []),
        fetch("/api/admin/knowledge/feed").then(r => r.ok ? r.json() : []),
        fetch("/api/admin/knowledge/modules").then(r => r.ok ? r.json() : []),
      ]);
      setDocs(Array.isArray(d) ? d : []);
      setFeed(Array.isArray(f) ? f : []);
      setModules(Array.isArray(m) ? m : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-700">Admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex flex-col h-full bg-surface-subtle">
        <div className="px-6 pt-6 pb-2 max-w-6xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0177b5] to-[#015a9c] flex items-center justify-center shadow-md">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight">Knowledge Repository</h1>
              <p className="text-[11px] font-semibold text-slate-500">Shared brain for every AI agent · ARIMA · Eliana · future agents</p>
            </div>
            <button
              onClick={loadAll}
              className="ml-auto flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-[#0177b5] uppercase tracking-widest"
              title="Refresh"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          <div className="flex items-center gap-1 mt-4 border-b border-slate-100">
            {([
              { id: "documents", label: "Documents", icon: FileText, count: docs.length },
              { id: "feed", label: "Update Feed", icon: Newspaper, count: feed.length },
              { id: "modules", label: "Module Catalog", icon: Boxes, count: modules.length },
            ] as Array<{ id: Tab; label: string; icon: any; count: number }>).map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold border-b-2 transition-colors ${
                    tab === t.id
                      ? "border-[#0177b5] text-[#0177b5]"
                      : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                  <span className="text-[10px] font-black text-slate-400 ml-0.5">{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6 max-w-6xl mx-auto w-full">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-[#0177b5]" />
            </div>
          )}
          {!loading && tab === "documents" && <DocumentsTab docs={docs} onReload={loadAll} />}
          {!loading && tab === "feed" && <FeedTab entries={feed} onReload={loadAll} />}
          {!loading && tab === "modules" && <ModulesTab modules={modules} onReload={loadAll} />}
        </div>
      </div>
    </AuthGuard>
  );
}

// ─── Documents tab ────────────────────────────────────────────────

function DocumentsTab({ docs, onReload }: { docs: KnowledgeDoc[]; onReload: () => void }) {
  const [showUpload, setShowUpload] = useState(false);

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-500">
          Long-form reference materials. Upload a new version to supersede the prior one — old versions stay in history for rollback.
        </p>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white text-[11px] font-black uppercase tracking-widest shadow-md"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload
        </button>
      </div>

      {docs.length === 0 ? (
        <EmptyCard
          icon={FileText}
          title="No documents yet"
          subtitle="Upload your Tarkie playbook to get started. PDF, Markdown, or paste text."
        />
      ) : (
        <div className="grid gap-2">
          {docs.map(d => (
            <div key={d.id} className="bg-white border border-slate-100 rounded-xl p-3 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#F0F4FC] flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-[#0177b5]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13px] font-bold text-slate-800 truncate">{d.title}</p>
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{d.category}</span>
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">v{d.version}</span>
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">{d.audience}</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  <code className="text-[10px]">{d.slug}</code> · Updated {new Date(d.updatedAt).toLocaleString()}
                  {d.sourceBytes ? ` · ${Math.round(d.sourceBytes / 1024)} KB` : ""}
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!confirm(`Archive "${d.title}"? Agents will stop seeing it. (Version history is kept.)`)) return;
                  await fetch(`/api/admin/knowledge/documents/${d.id}`, { method: "DELETE" });
                  onReload();
                }}
                className="text-slate-300 hover:text-rose-500 p-1.5"
                title="Archive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); onReload(); }} />}
    </div>
  );
}

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("playbook");
  const [audience, setAudience] = useState("all");
  const [changeNote, setChangeNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!slug || !title) { setError("slug and title are required"); return; }
    if (!file && !pasteContent.trim()) { setError("Upload a file or paste content"); return; }

    setSubmitting(true);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append("slug", slug);
        form.append("title", title);
        form.append("category", category);
        form.append("audience", audience);
        form.append("changeNote", changeNote);
        form.append("file", file);
        res = await fetch("/api/admin/knowledge/documents", { method: "POST", body: form });
      } else {
        res = await fetch("/api/admin/knowledge/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, title, category, audience, changeNote, content: pasteContent }),
        });
      }
      const data = await res.json();
      if (!res.ok) { setError(data?.error || "Upload failed"); return; }
      onUploaded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-black text-slate-800">Upload knowledge document</h2>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="slug (e.g. tarkie-playbook)" className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none focus:border-[#0177b5]/40" />
          <select value={category} onChange={e => setCategory(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none">
            <option value="playbook">playbook</option>
            <option value="module-catalog">module-catalog</option>
            <option value="pricing">pricing</option>
            <option value="faq">faq</option>
            <option value="tech-spec">tech-spec</option>
            <option value="other">other</option>
          </select>
        </div>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (e.g. Tarkie Playbook v3)" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none focus:border-[#0177b5]/40" />
        <div className="grid grid-cols-2 gap-2">
          <select value={audience} onChange={e => setAudience(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none">
            <option value="all">audience: all (ARIMA + Eliana)</option>
            <option value="internal">audience: internal (Eliana only)</option>
            <option value="external">audience: external (ARIMA client-facing)</option>
          </select>
          <input value={changeNote} onChange={e => setChangeNote(e.target.value)} placeholder="What changed? (optional)" className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none focus:border-[#0177b5]/40" />
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Upload file (PDF, Markdown, TXT)</label>
          <input type="file" accept=".pdf,.md,.txt,.markdown" onChange={e => setFile(e.target.files?.[0] || null)} className="block w-full mt-1 text-[12px]" />
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">…or paste Markdown content</label>
          <textarea
            value={pasteContent}
            onChange={e => setPasteContent(e.target.value)}
            rows={6}
            placeholder="# Tarkie Playbook&#10;&#10;Lorem ipsum…"
            className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-mono outline-none focus:border-[#0177b5]/40"
          />
        </div>
        {error && (
          <p className="text-[11px] font-bold text-rose-500 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5" />
            {error}
          </p>
        )}
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full px-3 py-2.5 rounded-xl bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white text-[12px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {submitting ? "Uploading…" : "Upload"}
        </button>
      </div>
    </div>
  );
}

// ─── Feed tab ────────────────────────────────────────────────────

function FeedTab({ entries, onReload }: { entries: KnowledgeFeed[]; onReload: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", category: "general", audience: "all" });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.title || !form.body) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/knowledge/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ title: "", body: "", category: "general", audience: "all" });
        setShowAdd(false);
        onReload();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-500">
          Short, time-stamped product updates. Agents reference these for "what's new" responses to clients.
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white text-[11px] font-black uppercase tracking-widest shadow-md"
        >
          <Plus className="w-3.5 h-3.5" />
          Add update
        </button>
      </div>

      {showAdd && (
        <div className="bg-[#F0F4FC] border border-[#0177b5]/15 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black text-[#0177b5] uppercase tracking-widest">New update</p>
            <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
          </div>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. New attendance face-detection)" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none focus:border-[#0177b5]/40" />
          <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={3} placeholder="What's new? (2-3 sentences)" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#0177b5]/40" />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold outline-none">
              <option value="general">general</option>
              <option value="feature">feature</option>
              <option value="pricing">pricing</option>
              <option value="integration">integration</option>
              <option value="bugfix">bugfix</option>
            </select>
            <select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold outline-none">
              <option value="all">audience: all</option>
              <option value="internal">audience: internal</option>
              <option value="external">audience: external (client-facing)</option>
            </select>
          </div>
          <button onClick={submit} disabled={submitting || !form.title || !form.body} className="w-full px-3 py-2 rounded-lg bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
            {submitting ? "Publishing…" : "Publish update"}
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyCard icon={Newspaper} title="No updates yet" subtitle="Post a quick note about a new feature, pricing change, or integration. Agents will reference it in client conversations." />
      ) : (
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.id} className="bg-white border border-slate-100 rounded-xl p-3 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#F0F4FC] flex items-center justify-center shrink-0">
                <Newspaper className="w-4 h-4 text-[#0177b5]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <p className="text-[12px] font-bold text-slate-800">{e.title}</p>
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{e.category}</span>
                  <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">{e.audience}</span>
                </div>
                <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{e.body}</p>
                <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                  <Calendar className="w-2.5 h-2.5" />
                  {new Date(e.publishedAt).toLocaleString()}
                  {e.expiresAt && ` · expires ${new Date(e.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!confirm(`Delete "${e.title}"?`)) return;
                  await fetch(`/api/admin/knowledge/feed/${e.id}`, { method: "DELETE" });
                  onReload();
                }}
                className="text-slate-300 hover:text-rose-500 p-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modules tab ─────────────────────────────────────────────────

function ModulesTab({ modules, onReload }: { modules: KnowledgeModule[]; onReload: () => void }) {
  const [editing, setEditing] = useState<Partial<KnowledgeModule> | null>(null);

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-500">
          The Tarkie module catalog. Eliana uses this to suggest existing solutions before recommending a custom build.
        </p>
        <button
          onClick={() => setEditing({ status: "active", audience: "all" })}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white text-[11px] font-black uppercase tracking-widest shadow-md"
        >
          <Plus className="w-3.5 h-3.5" />
          Add module
        </button>
      </div>

      {modules.length === 0 ? (
        <EmptyCard icon={Boxes} title="No modules yet" subtitle="Add each Tarkie module so Eliana can recommend the right existing solution to clients." />
      ) : (
        <div className="space-y-2">
          {modules.map(m => (
            <div key={m.id} className="bg-white border border-slate-100 rounded-xl p-3 flex items-start gap-3 cursor-pointer hover:border-[#0177b5]/40" onClick={() => setEditing(m)}>
              <div className="w-9 h-9 rounded-lg bg-[#F0F4FC] flex items-center justify-center shrink-0">
                <Boxes className="w-4 h-4 text-[#0177b5]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <p className="text-[12px] font-bold text-slate-800">{m.name}</p>
                  {m.category && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{m.category}</span>}
                  <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${m.status === "active" ? "bg-emerald-50 text-emerald-600" : m.status === "beta" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>{m.status}</span>
                </div>
                <p className="text-[11px] text-slate-600 line-clamp-2">{m.description}</p>
                {m.priceNote && <p className="text-[10px] text-slate-400 mt-1">💰 {m.priceNote}</p>}
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
            </div>
          ))}
        </div>
      )}

      {editing && <ModuleEditor module={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload(); }} />}
    </div>
  );
}

function ModuleEditor({ module: mod, onClose, onSaved }: { module: Partial<KnowledgeModule>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    slug: mod.slug || "",
    name: mod.name || "",
    category: mod.category || "",
    description: mod.description || "",
    whoItsFor: mod.whoItsFor || "",
    keyFeatures: mod.keyFeatures || "",
    priceNote: mod.priceNote || "",
    status: mod.status || "active",
    audience: mod.audience || "all",
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.slug || !form.name || !form.description) return;
    setSubmitting(true);
    try {
      await fetch("/api/admin/knowledge/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      onSaved();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-2 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-black text-slate-800">{mod.id ? "Edit module" : "Add module"}</h2>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input disabled={!!mod.id} value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} placeholder="slug" className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none focus:border-[#0177b5]/40 disabled:opacity-50" />
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. Attendance)" className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none focus:border-[#0177b5]/40" />
        </div>
        <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Category (workforce | sales | operations | reporting…)" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none focus:border-[#0177b5]/40" />
        <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} placeholder="1-2 sentence description" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#0177b5]/40" />
        <input value={form.whoItsFor} onChange={e => setForm({ ...form, whoItsFor: e.target.value })} placeholder="Who it's for (target user / use case)" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#0177b5]/40" />
        <textarea value={form.keyFeatures} onChange={e => setForm({ ...form, keyFeatures: e.target.value })} rows={3} placeholder="Key features (bullet list, one per line)" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#0177b5]/40" />
        <input value={form.priceNote} onChange={e => setForm({ ...form, priceNote: e.target.value })} placeholder="Availability / pricing note" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#0177b5]/40" />
        <div className="grid grid-cols-2 gap-2">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold outline-none">
            <option value="active">active</option>
            <option value="beta">beta</option>
            <option value="sunset">sunset</option>
          </select>
          <select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold outline-none">
            <option value="all">audience: all</option>
            <option value="internal">audience: internal</option>
            <option value="external">audience: external</option>
          </select>
        </div>
        <button onClick={submit} disabled={submitting || !form.slug || !form.name || !form.description} className="w-full px-3 py-2.5 rounded-xl bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white text-[12px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2">
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {submitting ? "Saving…" : "Save module"}
        </button>
        {mod.id && (
          <button
            onClick={async () => {
              if (!confirm(`Delete module "${mod.name}"?`)) return;
              await fetch(`/api/admin/knowledge/modules/${mod.id}`, { method: "DELETE" });
              onSaved();
            }}
            className="w-full px-3 py-2 rounded-xl bg-white border border-rose-200 text-rose-600 text-[11px] font-black uppercase tracking-widest"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyCard({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-8 text-center">
      <Icon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
      <p className="text-[13px] font-bold text-slate-700 mb-1">{title}</p>
      <p className="text-[11px] text-slate-500 max-w-md mx-auto">{subtitle}</p>
    </div>
  );
}
