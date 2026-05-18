"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  FileCheck, Loader2, AlertTriangle, CheckCircle2, ExternalLink, Trash2, Save,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface ConfigStatus {
  configured: boolean;
  dashboardsConfigured: boolean;
  serviceAccountEmail: string;
  serviceAccountValid: boolean;
  driveFolderId: string;
  dashboardsFolderId: string;
  source: "db" | "env" | "none";
}

export default function GoogleIntegrationPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";
  useBreadcrumbs([
    { label: "Admin", href: "/admin" },
    { label: "Google Integration" },
  ]);

  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState({ serviceAccountJson: "", driveFolderId: "", dashboardsFolderId: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/google-integration");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        // Don't pre-fill the edit form with existing values — keeping them
        // blank means "leave them alone on save". The status card above
        // already shows what's currently configured.
        setForm({ serviceAccountJson: "", driveFolderId: "", dashboardsFolderId: "" });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError(null);
    // Allow saving a single field on its own — blank fields preserve the
    // existing value on the server. Only block if EVERYTHING is blank.
    if (!form.serviceAccountJson && !form.driveFolderId && !form.dashboardsFolderId) {
      setError("Nothing to save — fill in at least one field.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/google-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Save failed");
        return;
      }
      setShowEdit(false);
      setForm({ serviceAccountJson: "", driveFolderId: "", dashboardsFolderId: "" });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const clearAll = async () => {
    if (!confirm("Clear Google integration credentials? Eliana will no longer auto-export BRDs to Google Docs.")) return;
    await fetch("/api/admin/google-integration", { method: "DELETE" });
    await load();
  };

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
        <div className="px-6 pt-6 pb-2 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shadow-md">
              <FileCheck className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight">Google Integration</h1>
              <p className="text-[11px] font-semibold text-slate-500">Google Docs export for Eliana-captured BRDs. Configure once; BRDs auto-export to your Drive folder.</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6 max-w-3xl mx-auto w-full space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
            </div>
          )}

          {!loading && status && (
            <>
              {/* Current status */}
              <div className={`bg-white border rounded-2xl p-4 ${status.configured ? "border-emerald-200" : "border-slate-200"}`}>
                <div className="flex items-start gap-3">
                  {status.configured ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-slate-800 mb-0.5">
                      {status.configured ? "Configured" : "Not configured"}
                    </p>
                    {status.configured ? (
                      <div className="space-y-1">
                        <p className="text-[11px] text-slate-600">
                          Service account: <code className="text-[11px] bg-slate-100 px-1 rounded">{status.serviceAccountEmail}</code>
                        </p>
                        <p className="text-[11px] text-slate-600">
                          BRD Drive folder: <a href={`https://drive.google.com/drive/folders/${status.driveFolderId}`} target="_blank" rel="noreferrer" className="text-[#0177b5] hover:underline inline-flex items-center gap-0.5">{status.driveFolderId} <ExternalLink className="w-2.5 h-2.5" /></a>
                        </p>
                        {status.dashboardsFolderId ? (
                          <p className="text-[11px] text-slate-600">
                            Dashboards Drive folder: <a href={`https://drive.google.com/drive/folders/${status.dashboardsFolderId}`} target="_blank" rel="noreferrer" className="text-[#0177b5] hover:underline inline-flex items-center gap-0.5">{status.dashboardsFolderId} <ExternalLink className="w-2.5 h-2.5" /></a>
                          </p>
                        ) : (
                          <p className="text-[11px] text-amber-700">
                            Dashboards Drive folder: <span className="font-bold">not set</span> — the live Account Health Sheet sync needs this.
                          </p>
                        )}
                        <p className="text-[10px] text-slate-400">Stored in: {status.source === "env" ? "environment variables" : "DB (globalSettings)"}</p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-600">Eliana captures BRDs but can't export them to Google Docs until you connect your service account.</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => setShowEdit(true)}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white text-[11px] font-black uppercase tracking-widest"
                  >
                    {status.configured ? "Update credentials" : "Connect Google"}
                  </button>
                  {status.configured && (
                    <button
                      onClick={clearAll}
                      className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-600 text-[11px] font-black uppercase tracking-widest hover:bg-rose-50 inline-flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3 h-3" />
                      Disconnect
                    </button>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {showEdit && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                  {status?.configured && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 mb-1">
                      <p className="text-[11px] text-emerald-800">
                        <strong>Tip:</strong> leave any field <em>blank</em> to keep the existing value. To just add the Dashboards folder, fill in only that one field.
                      </p>
                    </div>
                  )}
                  <p className="text-[12px] font-bold text-slate-800">
                    Service account JSON {status?.serviceAccountValid && <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest ml-1">currently saved</span>}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {status?.serviceAccountValid
                      ? "Leave blank to keep the existing credentials. Paste a new JSON file only if rotating the service account."
                      : "Paste the JSON file you downloaded from Google Cloud → IAM → Service Accounts → Keys."}
                  </p>
                  <textarea
                    value={form.serviceAccountJson}
                    onChange={e => setForm({ ...form, serviceAccountJson: e.target.value })}
                    rows={status?.serviceAccountValid ? 4 : 10}
                    placeholder={status?.serviceAccountValid ? "Leave blank to keep current credentials" : '{"type": "service_account", "project_id": "...", "private_key_id": "...", "private_key": "-----BEGIN PRIVATE KEY-----\\n..."}'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none focus:border-slate-400"
                  />
                  <p className="text-[12px] font-bold text-slate-800 mt-2">
                    BRD Drive folder ID {status?.driveFolderId && <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest ml-1">currently saved</span>}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    From the URL of the Google Drive folder you created and shared with the service account: <code>https://drive.google.com/drive/folders/<b>THIS_PART</b></code>
                    {status?.driveFolderId && " — leave blank to keep current."}
                  </p>
                  <input
                    value={form.driveFolderId}
                    onChange={e => setForm({ ...form, driveFolderId: e.target.value })}
                    placeholder={status?.driveFolderId ? "Leave blank to keep current" : "1A2bC3...xyz"}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none focus:border-slate-400"
                  />

                  <p className="text-[12px] font-bold text-slate-800 mt-2">Dashboards Drive folder ID <span className="text-[10px] font-bold text-slate-400">(optional, for the live Account Health Sheet)</span></p>
                  <p className="text-[10px] text-slate-500">Separate folder for org-wide dashboards. Create a new folder, share with the same service account as Editor, and paste the folder ID. Leave blank if you only need BRD export for now.</p>
                  <input
                    value={form.dashboardsFolderId}
                    onChange={e => setForm({ ...form, dashboardsFolderId: e.target.value })}
                    placeholder="1A2bC3...xyz"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono outline-none focus:border-slate-400"
                  />
                  {error && (
                    <p className="text-[11px] font-bold text-rose-600 flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5" />
                      {error}
                    </p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={save}
                      disabled={saving}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save credentials
                    </button>
                    <button
                      onClick={() => { setShowEdit(false); setForm({ serviceAccountJson: "", driveFolderId: "", dashboardsFolderId: "" }); setError(null); }}
                      className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-black uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Setup instructions */}
              <details className="bg-white border border-slate-100 rounded-2xl p-4">
                <summary className="text-[12px] font-bold text-slate-700 cursor-pointer">How to set up Google integration</summary>
                <ol className="text-[11.5px] text-slate-600 list-decimal pl-5 space-y-2 mt-3">
                  <li>Go to <a className="text-[#0177b5] hover:underline" href="https://console.cloud.google.com" target="_blank" rel="noreferrer">Google Cloud Console</a> and pick (or create) a project for Tarkie/ARIMA.</li>
                  <li>Enable two APIs: <b>Google Docs API</b> and <b>Google Drive API</b> in the API Library.</li>
                  <li>Go to <b>IAM &amp; Admin → Service Accounts → Create Service Account</b>. Name it something like <code>arima-brd-writer</code>.</li>
                  <li>On the service account, go to <b>Keys → Add Key → Create new key → JSON</b>. A JSON file downloads.</li>
                  <li>Note the service account's email (looks like <code>arima-brd-writer@your-project.iam.gserviceaccount.com</code>).</li>
                  <li>In <a className="text-[#0177b5] hover:underline" href="https://drive.google.com" target="_blank" rel="noreferrer">Google Drive</a>, create a folder for ARIMA BRDs. Right-click → <b>Share</b> → paste the service account email → set <b>Editor</b> → uncheck "Notify" → Share.</li>
                  <li>Copy the folder ID from the URL (everything after <code>/folders/</code>).</li>
                  <li>Paste both values above and click Save.</li>
                </ol>
              </details>
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
