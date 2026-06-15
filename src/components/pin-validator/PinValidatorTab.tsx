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

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    } catch (e: any) {
      setError(e?.message || "Geocoding failed");
    } finally {
      setBusy(null);
    }
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
      const res = await fetch(
        `/api/accounts/${accountId}/pin-validator/invite`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, name: inviteName || undefined }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setInfo(
        data.emailSent
          ? `Invite sent to ${email}.`
          : `Invite created (email send failed: ${data.emailError || "unknown"}). Share this link: ${data.inviteUrl}`,
      );
      setInviteEmail("");
      setInviteName("");
      setShowInvite(false);
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
          <h2 className="text-base font-semibold text-slate-900">
            📍 Pin Validator
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
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-200 bg-white space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-900">
            📍 {project.name}
          </h2>
          <a
            href={project.googleSheetUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 underline"
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
        <div className="grid gap-3 md:grid-cols-2">
          <QuotaMeter compact />
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 leading-relaxed">
            <strong className="text-slate-700">How to use:</strong> Open the
            Sheet → paste store names into column A → return here and click
            <em> Geocode pending</em>. Then invite a client contact to validate.
          </div>
        </div>
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
      </div>
      <div className="flex-1 min-h-0">
        <MapValidator projectId={project.id} />
      </div>
    </div>
  );
}
