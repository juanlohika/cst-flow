"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Loader2, Save, AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, Settings,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ForceLink from "@/components/ui/ForceLink";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import { GEMINI_VOICES } from "@/lib/training-video/types";

interface SettingsRecord {
  id: string;
  trainingRootFolderId: string;
  defaultVoice: string;
  defaultTtsModel: string;
  defaultLanguage: string;
  defaultAspectRatio: string;
  updatedBy: string | null;
  updatedAt: string;
}

export default function TrainingVideosSettingsPage() {
  return <AuthGuard><Content /></AuthGuard>;
}

function Content() {
  const { data: session } = useSession();
  useBreadcrumbs([
    { label: "Training Videos", href: "/training-videos" },
    { label: "Settings" },
  ]);
  const isAdmin = (session?.user as any)?.role === "admin";

  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rootLink, setRootLink] = useState("");
  const [defaultVoice, setDefaultVoice] = useState("Charon");
  const [defaultTtsModel, setDefaultTtsModel] = useState("gemini-2.5-flash-preview-tts");
  const [defaultLanguage, setDefaultLanguage] = useState("en-US");
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<"9:16" | "16:9">("9:16");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/training-videos/settings");
      if (res.ok) {
        const data = await res.json();
        const s = data?.settings;
        setSettings(s || null);
        if (s) {
          setRootLink(`https://drive.google.com/drive/folders/${s.trainingRootFolderId}`);
          setDefaultVoice(s.defaultVoice);
          setDefaultTtsModel(s.defaultTtsModel);
          setDefaultLanguage(s.defaultLanguage);
          setDefaultAspectRatio(s.defaultAspectRatio === "16:9" ? "16:9" : "9:16");
        }
      } else {
        setError((await res.json())?.error || "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/training-videos/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainingRootLink: rootLink,
          defaultVoice,
          defaultTtsModel,
          defaultLanguage,
          defaultAspectRatio,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save");
      setSettings(data?.settings || null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return <div className="p-8"><p className="text-rose-700 font-bold">Admin only</p></div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-violet-500" /> Training Videos · Settings
          </h1>
          <p className="text-[12px] text-slate-500 mt-1">
            Drive folder + default voice/model. Edit the AI's behavior via <a href="/admin/skills" className="underline">/admin/skills</a> (filter by category=training-video).
          </p>
        </div>
        <ForceLink href="/training-videos" className="text-[12px] text-violet-700 hover:underline">
          ← Back to Training Videos
        </ForceLink>
      </div>

      {error && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <div className="text-[13px] text-rose-900"><p className="font-bold">Something went wrong</p><p className="mt-1">{error}</p></div>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-[13px] font-black uppercase tracking-widest text-slate-500">Drive Configuration</h2>
        <div>
          <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" /> Training root folder
          </label>
          <input
            value={rootLink}
            onChange={e => setRootLink(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:border-violet-300"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Each generated video gets a subfolder under here. Must be shared with the service account as Editor.
          </p>
        </div>

        <h2 className="text-[13px] font-black uppercase tracking-widest text-slate-500 pt-2">Voice Defaults</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-700">Default voice</label>
            <select value={defaultVoice} onChange={e => setDefaultVoice(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white">
              {GEMINI_VOICES.map(v => (
                <option key={v.id} value={v.id}>
                  {v.label}{v.recommended ? " ★" : ""}{v.description ? ` — ${v.description}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-700">Default TTS model</label>
            <select value={defaultTtsModel} onChange={e => setDefaultTtsModel(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white">
              <option value="gemini-2.5-flash-preview-tts">gemini-2.5-flash-preview-tts (fast, low cost)</option>
              <option value="gemini-2.5-pro-preview-tts">gemini-2.5-pro-preview-tts (higher quality)</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-700">Default language</label>
            <input value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)}
              placeholder="en-US" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px]" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-700">Default aspect ratio</label>
            <select value={defaultAspectRatio} onChange={e => setDefaultAspectRatio(e.target.value as any)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white">
              <option value="9:16">9:16 — mobile vertical</option>
              <option value="16:9">16:9 — horizontal</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving || !rootLink.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 text-white text-[12px] font-bold hover:bg-violet-600 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Verify
          </button>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-[13px]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : settings ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-[13px] flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <p className="font-bold text-emerald-900">Configured</p>
            <p className="text-emerald-800 mt-1">
              <a href={`https://drive.google.com/drive/folders/${settings.trainingRootFolderId}`} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Open Training folder in Drive
              </a>
            </p>
            <p className="text-[11px] text-emerald-700 mt-1">Last updated {new Date(settings.updatedAt).toLocaleString()}</p>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500">
          Not configured yet. Paste the Drive link above and click <strong>Save &amp; Verify</strong>.
        </section>
      )}
    </div>
  );
}
