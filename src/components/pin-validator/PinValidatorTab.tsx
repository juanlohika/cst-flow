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

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (project) refreshValidators();
  }, [project, refreshValidators]);

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
        `/api/accounts/${accountId}/pin-validator/geocode`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const o = data.outcome;
      setInfo(
        `Geocode finished — ${o.processed} processed, ${o.notFound} not found, ${o.failed} failed.`,
      );
      // Refresh the visible quota meter — geocoding just spent quota.
      setQuotaRefreshKey((k) => k + 1);
    } catch (e: any) {
      setError(e?.message || "Geocoding failed");
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
        <button
          onClick={onGeocode}
          disabled={busy === "geocode"}
          className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy === "geocode" ? "Geocoding…" : "Geocode pending"}
        </button>
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
