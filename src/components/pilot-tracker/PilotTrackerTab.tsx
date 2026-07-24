"use client";

/**
 * AccountHub → Pilot Tracker tab.
 *
 * Two states:
 *   1. Not activated: shows "Activate" call-to-action.
 *   2. Activated: shows the full management surface —
 *        - Settings panel (target version, invite/store URLs, reference
 *          screenshot upload, blocklist, thresholds, QR)
 *        - Import section (template download, XLSX upload → validate → apply)
 *        - Roster grid (PilotRosterGrid subcomponent) with filters and
 *          per-row edit
 *        - Funnel counts across the top
 *
 * All API routes are already guarded by canAccessClient() server-side, so
 * this component just fetches and posts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Rocket, Upload, Download, QrCode, Settings, ImageIcon, Copy, ExternalLink,
} from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";
import { PilotRosterGrid } from "./PilotRosterGrid";

interface PilotProject {
  id: string;
  clientProfileId: string;
  name: string;
  qrToken: string;
  targetAppVersion: string | null;
  betaInviteUrl: string | null;
  playStoreAppUrl: string | null;
  referenceScreenshotDriveId: string | null;
  referenceScreenshotUrl: string | null;
  driveFolderId: string | null;
  blockedEmailDomains: string | null;
  staleThresholdDays: number;
  status: string;
  pilotStart: string | null;
  pilotEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  accountId: string;
  companyName: string;
}

interface ImportReportRow {
  rowNumber: number;
  employeeId?: string;
  fullName?: string;
  mobileNumber?: string;
  status: "ok" | "warn" | "error";
  message?: string;
}

interface ImportReport {
  rows: ImportReportRow[];
  totalRows: number;
  okRows: number;
  warnRows: number;
  errorRows: number;
}

export function PilotTrackerTab({ accountId, companyName }: Props) {
  const { showToast } = useToast();
  const [project, setProject] = useState<PilotProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [rosterRefresh, setRosterRefresh] = useState(0);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/pilot-tracker`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      setProject(data.project);
    } catch (e: any) {
      showToast(`Load failed: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [accountId, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activate = async () => {
    setBusy("activate");
    try {
      const res = await fetch(`/api/accounts/${accountId}/pilot-tracker`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      showToast(
        data.created
          ? "Pilot Tracker activated. Drive folder ready."
          : "Already active.",
        "success",
      );
      setProject(data.project);
    } catch (e: any) {
      showToast(`Activate failed: ${e.message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async (patch: Partial<PilotProject>) => {
    setBusy("save");
    try {
      const res = await fetch(`/api/accounts/${accountId}/pilot-tracker`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setProject(data.project);
      showToast("Settings saved.", "success");
      return true;
    } catch (e: any) {
      showToast(`Save failed: ${e.message}`, "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const uploadReferenceScreenshot = async (file: File) => {
    setBusy("ref-screenshot");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/reference-screenshot`,
        { method: "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      showToast("Reference screenshot uploaded.", "success");
      await refresh();
    } catch (e: any) {
      showToast(`Upload failed: ${e.message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const validateImport = async (file: File) => {
    setBusy("validate");
    setImportFile(file);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/import/validate`,
        { method: "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setImportReport(data);
    } catch (e: any) {
      showToast(`Validate failed: ${e.message}`, "error");
      setImportFile(null);
    } finally {
      setBusy(null);
    }
  };

  const applyImport = async () => {
    if (!importFile) return;
    setBusy("apply");
    try {
      const form = new FormData();
      form.append("file", importFile);
      const res = await fetch(
        `/api/accounts/${accountId}/pilot-tracker/import/apply`,
        { method: "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      showToast(
        `Applied: ${data.inserted} added, ${data.updated} updated (${data.rejected} skipped).`,
        "success",
      );
      setImportReport(null);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setRosterRefresh((n) => n + 1);
    } catch (e: any) {
      showToast(`Apply failed: ${e.message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-gray-500 text-sm">Loading pilot project…</div>;
  }

  // ── State 1: not yet activated ────────────────────────────────────────
  if (!project) {
    return (
      <div className="p-8">
        <div className="max-w-2xl bg-white rounded-lg border border-gray-200 p-8">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-blue-50 text-blue-600 shrink-0">
              <Rocket size={32} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Activate Pilot Tracker
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Enroll <span className="font-medium">{companyName}</span> in the
                Tarkie V5 pilot program. Activation creates a QR code, a
                dedicated Google Drive folder for screenshots, and a portal
                where participants self-service through the beta onboarding
                steps (Play Store email → invite acceptance → app update →
                version verification).
              </p>
              <button
                type="button"
                onClick={activate}
                disabled={busy === "activate"}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                <Rocket size={16} />
                {busy === "activate" ? "Activating…" : "Activate Pilot Tracker"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── State 2: activated ────────────────────────────────────────────────
  const portalUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/pilot/${project.qrToken}`
      : `/pilot/${project.qrToken}`;

  const copyPortalUrl = () => {
    navigator.clipboard.writeText(portalUrl);
    showToast("Portal URL copied.", "success");
  };

  return (
    <div className="p-6 space-y-6">
      {/* ── Header — project title + primary actions ──────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Portal:{" "}
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-mono"
            >
              {portalUrl}
            </a>
            <button
              type="button"
              onClick={copyPortalUrl}
              className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
            >
              <Copy size={12} />
              Copy
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            <Settings size={14} />
            {showSettings ? "Hide" : "Show"} settings
          </button>
          {project.driveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${project.driveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
            >
              <ExternalLink size={14} />
              Drive folder
            </a>
          )}
        </div>
      </div>

      {/* ── Settings panel (collapsible) ─────────────────────────────── */}
      {showSettings && (
        <SettingsPanel
          project={project}
          busy={busy}
          onSave={saveSettings}
          onUploadReference={(f) => uploadReferenceScreenshot(f)}
          refFileInputRef={refFileInputRef}
        />
      )}

      {/* ── Import roster section ────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h4 className="text-sm font-semibold text-gray-900">
            Import roster
          </h4>
          <a
            href={`/api/accounts/${accountId}/pilot-tracker/import/template`}
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
          >
            <Download size={12} />
            Download template
          </a>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) validateImport(f);
            }}
            className="text-xs"
          />
          {busy === "validate" && <span className="text-xs text-gray-500">Validating…</span>}
        </div>
        {importReport && (
          <div className="mt-3 border border-gray-200 rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs">
              <div>
                <span className="text-green-700 font-medium">{importReport.okRows} ok</span>
                {importReport.warnRows > 0 && (
                  <span className="text-amber-700 font-medium ml-3">
                    {importReport.warnRows} warn
                  </span>
                )}
                {importReport.errorRows > 0 && (
                  <span className="text-red-700 font-medium ml-3">
                    {importReport.errorRows} error
                  </span>
                )}
                <span className="text-gray-500 ml-3">of {importReport.totalRows} rows</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportReport(null);
                    setImportFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="text-xs text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyImport}
                  disabled={busy === "apply" || importReport.okRows + importReport.warnRows === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                >
                  <Upload size={12} />
                  {busy === "apply" ? "Applying…" : `Apply ${importReport.okRows + importReport.warnRows} rows`}
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-auto text-xs">
              <table className="min-w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium text-gray-600">Row</th>
                    <th className="text-left px-2 py-1 font-medium text-gray-600">Status</th>
                    <th className="text-left px-2 py-1 font-medium text-gray-600">Emp ID</th>
                    <th className="text-left px-2 py-1 font-medium text-gray-600">Name</th>
                    <th className="text-left px-2 py-1 font-medium text-gray-600">Mobile</th>
                    <th className="text-left px-2 py-1 font-medium text-gray-600">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {importReport.rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-500">{r.rowNumber}</td>
                      <td className="px-2 py-1">
                        <span
                          className={
                            r.status === "error"
                              ? "text-red-600 font-medium"
                              : r.status === "warn"
                              ? "text-amber-600 font-medium"
                              : "text-green-600 font-medium"
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-2 py-1">{r.employeeId || "—"}</td>
                      <td className="px-2 py-1">{r.fullName || "—"}</td>
                      <td className="px-2 py-1">{r.mobileNumber || "—"}</td>
                      <td className="px-2 py-1 text-gray-600">{r.message || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Roster grid ──────────────────────────────────────────────── */}
      <PilotRosterGrid
        accountId={accountId}
        projectId={project.id}
        refreshTrigger={rosterRefresh}
        referenceScreenshotUrl={project.referenceScreenshotUrl}
      />
    </div>
  );
}

// ─── Settings panel ─────────────────────────────────────────────────────

function SettingsPanel({
  project,
  busy,
  onSave,
  onUploadReference,
  refFileInputRef,
}: {
  project: PilotProject;
  busy: string | null;
  onSave: (patch: Partial<PilotProject>) => Promise<boolean>;
  onUploadReference: (f: File) => void;
  refFileInputRef: React.RefObject<HTMLInputElement>;
}) {
  const [form, setForm] = useState({
    name: project.name,
    targetAppVersion: project.targetAppVersion || "",
    betaInviteUrl: project.betaInviteUrl || "",
    playStoreAppUrl: project.playStoreAppUrl || "",
    blockedEmailDomains: project.blockedEmailDomains || "",
    staleThresholdDays: project.staleThresholdDays,
    pilotStart: project.pilotStart || "",
    pilotEnd: project.pilotEnd || "",
    status: project.status,
  });
  useEffect(() => {
    setForm({
      name: project.name,
      targetAppVersion: project.targetAppVersion || "",
      betaInviteUrl: project.betaInviteUrl || "",
      playStoreAppUrl: project.playStoreAppUrl || "",
      blockedEmailDomains: project.blockedEmailDomains || "",
      staleThresholdDays: project.staleThresholdDays,
      pilotStart: project.pilotStart || "",
      pilotEnd: project.pilotEnd || "",
      status: project.status,
    });
  }, [project]);

  const handleSave = async () => {
    await onSave({
      name: form.name,
      targetAppVersion: form.targetAppVersion || null,
      betaInviteUrl: form.betaInviteUrl || null,
      playStoreAppUrl: form.playStoreAppUrl || null,
      blockedEmailDomains: form.blockedEmailDomains || null,
      staleThresholdDays: Number(form.staleThresholdDays),
      pilotStart: form.pilotStart || null,
      pilotEnd: form.pilotEnd || null,
      status: form.status,
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">Settings</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <Field label="Project name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Target app version" hint="e.g. 5.1.7-beta">
          <input
            type="text"
            value={form.targetAppVersion}
            onChange={(e) => setForm({ ...form, targetAppVersion: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field
          label="Beta invitation URL"
          hint="Google Play internal-testing opt-in link — changes when dev creates a new group"
        >
          <input
            type="url"
            value={form.betaInviteUrl}
            onChange={(e) => setForm({ ...form, betaInviteUrl: e.target.value })}
            placeholder="https://play.google.com/apps/internaltest/…"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Play Store app URL" hint="The public Tarkie listing — should not change">
          <input
            type="url"
            value={form.playStoreAppUrl}
            onChange={(e) => setForm({ ...form, playStoreAppUrl: e.target.value })}
            placeholder="https://play.google.com/store/apps/details?id=…"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field
          label="Blocked email domains"
          hint="Comma-separated. Emails matching these get flagged WRONG_EMAIL."
        >
          <input
            type="text"
            value={form.blockedEmailDomains}
            onChange={(e) => setForm({ ...form, blockedEmailDomains: e.target.value })}
            placeholder="mycompany.com,corp.example.com"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Stale threshold (days)">
          <input
            type="number"
            min={1}
            max={30}
            value={form.staleThresholdDays}
            onChange={(e) => setForm({ ...form, staleThresholdDays: Number(e.target.value) })}
            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Pilot start">
          <input
            type="date"
            value={form.pilotStart.slice(0, 10)}
            onChange={(e) => setForm({ ...form, pilotStart: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Pilot end">
          <input
            type="date"
            value={form.pilotEnd.slice(0, 10)}
            onChange={(e) => setForm({ ...form, pilotEnd: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </Field>
      </div>

      {/* Reference screenshot */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">
              Reference screenshot
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Upload a screenshot of the correct version screen. Participants
              see this on Screen F as a guide. CST sees it side-by-side with
              participant uploads during manual verification.
            </p>
            <input
              ref={refFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadReference(f);
              }}
              className="mt-2 text-xs"
            />
          </div>
          {project.referenceScreenshotUrl ? (
            <a
              href={project.referenceScreenshotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 border border-gray-200 rounded hover:border-blue-400 flex items-center justify-center w-24 h-24 shrink-0 text-blue-600 hover:text-blue-800"
              title="Open in Drive"
            >
              <ImageIcon size={32} />
            </a>
          ) : (
            <div className="w-24 h-24 border border-dashed border-gray-300 rounded flex items-center justify-center text-gray-400">
              <ImageIcon size={32} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy === "save"}
          className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-0.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}
