"use client";

/**
 * Pilot Tracker — public portal client shell.
 *
 * Two views:
 *   1. Identity match — search + candidate list.
 *   2. Onboarding — vertical checklist across Screens B–F, with a
 *      persistent status card.
 *
 * Storage: participantId is cached in localStorage under
 * `pilot-tracker:{qrToken}:participantId` so returning visits skip the
 * identity step. Clearing (or moving phones) drops back to identity.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Mail, ExternalLink, Smartphone, Camera, LogOut, AlertTriangle, Info } from "lucide-react";

interface Project {
  name: string;
  targetAppVersion: string | null;
  betaInviteUrl: string | null;
  playStoreAppUrl: string | null;
  referenceScreenshotUrl: string | null;
  status: string;
  blockedEmailDomains: string | null;
}

interface Participant {
  id: string;
  employeeId: string;
  fullName: string;
  mobileNumber: string;
  mobileNumberCorrected: string | null;
  mobileConfirmed: boolean;
  playstoreEmail: string | null;
  emailConfirmedIsPlaystore: boolean;
  betaRegistered: boolean;
  invitationAcceptedDeclared: boolean;
  invitationLinkFailed: boolean;
  appUpdatedDeclared: boolean;
  reportedVersion: string | null;
  versionScreenshotUrl: string | null;
  versionVerified: "pending" | "verified" | "mismatch";
  currentStage: number;
  issueFlag: string;
}

interface Match {
  id: string;
  fullName: string;
  employeeIdMasked: string;
  mobileMasked: string;
}

interface Props {
  qrToken: string;
  project: Project;
}

export function PilotPortalClient({ qrToken, project }: Props) {
  const storageKey = `pilot-tracker:${qrToken}:participantId`;
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, check localStorage for a previous session.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) setParticipantId(cached);
    } catch {}
    setLoading(false);
  }, [storageKey]);

  // Load participant record when we have an ID.
  const loadParticipant = useCallback(async () => {
    if (!participantId) return;
    try {
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participantId}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!res.ok) {
        // Cached ID no longer valid — wipe.
        localStorage.removeItem(storageKey);
        setParticipantId(null);
        return;
      }
      setParticipant(json.participant);
    } catch (e) {
      console.warn("[pilot-portal] loadParticipant failed:", e);
    }
  }, [qrToken, participantId, storageKey]);

  useEffect(() => {
    loadParticipant();
  }, [loadParticipant]);

  const onIdentified = (id: string) => {
    try { localStorage.setItem(storageKey, id); } catch {}
    setParticipantId(id);
  };

  const onSignOut = () => {
    try { localStorage.removeItem(storageKey); } catch {}
    setParticipantId(null);
    setParticipant(null);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-8">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">{project.name}</div>
            <div className="text-sm font-semibold text-gray-900">
              Tarkie V5 Pilot
            </div>
          </div>
          {participantId && (
            <button
              type="button"
              onClick={onSignOut}
              className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"
            >
              <LogOut size={12} /> Switch person
            </button>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-6">
        {!participantId || !participant ? (
          <IdentityMatch qrToken={qrToken} onIdentified={onIdentified} />
        ) : (
          <OnboardingChecklist
            qrToken={qrToken}
            project={project}
            participant={participant}
            onRefresh={loadParticipant}
          />
        )}
      </div>
    </main>
  );
}

// ─── Identity match screen ─────────────────────────────────────────────

function IdentityMatch({
  qrToken,
  onIdentified,
}: {
  qrToken: string;
  onIdentified: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    setMatches([]);
    try {
      const res = await fetch(`/api/pilot/${qrToken}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Lookup failed");
        return;
      }
      if (json.matches.length === 0) {
        setInfo("No matches found. Check with your CST rep — your record may not be on the roster yet.");
      } else {
        setMatches(json.matches);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Find your record
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Enter your Employee ID, name, or mobile number.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          placeholder="e.g. EMP-042, Juan, or 09171234567"
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy || query.trim().length < 2}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "…" : "Find me"}
        </button>
      </div>
      {error && (
        <div className="mt-3 text-sm text-red-600 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="mt-3 text-sm text-gray-600 flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-blue-500" />
          <span>{info}</span>
        </div>
      )}
      {matches.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-500 mb-2">Tap your record:</p>
          <div className="space-y-2">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onIdentified(m.id)}
                className="w-full text-left border border-gray-200 rounded p-3 hover:border-blue-400 hover:bg-blue-50 transition"
              >
                <div className="text-sm font-medium text-gray-900">
                  {m.fullName}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 font-mono">
                  {m.employeeIdMasked} · {m.mobileMasked}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Onboarding checklist ──────────────────────────────────────────────

function OnboardingChecklist({
  qrToken,
  project,
  participant,
  onRefresh,
}: {
  qrToken: string;
  project: Project;
  participant: Participant;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">Signed in as</div>
            <div className="text-lg font-semibold text-gray-900">
              {participant.fullName}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {participant.employeeId}
            </div>
          </div>
          <StagePill stage={participant.currentStage} />
        </div>
      </div>

      {/* Steps */}
      <EmailStep
        qrToken={qrToken}
        participant={participant}
        project={project}
        onDone={onRefresh}
      />
      <InvitationStep
        qrToken={qrToken}
        participant={participant}
        project={project}
        onDone={onRefresh}
      />
      <AppUpdateStep
        qrToken={qrToken}
        participant={participant}
        project={project}
        onDone={onRefresh}
      />
      <MobileStep
        qrToken={qrToken}
        participant={participant}
        onDone={onRefresh}
      />
      <ScreenshotStep
        qrToken={qrToken}
        participant={participant}
        project={project}
        onDone={onRefresh}
      />
    </div>
  );
}

function StagePill({ stage }: { stage: number }) {
  const isComplete = stage === 6;
  return (
    <div
      className={`px-3 py-1 rounded-full text-xs font-medium ${
        isComplete
          ? "bg-green-100 text-green-800"
          : stage >= 3
          ? "bg-blue-100 text-blue-800"
          : "bg-gray-100 text-gray-700"
      }`}
    >
      {isComplete ? "Complete ✓" : `Step ${stage} of 6`}
    </div>
  );
}

// ─── Individual step components ────────────────────────────────────────

function Step({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 shrink-0">
          {done ? (
            <CheckCircle2 size={20} className="text-green-600" />
          ) : (
            <Circle size={20} className="text-gray-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="mt-2 text-sm text-gray-600">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Screen B — Email step
function EmailStep({
  qrToken,
  participant,
  project,
  onDone,
}: {
  qrToken: string;
  participant: Participant;
  project: Project;
  onDone: () => void;
}) {
  const done = Boolean(
    participant.playstoreEmail && participant.emailConfirmedIsPlaystore,
  );
  const [email, setEmail] = useState(participant.playstoreEmail || "");
  const [acknowledged, setAcknowledged] = useState(participant.emailConfirmedIsPlaystore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participant.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: {
              playstoreEmail: email.trim(),
              emailConfirmedIsPlaystore: acknowledged,
            },
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const looksLikeCompanyEmail =
    email &&
    project.blockedEmailDomains &&
    project.blockedEmailDomains
      .toLowerCase()
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .some((d) => email.toLowerCase().endsWith("@" + d));

  return (
    <Step done={done} title="1. Your Play Store email">
      <p className="mb-3">
        <strong>This is the email you use to sign in to the Google Play
        Store on this phone (your Google account).</strong> Not your company
        email. Not your Employee ID.
      </p>
      <details className="mb-3 text-xs">
        <summary className="cursor-pointer text-blue-600 hover:underline">
          How to find your Play Store email
        </summary>
        <div className="mt-2 text-gray-600 bg-gray-50 rounded p-2">
          Open the Play Store app → tap your profile icon (top right) → the
          email shown there is the one to enter.
        </div>
      </details>
      <div className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@gmail.com"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
        {looksLikeCompanyEmail && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              That looks like a company email. Are you sure this is what you
              use on your phone's Play Store?
            </span>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1"
          />
          <span>
            I confirm this is the email I use on my Play Store / Google
            account.
          </span>
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !email.trim() || !acknowledged}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : done ? "Update" : "Save"}
        </button>
      </div>
    </Step>
  );
}

// Screen C — Invitation step
function InvitationStep({
  qrToken,
  participant,
  project,
  onDone,
}: {
  qrToken: string;
  participant: Participant;
  project: Project;
  onDone: () => void;
}) {
  const done = participant.invitationAcceptedDeclared && participant.betaRegistered;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (
    accepted: boolean,
    linkFailed: boolean,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participant.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: {
              invitationAcceptedDeclared: accepted,
              invitationLinkFailed: linkFailed,
            },
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!participant.playstoreEmail || !participant.emailConfirmedIsPlaystore) {
    return (
      <Step done={false} title="2. Accept the beta invitation">
        <p className="text-gray-500 text-xs">
          Complete step 1 first.
        </p>
      </Step>
    );
  }

  if (!participant.betaRegistered) {
    return (
      <Step done={false} title="2. Accept the beta invitation">
        <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded p-3">
          <strong>We're adding your email to the tester list.</strong> You'll
          be able to accept the invitation shortly. This step will unlock
          automatically when we're done — check back in a bit.
        </div>
      </Step>
    );
  }

  return (
    <Step done={done} title="2. Accept the beta invitation">
      {project.betaInviteUrl ? (
        <a
          href={project.betaInviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 mb-3"
        >
          <Mail size={14} /> Open invitation link
        </a>
      ) : (
        <p className="text-sm text-amber-700 mb-3">
          Your CST rep hasn't added the invitation link yet. Please check back later.
        </p>
      )}
      <p className="text-xs text-gray-600 mb-3">
        Tap the link above, sign in with the same Google account, and tap
        <strong> "Become a tester"</strong>.
      </p>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => submit(true, false)}
          disabled={busy}
          className={`px-3 py-2 rounded text-xs font-medium border ${
            done
              ? "bg-green-100 border-green-300 text-green-800"
              : "border-gray-300 bg-white hover:bg-gray-50"
          }`}
        >
          Yes, accepted
        </button>
        <button
          type="button"
          onClick={() => submit(false, false)}
          disabled={busy}
          className="px-3 py-2 rounded text-xs border border-gray-300 bg-white hover:bg-gray-50"
        >
          Not yet
        </button>
        <button
          type="button"
          onClick={() => submit(false, true)}
          disabled={busy}
          className="px-3 py-2 rounded text-xs border border-gray-300 bg-white hover:bg-gray-50"
        >
          Link didn't work
        </button>
      </div>
    </Step>
  );
}

// Screen D — App update step
function AppUpdateStep({
  qrToken,
  participant,
  project,
  onDone,
}: {
  qrToken: string;
  participant: Participant;
  project: Project;
  onDone: () => void;
}) {
  const done = participant.appUpdatedDeclared;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (updated: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participant.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: { appUpdatedDeclared: updated },
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!participant.invitationAcceptedDeclared || !participant.betaRegistered) {
    return (
      <Step done={false} title="3. Update the app">
        <p className="text-gray-500 text-xs">Complete step 2 first.</p>
      </Step>
    );
  }

  return (
    <Step done={done} title="3. Update the app">
      {project.playStoreAppUrl ? (
        <a
          href={project.playStoreAppUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 mb-3"
        >
          <ExternalLink size={14} /> Open Tarkie on Play Store
        </a>
      ) : (
        <p className="text-sm text-amber-700 mb-3">
          Your CST rep hasn't added the Play Store link yet. Please check
          back later.
        </p>
      )}
      <p className="text-xs text-gray-600 mb-3">
        Tap the link above and tap <strong>Update</strong>. If you don't see
        an Update button, wait a couple of minutes and try again — sometimes
        Play Store takes a moment to serve the new build after you accept
        the invitation.
      </p>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={busy}
          className={`px-3 py-2 rounded text-xs font-medium border ${
            done
              ? "bg-green-100 border-green-300 text-green-800"
              : "border-gray-300 bg-white hover:bg-gray-50"
          }`}
        >
          Yes, updated
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={busy}
          className="px-3 py-2 rounded text-xs border border-gray-300 bg-white hover:bg-gray-50"
        >
          Not yet
        </button>
      </div>
    </Step>
  );
}

// Screen E — Mobile confirm step
function MobileStep({
  qrToken,
  participant,
  onDone,
}: {
  qrToken: string;
  participant: Participant;
  onDone: () => void;
}) {
  const done = participant.mobileConfirmed;
  const currentMobile = participant.mobileNumberCorrected || participant.mobileNumber;
  const [correction, setCorrection] = useState("");
  const [showFix, setShowFix] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participant.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: { mobileConfirmed: true },
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitCorrection = async () => {
    if (!correction.trim() || correction.replace(/\D/g, "").length < 8) {
      setError("Please enter a valid mobile number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participant.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updates: {
              mobileNumberCorrected: correction.trim(),
              mobileConfirmed: true,
            },
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setShowFix(false);
      setCorrection("");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Step done={done} title="4. Confirm your mobile number">
      <div className="flex items-center gap-2 mb-3">
        <Smartphone size={16} className="text-gray-500" />
        <span className="font-mono text-sm text-gray-900">{currentMobile}</span>
        {participant.mobileNumberCorrected && (
          <span className="text-xs text-amber-700">(corrected)</span>
        )}
      </div>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      {!showFix ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={`px-3 py-2 rounded text-xs font-medium border ${
              done
                ? "bg-green-100 border-green-300 text-green-800"
                : "border-gray-300 bg-white hover:bg-gray-50"
            }`}
          >
            Yes, that's correct
          </button>
          <button
            type="button"
            onClick={() => setShowFix(true)}
            disabled={busy}
            className="px-3 py-2 rounded text-xs border border-gray-300 bg-white hover:bg-gray-50"
          >
            No, fix it
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="tel"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="09171234567"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitCorrection}
              disabled={busy}
              className="px-3 py-2 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save correction"}
            </button>
            <button
              type="button"
              onClick={() => { setShowFix(false); setError(null); }}
              className="px-3 py-2 text-xs text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Step>
  );
}

// Screen F — Screenshot upload step
function ScreenshotStep({
  qrToken,
  participant,
  project,
  onDone,
}: {
  qrToken: string;
  participant: Participant;
  project: Project;
  onDone: () => void;
}) {
  const done = Boolean(participant.versionScreenshotUrl);
  const verified = participant.versionVerified === "verified";
  const mismatch = participant.versionVerified === "mismatch";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participant.id}/screenshot`,
        { method: "POST", body: form },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!participant.appUpdatedDeclared) {
    return (
      <Step done={false} title="5. Prove the app is on the new version">
        <p className="text-gray-500 text-xs">Complete step 3 first.</p>
      </Step>
    );
  }

  return (
    <Step done={done} title="5. Prove the app is on the new version">
      <div className="text-xs text-gray-600 mb-3 space-y-2">
        <p>
          Open the Tarkie app → tap <strong>More</strong> → scroll to the
          bottom → screenshot the version number.
        </p>
        {project.referenceScreenshotUrl && (
          <a
            href={project.referenceScreenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            See what it should look like <ExternalLink size={10} />
          </a>
        )}
      </div>

      {done && (
        <div className="mb-3 border border-gray-200 rounded p-3 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <Camera size={14} className="text-gray-500" />
            <span className="font-medium text-gray-900">Uploaded</span>
            {verified && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                ✓ Verified
              </span>
            )}
            {mismatch && (
              <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                Version doesn't match — please re-upload
              </span>
            )}
            {!verified && !mismatch && (
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                Reviewing…
              </span>
            )}
          </div>
          {project.targetAppVersion && (
            <p className="text-xs text-gray-500">
              Target: <span className="font-mono">{project.targetAppVersion}</span>
            </p>
          )}
        </div>
      )}

      <label className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 cursor-pointer">
        <Camera size={14} />
        {busy ? "Uploading…" : done ? "Re-upload" : "Upload screenshot"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
          className="hidden"
        />
      </label>
      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
    </Step>
  );
}
