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
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Mail, ExternalLink, Smartphone, Camera, LogOut, AlertTriangle, Info, HelpCircle } from "lucide-react";
import { PilotOnboardingGuide } from "./PilotOnboardingGuide";

interface Project {
  name: string;
  targetAppVersion: string | null;
  betaInviteUrl: string | null;
  playStoreAppUrl: string | null;
  referenceScreenshotUrl: string | null;
  status: string;
  blockedEmailDomains: string | null;
  internalBetaRequired?: boolean;
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
  workEmail: string | null;
  workEmailConfirmed: boolean;
  betaRegistered: boolean;
  invitationAcceptedDeclared: boolean;
  invitationLinkFailed: boolean;
  appUpdatedDeclared: boolean;
  reportedVersion: string | null;
  versionScreenshotUrl: string | null;
  versionConfirmedByUser: boolean;
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
  branding?: { appName: string; logoUrl: string };
}

export function PilotPortalClient({ qrToken, project, branding }: Props) {
  const logoUrl = branding?.logoUrl || "";
  const appName = branding?.appName || "CST OS";
  const storageKey = `pilot-tracker:${qrToken}:participantId`;
  const successDismissedKey = `pilot-tracker:${qrToken}:successDismissed`;
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  // Success modal fires once when Screen 5 first gets a submission (either
  // one-tap confirmed OR screenshot uploaded). We keep it dismissible-and-
  // sticky per participant + qrToken so a user who reopens the portal
  // isn't ambushed by the modal again if they're just checking status.
  const [showSuccess, setShowSuccess] = useState(false);
  const [closeFallback, setCloseFallback] = useState(false);

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

  // Show the success modal the first time this participant lands in the
  // "Screen 5 submitted" state — either the one-tap confirm flipped
  // versionConfirmedByUser true, or a screenshot was uploaded. Dismissal
  // is persisted so returning visits don't re-trigger it.
  useEffect(() => {
    if (!participant) return;
    const reachedEnd =
      Boolean(participant.versionConfirmedByUser) ||
      Boolean(participant.versionScreenshotUrl);
    if (!reachedEnd) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(`${successDismissedKey}:${participant.id}`) === "1";
    } catch {}
    if (dismissed) return;
    setShowSuccess(true);
  }, [participant, successDismissedKey]);

  const dismissSuccess = () => {
    try {
      if (participant) {
        localStorage.setItem(`${successDismissedKey}:${participant.id}`, "1");
      }
    } catch {}
    setShowSuccess(false);
    setCloseFallback(false);
  };

  const tryClosePage = () => {
    try {
      if (participant) {
        localStorage.setItem(`${successDismissedKey}:${participant.id}`, "1");
      }
    } catch {}
    // window.close() only works reliably in tabs opened by script (e.g. via
    // window.open). Most mobile browsers silently ignore it for tabs the
    // user opened themselves. Fall back to a "you can close this tab now"
    // screen so the user isn't left wondering if their tap did anything.
    try { window.close(); } catch {}
    setTimeout(() => {
      if (!document.hidden) setCloseFallback(true);
    }, 150);
  };

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

  // Fallback for browsers that block programmatic window.close(). Rather
  // than leaving the user staring at an unchanged portal, replace the body
  // with a plain "all done" screen so they know the flow terminated. They
  // can still swipe / close the tab themselves.
  if (closeFallback) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <CheckCircle2 size={44} className="text-green-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">You're all set</h2>
          <p className="text-sm text-gray-600 mb-4">
            Thanks — your submission was recorded. You can safely close this
            browser tab now.
          </p>
          <button
            type="button"
            onClick={() => setCloseFallback(false)}
            className="text-xs text-gray-500 hover:text-gray-900"
          >
            Back to my submission
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 pb-8">
      {showSuccess && (
        <SuccessModal
          onClose={dismissSuccess}
          onCloseTab={tryClosePage}
          uploadedScreenshot={Boolean(participant?.versionScreenshotUrl)}
          versionVerified={participant?.versionVerified === "verified"}
        />
      )}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={appName}
                className="h-9 w-auto object-contain shrink-0"
              />
            ) : null}
            <div className="min-w-0">
              <div className="text-xs text-gray-500 truncate">{project.name}</div>
              <div className="text-sm font-semibold text-gray-900">
                Tarkie V5 Pilot
              </div>
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

  // Debounced auto-search. Fires 350ms after the user stops typing so we
  // don't spam the lookup endpoint on every keystroke. The abort ref
  // cancels a pending fetch when a newer query supersedes it.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      setInfo(null);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const res = await fetch(`/api/pilot/${qrToken}/lookup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
          signal: ctrl.signal,
        });
        const json = await res.json();
        if (ctrl.signal.aborted) return;
        if (!res.ok) {
          setError(json.error || "Lookup failed");
          setMatches([]);
          return;
        }
        if (json.matches.length === 0) {
          setMatches([]);
          setInfo("No matches yet. Try more of your name, Emp ID, or mobile.");
        } else {
          setMatches(json.matches);
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "Lookup failed");
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, qrToken]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">
        Find your record
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Type your Employee ID, name, or mobile number — results appear as
        you type.
      </p>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. EMP-042, Juan, or 09171234567"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm pr-10"
          autoFocus
          autoComplete="off"
        />
        {busy && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            …
          </span>
        )}
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
      {/* Screen C — hidden when this pilot doesn't require an internal-beta
          opt-in (participant will just update from the public store). */}
      {project.internalBetaRequired !== false && (
        <InvitationStep
          qrToken={qrToken}
          participant={participant}
          project={project}
          onDone={onRefresh}
        />
      )}
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

/**
 * Success modal — pops the first time a participant submits Screen 5 (either
 * via the one-tap confirm or by uploading a screenshot). Two exits:
 *
 *   • "Close page"          — attempts window.close(). If the browser
 *                              blocks it (common on mobile) the caller
 *                              swaps in a fallback "you're all set" view.
 *   • "Review my submission" — dismisses the modal in place so the user
 *                              can scroll back through their checklist.
 *
 * The dismissal is persisted per (qrToken, participantId) so a returning
 * user who just opens the portal to check status isn't re-ambushed by the
 * modal — the intent is celebration on first completion, not a nag.
 */
function SuccessModal({
  onClose,
  onCloseTab,
  uploadedScreenshot,
  versionVerified,
}: {
  onClose: () => void;
  onCloseTab: () => void;
  uploadedScreenshot: boolean;
  versionVerified: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="p-5 text-center">
          <CheckCircle2 size={48} className="text-green-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            You're all set!
          </h2>
          <p className="text-sm text-gray-600 leading-snug">
            {versionVerified
              ? "Your submission was verified. Thanks for getting on the beta build — you're done."
              : uploadedScreenshot
              ? "Screenshot received. Your CST rep will verify it shortly — no further action needed on your side."
              : "You've confirmed your app version. Thanks for getting on the beta build — you're done."}
          </p>
        </div>
        <div className="border-t border-gray-100 p-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={onCloseTab}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
          >
            Close page
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
          >
            Review my submission
          </button>
        </div>
      </div>
    </div>
  );
}

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

/**
 * Choice-button styling helper for the portal.
 *
 * Fill colors are strictly reserved for the CURRENT answer. Every non-active
 * button — positive or negative — renders as a neutral outlined control.
 * This is what live users kept flagging: an unanswered question was
 * showing filled rose on "Not yet" / "Link didn't work" side-by-side, and
 * every version of "muted when settled" still read as pre-selected next
 * to the outlined positive.
 *
 *   Positive + active   → filled green
 *   Negative + active   → filled rose
 *   Either + inactive   → outlined white (subtle rose tint on hover for
 *                          negatives so users can tell them apart)
 *
 * The `settled` argument is kept for callers so we don't have to update
 * every call site, but the two inactive states now render identically.
 */
function choiceClass(
  active: boolean,
  variant: "positive" | "negative",
  base: string,
  _settled: boolean = false,
): string {
  if (variant === "positive") {
    return active
      ? `${base} bg-green-100 border-green-300 text-green-800 disabled:opacity-50`
      : `${base} border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50`;
  }
  return active
    ? `${base} bg-rose-100 border-rose-400 text-rose-800 disabled:opacity-50`
    : `${base} border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50`;
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
        email.
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
  const [guideOpen, setGuideOpen] = useState(false);
  // "Not yet" is a transient (in-session) state — the server persists
  // invitationAcceptedDeclared=false, invitationLinkFailed=false, which is
  // indistinguishable from the initial state. Track the user's most recent
  // tap locally so the button reflects their choice within the page load.
  const [notYetTapped, setNotYetTapped] = useState(false);

  const submit = async (
    accepted: boolean,
    linkFailed: boolean,
  ) => {
    // Update the transient "Not yet" state on every tap: true only when the
    // user explicitly picked it, false otherwise (they moved on to Yes or
    // Link-didn't-work).
    setNotYetTapped(!accepted && !linkFailed);
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
      <button
        type="button"
        onClick={() => setGuideOpen(true)}
        className="w-full flex items-center gap-2 mb-3 px-3 py-2 rounded border border-blue-200 bg-blue-50 text-blue-800 text-xs font-medium hover:bg-blue-100"
      >
        <HelpCircle size={14} className="shrink-0" />
        <span className="flex-1 text-left">
          How to accept the invite — illustrated guide
        </span>
        <span className="text-[10px] opacity-70">Tap to open</span>
      </button>
      <PilotOnboardingGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        invitationUrl={project.betaInviteUrl}
        playStoreUrl={project.playStoreAppUrl}
      />

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
      {/* Three mutually-exclusive choices. Only one is "active"; the other
          two revert according to whether the question is settled or not. */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => submit(true, false)}
          disabled={busy}
          className={choiceClass(
            done,
            "positive",
            "px-3 py-2 rounded text-xs font-medium border",
          )}
        >
          Yes, accepted
        </button>
        <button
          type="button"
          onClick={() => submit(false, false)}
          disabled={busy}
          className={choiceClass(
            notYetTapped && !done && !participant.invitationLinkFailed,
            "negative",
            "px-3 py-2 rounded text-xs font-medium border",
          )}
        >
          Not yet
        </button>
        <button
          type="button"
          onClick={() => submit(false, true)}
          disabled={busy}
          className={choiceClass(
            participant.invitationLinkFailed,
            "negative",
            "px-3 py-2 rounded text-xs font-medium border",
            done,
          )}
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
  // Same pattern as InvitationStep — "Not yet" is transient (server
  // stores appUpdatedDeclared=false, same as the initial state), so we
  // track the tap locally.
  const [notYetTapped, setNotYetTapped] = useState(false);

  const submit = async (updated: boolean) => {
    setNotYetTapped(!updated);
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

  // When the pilot doesn't require internal-beta enrollment, Screens B → D
  // proceed directly. Only gate the app-update step when internal beta
  // actually applies.
  const gatedByBeta = project.internalBetaRequired !== false;
  if (gatedByBeta && (!participant.invitationAcceptedDeclared || !participant.betaRegistered)) {
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
      {/* Fill colors only paint the active choice. "Not yet" is a transient
          in-session marker (server can't distinguish it from initial state). */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={busy}
          className={choiceClass(
            participant.appUpdatedDeclared,
            "positive",
            "px-3 py-2 rounded text-xs font-medium border",
          )}
        >
          Yes, updated
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={busy}
          className={choiceClass(
            notYetTapped && !participant.appUpdatedDeclared,
            "negative",
            "px-3 py-2 rounded text-xs font-medium border",
          )}
        >
          Not yet
        </button>
      </div>
    </Step>
  );
}

// Screen E — Mobile + (optional) work-email confirm step.
//
// Only participants with a workEmail on file see the second sub-field. Field-
// only users (mobile-only, will use the Tarkie app + OTP-to-mobile) see the
// step exactly as before — one mobile confirm, done. Admins with a work
// email must confirm both before the step ticks green, because on Tarkie V5
// OTPs go to the work email (not the mobile) for anyone signing into the
// control tower — so an unconfirmed work email is as blocking as an
// unconfirmed mobile.
function MobileStep({
  qrToken,
  participant,
  onDone,
}: {
  qrToken: string;
  participant: Participant;
  onDone: () => void;
}) {
  const hasWorkEmail = Boolean(participant.workEmail);
  const done = hasWorkEmail
    ? participant.mobileConfirmed && participant.workEmailConfirmed
    : participant.mobileConfirmed;
  const currentMobile = participant.mobileNumberCorrected || participant.mobileNumber;
  const [correction, setCorrection] = useState("");
  const [showFix, setShowFix] = useState(false);
  const [emailCorrection, setEmailCorrection] = useState("");
  const [showEmailFix, setShowEmailFix] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (updates: Record<string, any>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pilot/${qrToken}/participant/${participant.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
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

  const confirmMobile = () => patch({ mobileConfirmed: true });
  const confirmWorkEmail = () => patch({ workEmailConfirmed: true });

  const submitCorrection = async () => {
    if (!correction.trim() || correction.replace(/\D/g, "").length < 8) {
      setError("Please enter a valid mobile number.");
      return;
    }
    await patch({
      mobileNumberCorrected: correction.trim(),
      mobileConfirmed: true,
    });
    setShowFix(false);
    setCorrection("");
  };

  const submitEmailCorrection = async () => {
    const value = emailCorrection.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Please enter a valid email address.");
      return;
    }
    await patch({
      workEmail: value,
      workEmailConfirmed: true,
    });
    setShowEmailFix(false);
    setEmailCorrection("");
  };

  return (
    <Step done={done} title={hasWorkEmail ? "4. Confirm your mobile & work email" : "4. Confirm your mobile number"}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Mobile number</div>
      <div className="flex items-center gap-2 mb-3">
        <Smartphone size={16} className="text-gray-500" />
        <span className="font-mono text-sm text-gray-900">{currentMobile}</span>
        {participant.mobileNumberCorrected && (
          <span className="text-xs text-amber-700">(corrected)</span>
        )}
        {participant.mobileConfirmed && (
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
            ✓ Confirmed
          </span>
        )}
      </div>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      {!showFix ? (
        // "No, fix it" opens an inline correction form. Once mobile is
        // confirmed, "No, fix it" mutes so the confirmed state is
        // visually unambiguous.
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={confirmMobile}
            disabled={busy || participant.mobileConfirmed}
            className={choiceClass(
              participant.mobileConfirmed,
              "positive",
              "px-3 py-2 rounded text-xs font-medium border",
            )}
          >
            {participant.mobileConfirmed ? "✓ Confirmed" : "Yes, that's correct"}
          </button>
          <button
            type="button"
            onClick={() => setShowFix(true)}
            disabled={busy}
            className={choiceClass(
              false,
              "negative",
              "px-3 py-2 rounded text-xs font-medium border",
              participant.mobileConfirmed,
            )}
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

      {hasWorkEmail && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
            Work email
          </div>
          <div className="flex items-center gap-2 mb-2 min-w-0">
            <Mail size={16} className="text-gray-500 shrink-0" />
            <span className="text-sm text-gray-900 break-all">{participant.workEmail}</span>
            {participant.workEmailConfirmed && (
              <span className="shrink-0 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                ✓ Confirmed
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-600 mb-2 leading-snug">
            Admins sign in to the control tower with this address, and OTPs
            for the app go here (not to your mobile). Confirm we have it right.
          </p>
          {!showEmailFix ? (
            // Once confirmed, "No, fix it" mutes so both buttons don't look
            // like they're in a filled/active state at the same time.
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={confirmWorkEmail}
                disabled={busy || participant.workEmailConfirmed}
                className={choiceClass(
                  participant.workEmailConfirmed,
                  "positive",
                  "px-3 py-2 rounded text-xs font-medium border",
                )}
              >
                {participant.workEmailConfirmed ? "✓ Confirmed" : "Yes, that's correct"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmailCorrection(participant.workEmail || "");
                  setShowEmailFix(true);
                  setError(null);
                }}
                disabled={busy}
                className={choiceClass(
                  false,
                  "negative",
                  "px-3 py-2 rounded text-xs font-medium border",
                  participant.workEmailConfirmed,
                )}
              >
                No, fix it
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="email"
                value={emailCorrection}
                onChange={(e) => setEmailCorrection(e.target.value)}
                placeholder="you@company.com"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={submitEmailCorrection}
                  disabled={busy}
                  className="px-3 py-2 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save correction"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowEmailFix(false); setError(null); }}
                  className="px-3 py-2 text-xs text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Step>
  );
}

// Screen F — Confirm you're on the target build.
//
// One-tap confirm is the primary path — users type "1.1.2" when the target
// is "5.1.7-beta", so freeform typing was a footgun. Screenshot upload stays
// as a secondary path for anyone who wants to prove it visually (and the
// screenshot is still the strongest signal we have for AI review).
//
// Confirming trips versionVerified='verified' server-side; CST can revert
// that to 'pending' from the roster drawer if the user turns out to have
// lied — see PilotRosterGrid.
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
  const uploaded = Boolean(participant.versionScreenshotUrl);
  const confirmed = Boolean(participant.versionConfirmedByUser);
  const done = uploaded || confirmed;
  const verified = participant.versionVerified === "verified";
  const mismatch = participant.versionVerified === "mismatch";
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
            updates: { versionConfirmedByUser: true },
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
      <Step done={false} title="5. Confirm your app version">
        <p className="text-gray-500 text-xs">Complete step 3 first.</p>
      </Step>
    );
  }

  const target = project.targetAppVersion || "";

  return (
    <Step done={done} title="5. Confirm your app version">
      <div className="text-xs text-gray-600 mb-3 space-y-1">
        <p>
          Open Tarkie → tap <strong>More</strong> → scroll to the bottom to
          see the version number.
        </p>
      </div>

      {/* Status card when already confirmed / uploaded */}
      {done && (
        <div className="mb-3 border border-gray-200 rounded p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-green-600" />
            <span className="font-medium text-gray-900">
              {confirmed && !uploaded ? "You confirmed the version" : "Screenshot uploaded"}
            </span>
            {verified && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                ✓ Verified
              </span>
            )}
            {mismatch && (
              <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                Version doesn't match — please re-check
              </span>
            )}
            {!verified && !mismatch && (
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                Reviewing…
              </span>
            )}
          </div>
          {target && (
            <p className="text-xs text-gray-500">
              Target: <span className="font-mono">{target}</span>
            </p>
          )}
        </div>
      )}

      {/* Primary — one-tap confirm */}
      {target ? (
        <div className="border border-gray-200 rounded p-3 mb-3">
          <p className="text-xs text-gray-700 mb-2">
            Is your Tarkie app on version{" "}
            <span className="font-mono font-semibold">{target}</span>?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy || confirmed}
              className={
                "px-3 py-2 rounded text-sm font-medium border " +
                (confirmed
                  ? "bg-green-100 border-green-300 text-green-800"
                  : "bg-blue-600 border-blue-600 text-white hover:bg-blue-700 disabled:opacity-50")
              }
            >
              {confirmed ? "✓ Confirmed" : `Yes, I'm on ${target}`}
            </button>
            <button
              type="button"
              disabled
              title="If you're not on the target, don't tap Yes — upload a screenshot instead so we can help."
              className={choiceClass(
                false,
                "negative",
                "px-3 py-2 rounded text-sm font-medium border cursor-default",
                confirmed,
              )}
            >
              No / Not sure
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-amber-700 mb-3">
          Your CST rep hasn't set a target version yet — please check back later.
        </p>
      )}

      {/* Secondary — optional screenshot */}
      <details className="text-xs text-gray-700">
        <summary className="cursor-pointer text-blue-700 hover:underline inline-flex items-center gap-1">
          <Camera size={12} /> Or attach a screenshot (optional)
        </summary>
        <div className="mt-2 space-y-2">
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
          <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-800 rounded text-sm font-medium hover:bg-gray-50 cursor-pointer">
            <Camera size={14} />
            {busy ? "Uploading…" : uploaded ? "Re-upload" : "Upload screenshot"}
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
        </div>
      </details>

      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
    </Step>
  );
}
