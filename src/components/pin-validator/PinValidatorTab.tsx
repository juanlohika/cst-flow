"use client";

/**
 * AccountHub → Pin Validator tab.
 *
 * Two states:
 *   - Not yet activated: shows an "Activate" call-to-action that creates
 *     the per-account Google Sheet on click.
 *   - Activated: shows a management surface (Sheet link, Geocode button,
 *     validators list with invite form, and the same MapValidator
 *     component but in read-only monitoring mode).
 *
 * Auth: internal CST OS users only. The component fetches API endpoints
 * that already enforce canAccessClient() server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { MapValidator } from "./MapValidator";
import { QuotaMeter } from "./QuotaMeter";

interface Project {
  id: string;
  clientProfileId: string;
  googleSheetId: string;
  googleSheetUrl: string;
  name: string;
  status: string;
  createdAt: string;
}

interface ValidatorRow {
  contactId: string;
  name: string;
  email: string;
  role: string | null;
  status: string;
  invitedAt: string | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
  linkActive: boolean;
  linkExpiresAt: string | null;
  linkUsedAt: string | null;
  linkCreatedAt: string | null;
}

interface JobView {
  id: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  totalRows: number;
  processedRows: number;
  notFoundRows: number;
  failedRows: number;
  currentLocation: string | null;
  resting: boolean;
  restUntilMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

interface JobPayload {
  active: JobView | null;
  lastCompleted: JobView | null;
}

interface Props {
  accountId: string;
  companyName: string;
}

export function PinValidatorTab({ accountId, companyName }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0);
  const [validators, setValidators] = useState<ValidatorRow[]>([]);
  const [validatorsLoading, setValidatorsLoading] = useState(false);
  // Geocoding job status — polled every 2s while a job is active.
  const [job, setJob] = useState<JobPayload | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/pin-validator`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProject(data.project || null);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load Pin Validator project");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const refreshValidators = useCallback(async () => {
    setValidatorsLoading(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pin-validator/validators`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setValidators(data.validators || []);
    } catch (e: any) {
      // Non-fatal — the list is supplemental info. Silently ignore.
      console.warn("[pin-validator] failed to load validators:", e);
    } finally {
      setValidatorsLoading(false);
    }
  }, [accountId]);

  const refreshJob = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pin-validator/geocode-job`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setJob(data);
    } catch (e: any) {
      // Non-fatal — show nothing rather than spamming the error banner.
      console.warn("[pin-validator] failed to load job status:", e);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (project) refreshValidators();
  }, [project, refreshValidators]);

  // Poll job status. Cadence depends on state:
  //   - Active job → every 2s for snappy progress updates
  //   - No active job → every 30s (just to catch background completions)
  // Also re-poll on tab focus.
  useEffect(() => {
    if (!project) return;
    refreshJob();
    const intervalMs = job?.active ? 2_000 : 30_000;
    const id = setInterval(refreshJob, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshJob();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // The intent is "re-create the timer when active state flips" — depending
    // on job?.active is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, refreshJob, job?.active?.id, job?.active === null]);

  // When the active job transitions to completed/failed/cancelled, also
  // refresh the visible quota meter (it just spent budget) and the pins
  // list (the map should show new markers).
  useEffect(() => {
    if (!job?.active) {
      setQuotaRefreshKey((k) => k + 1);
    }
  }, [job?.active === null]);

  async function onActivate() {
    setBusy("activate");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/pin-validator`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProject(data.project);
      setInfo(
        data.created
          ? "Sheet created. Paste store names into column A, then geocode."
          : "Project loaded.",
      );
    } catch (e: any) {
      setError(e?.message || "Failed to activate Pin Validator");
    } finally {
      setBusy(null);
    }
  }

  async function onGeocode() {
    if (!project) return;
    setBusy("geocode");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/pin-validator/geocode-job`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.totalRows === 0) {
        setInfo("Nothing to geocode — every store already has coordinates.");
      } else {
        setInfo(
          `Geocoding ${data.totalRows} store${data.totalRows === 1 ? "" : "s"} in the background. You can close this tab; it'll keep running.`,
        );
      }
      // Immediately refresh job status so the panel paints.
      await refreshJob();
    } catch (e: any) {
      setError(e?.message || "Failed to start geocoding");
    } finally {
      setBusy(null);
    }
  }

  async function onCancelGeocode() {
    if (!project || !job?.active) return;
    setBusy("cancel-geocode");
    try {
      await fetch(`/api/accounts/${accountId}/pin-validator/geocode-job`, {
        method: "DELETE",
      });
      await refreshJob();
    } catch (e: any) {
      setError(e?.message || "Failed to cancel");
    } finally {
      setBusy(null);
    }
  }

  async function sendInviteFor(email: string, name?: string): Promise<void> {
    if (!project) return;
    const res = await fetch(
      `/api/accounts/${accountId}/pin-validator/invite`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name }),
      },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setInfo(
      data.emailSent
        ? `Invite sent to ${email}.`
        : `Invite created (email send failed: ${data.emailError || "unknown"}). Share this link: ${data.inviteUrl}`,
    );
    await refreshValidators();
  }

  async function onSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setBusy("invite");
    setError(null);
    setInfo(null);
    try {
      await sendInviteFor(email, inviteName || undefined);
      setInviteEmail("");
      setInviteName("");
      setShowInvite(false);
    } catch (e: any) {
      setError(e?.message || "Invite failed");
    } finally {
      setBusy(null);
    }
  }

  async function onResendInvite(v: ValidatorRow) {
    if (!project) return;
    setBusy(`resend-${v.contactId}`);
    setError(null);
    setInfo(null);
    try {
      await sendInviteFor(v.email, v.name);
    } catch (e: any) {
      setError(e?.message || "Invite failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-500">Loading Pin Validator…</div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <header>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            Pin Validator
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Generate a Google Sheet for {companyName} where you paste store
            names, geocode them with Google Maps, and email the client a
            magic link to validate each pin on a map.
          </p>
        </header>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-medium text-slate-900">
            Pin Validator is not activated for this account.
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Activation creates a Google Sheet in the team's Pin Validator
            folder named <span className="font-mono">{companyName} — Pin Validator</span>.
            The Sheet is reused for all future geocoding and validation rounds
            on this account.
          </p>
          <button
            onClick={onActivate}
            disabled={busy === "activate"}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "activate" ? "Creating Sheet…" : "Activate Pin Validator"}
          </button>
          {error && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* Header row — title + quick actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-900">{project.name}</h2>
        </div>
        <a
          href={project.googleSheetUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          Open Google Sheet ↗
        </a>
        {job?.active ? (
          <button
            onClick={onCancelGeocode}
            disabled={busy === "cancel-geocode"}
            className="ml-auto rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === "cancel-geocode" ? "Stopping…" : "Stop geocoding"}
          </button>
        ) : (
          <button
            onClick={onGeocode}
            disabled={busy === "geocode"}
            className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy === "geocode" ? "Starting…" : "Geocode pending"}
          </button>
        )}
        <button
          onClick={() => setShowInvite((v) => !v)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
        >
          {showInvite ? "Cancel invite" : "Invite validator"}
        </button>
      </div>

      {/* Quota + how-to */}
      <div className="grid gap-3 md:grid-cols-2">
        <QuotaMeter compact refreshKey={quotaRefreshKey} />
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-700">How to use:</strong> Open the
          Sheet → paste store names into column A → return here and click
          <em> Geocode pending</em>. Then invite a client contact to validate.
        </div>
      </div>

      {/* Geocoding job status — live progress while a batch runs in the
          background, or a one-line summary of the last completed run. */}
      <GeocodingJobStatus job={job} />

      {/* Sync notice — when a job finishes we tell the user to refresh the
          map to see the new pins. */}
      {job?.lastCompleted && !job.active && (
        <p className="text-[11px] text-slate-400">
          Tip: click <em>↻ Refresh</em> on the map to see newly geocoded pins.
        </p>
      )}

      {/* Invite form */}
      {showInvite && (
        <form
          onSubmit={onSendInvite}
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]"
        >
          <input
            type="email"
            placeholder="Validator email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
          />
          <button
            type="submit"
            disabled={busy === "invite"}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "invite" ? "Sending…" : "Send invite"}
          </button>
        </form>
      )}

      {info && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {info}
        </p>
      )}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {/* Validators list — every contact with pinValidatorEnabled=true,
          plus their most-recent magic link's expiry. 'Resend invite' issues
          a fresh link and re-emails it. */}
      {validators.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Validators ({validators.length})</span>
            {validatorsLoading && <span className="text-slate-400">refreshing…</span>}
          </div>
          <ul className="divide-y divide-slate-100">
            {validators.map((v) => (
              <li
                key={v.contactId}
                className="flex items-center gap-3 px-3 py-2 text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 truncate">
                      {v.name}
                    </span>
                    <span className="text-slate-400 truncate">{v.email}</span>
                    {v.role && (
                      <span className="text-slate-400">· {v.role}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {v.linkActive
                      ? `Link active until ${formatDate(v.linkExpiresAt)}`
                      : v.linkExpiresAt
                      ? `Link expired ${formatDate(v.linkExpiresAt)} · needs new invite`
                      : "No link sent yet"}
                    {v.lastSeenAt && ` · last opened ${formatDate(v.lastSeenAt)}`}
                  </div>
                </div>
                <button
                  onClick={() => onResendInvite(v)}
                  disabled={busy === `resend-${v.contactId}`}
                  className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy === `resend-${v.contactId}`
                    ? "Sending…"
                    : v.linkActive
                    ? "Resend"
                    : "Send new invite"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Map — fills the remaining viewport. We use 'h-[calc(100vh-360px)]'
          so the map grows with the browser window and there's no dead space
          below it on tall monitors. 360px is roughly the height of all the
          chrome above (account header + tab strip + this tab's action bar +
          quota row). Min 480px on tiny laptops. */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden h-[calc(100vh-360px)] min-h-[480px]">
        <MapValidator projectId={project.id} />
      </div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "1 sec";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} sec`;
  const min = Math.floor(sec / 60);
  const r = sec % 60;
  if (min < 60) return r > 0 ? `${min} min ${r} sec` : `${min} min`;
  const hr = Math.floor(min / 60);
  return `${hr} hr ${min % 60} min`;
}

/**
 * Live status panel for the background geocoding job. Shows:
 *   - Active job: progress bar, current row, counts, resting countdown
 *   - No active job: "Last completed run: …" one-liner (skipped if none)
 */
function GeocodingJobStatus({ job }: { job: JobPayload | null }) {
  // Tick every second to keep the resting countdown live.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!job?.active?.resting) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [job?.active?.resting]);
  // Silence unused-var lint while still depending on tick.
  void tick;

  if (job?.active) {
    const j = job.active;
    const pct =
      j.totalRows > 0
        ? Math.round((j.processedRows / j.totalRows) * 100)
        : 0;
    const restRemainingMs =
      j.resting && j.restUntilMs ? Math.max(0, j.restUntilMs - Date.now()) : 0;
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-slate-700 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          <strong className="text-blue-900">
            Geocoding {j.processedRows} of {j.totalRows} stores ({pct}%)
          </strong>
        </div>
        {j.resting ? (
          <div className="text-slate-600">
            💤 Resting{" "}
            <strong className="tabular-nums">
              {Math.ceil(restRemainingMs / 1000)}s
            </strong>{" "}
            before next batch
          </div>
        ) : j.currentLocation ? (
          <div className="text-slate-600 truncate">
            Currently processing: <strong>{j.currentLocation}</strong>
          </div>
        ) : (
          <div className="text-slate-500">Starting up…</div>
        )}
        <div className="text-[10.5px] text-slate-500">
          ✓ {j.processedRows} resolved · ✗ {j.notFoundRows} not found · ⚠{" "}
          {j.failedRows} failed
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-blue-100">
          <div
            className="absolute inset-y-0 left-0 bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-[10.5px] text-slate-500">
          Started {formatDate(j.startedAt)}. Safe to close this tab — the job
          keeps running in the background.
        </div>
      </div>
    );
  }

  // No active job — show last completed if any.
  const lc = job?.lastCompleted;
  if (lc) {
    const elapsed =
      lc.finishedAt && lc.startedAt
        ? new Date(lc.finishedAt).getTime() - new Date(lc.startedAt).getTime()
        : 0;
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        ✓ Last completed run: <strong>{formatDate(lc.finishedAt)}</strong> ·{" "}
        <strong>
          {lc.processedRows}/{lc.totalRows}
        </strong>{" "}
        stores
        {lc.notFoundRows > 0 && ` · ${lc.notFoundRows} not found`}
        {lc.failedRows > 0 && ` · ${lc.failedRows} failed`}
        {elapsed > 0 && ` · ${formatDuration(elapsed)}`}
      </div>
    );
  }

  // Latest job might be paused/failed/cancelled — surface a useful note.
  // (job.active was filtered out for terminal statuses; the lastCompleted
  // only includes 'completed'. So if neither is set, we just show nothing
  // — that's the very-first-run state.)
  return null;
}
