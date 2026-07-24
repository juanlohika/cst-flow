"use client";

/**
 * Full-screen onboarding guide overlay for pilot participants.
 *
 * Users on the portal are almost always on a phone. Opening the guide in a new
 * tab reliably loses them — they forget which portal was theirs. So this
 * renders as an in-page overlay drawer: the portal stays mounted underneath,
 * and closing the drawer returns them to exactly where they were.
 *
 * Content mirrors the Tarkie App Download & Access Guide (see
 * public/pilot-guide/*.jpg for the pinned screenshots). Two scenarios are
 * tabbed at the top so the same drawer can be reused once we go public with a
 * store-listed build.
 */
import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, AlertTriangle, Lightbulb, Mail, ExternalLink } from "lucide-react";

interface Pin {
  n: number;
  x: number;
  y: number;
  label: string;
}
interface Screen {
  cap: string;
  img: string;
  label?: string;
  pins?: Pin[];
}
interface Step {
  nav: string;
  title: string;
  lead: string;
  instr: string;
  important?: string;
  tip?: string;
  screens: Screen[];
}
interface Scenario {
  key: string;
  label: string;
  tag: string;
  blurb: string;
  steps: Step[];
}

const GUIDE_DATA: { scenarios: Scenario[] } = {
  scenarios: [
    {
      key: "beta",
      label: "Internal Beta (Test)",
      tag: "Latest test build",
      blurb:
        "Join our internal test to run the newest version before it goes public. This is what your invite link is for.",
      steps: [
        {
          nav: "Confirm account",
          title: "Confirm your Play Store account",
          lead: "This is the #1 thing people get wrong.",
          instr:
            "Tap your <b>profile photo</b> at the top-right of Google Play and note the account signed in. <b>The email shown there is the one you must give us</b> for the invite.",
          screens: [
            {
              cap: "Tap the profile photo to see the active account",
              img: "/pilot-guide/screen-2.jpg",
              label: "See account",
              pins: [{ n: 1, x: 86, y: 16, label: "Tap here — this is your active account" }],
            },
            {
              cap: "Wrong account? Switch, then reopen the link",
              img: "/pilot-guide/screen-3.jpg",
              label: "Switch account",
              pins: [{ n: 1, x: 86, y: 16, label: "Tap → add / switch account" }],
            },
          ],
          important:
            "Many phones hold <b>several Google accounts</b>. The one <i>signed in</i> to Play Store is often not the email people give us — that mismatch is exactly why an invite seems to “not show up”.",
          tip: "Send us the <b>exact email</b> shown under your profile photo — not the one you assume you use.",
        },
        {
          nav: "Accept invite",
          title: "Open the link & accept the invite",
          lead: "We email you the internal-testing link.",
          instr:
            "Open the link we send — on the phone signed in with your confirmed account — and tap <code>Accept invite</code>.",
          screens: [
            {
              cap: "Invited ✓ — tap Accept invite",
              img: "/pilot-guide/screen-4.jpg",
              label: "Invited ✓",
              pins: [{ n: 1, x: 76, y: 59, label: "Tap Accept invite" }],
            },
            {
              cap: "Not invited — “App not available”",
              img: "/pilot-guide/screen-3.jpg",
              label: "Not invited",
              pins: [{ n: 1, x: 86, y: 16, label: "Wrong account — go back to Step 1" }],
            },
          ],
          important:
            "If you see <b>“App not available”</b> instead of <i>Accept invite</i>, the signed-in account is not the one we invited. Go back to <b>Step 1</b>, switch to the correct account, and reopen the link.",
          tip: "After we add your email, the invite can take a few minutes to appear.",
        },
        {
          nav: "Download",
          title: "Download the test app",
          lead: "You are now a tester.",
          instr: "After accepting, tap <code>Download test app</code>.",
          screens: [
            {
              cap: "You're a tester — Download test app",
              img: "/pilot-guide/screen-5.jpg",
              pins: [{ n: 1, x: 73, y: 62, label: "Tap Download test app" }],
            },
          ],
          important: "Do not tap <b>Leave test program</b> — that removes you from the beta.",
          tip: "Already have the public app? The test build updates over it automatically.",
        },
        {
          nav: "Open beta",
          title: "Install & open the beta",
          lead: "Confirm you are on the beta build.",
          instr:
            "Let it install, then tap <code>Open</code>. The listing reads <b>Tarkie Field Intelligence (Internal Beta)</b>.",
          screens: [
            {
              cap: "Internal Beta build installing",
              img: "/pilot-guide/screen-6.jpg",
              pins: [{ n: 1, x: 50, y: 20, label: "“(Internal Beta)” = you're on the test build" }],
            },
          ],
          important:
            "A note may read <b>“You're an internal tester. This app may be unstable.”</b> — that is expected on test builds.",
          tip: "To leave the beta later: uninstall it, then install the public version from Play Store.",
        },
      ],
    },
    {
      key: "regular",
      label: "Regular Download",
      tag: "Public release",
      blurb: "Once the app is public on Google Play, this is how you get it.",
      steps: [
        {
          nav: "Install",
          title: "Find & install Tarkie",
          lead: "Straight from Google Play.",
          instr:
            "Open <b>Google Play</b>, search <b>Tarkie Field Intelligence</b> (by <b>MobileOptima, Inc.</b>), then tap <code>Install</code>.",
          screens: [
            {
              cap: "Google Play — Tarkie Field Intelligence",
              img: "/pilot-guide/screen-1.jpg",
              pins: [{ n: 1, x: 44, y: 52, label: "Tap Install" }],
            },
          ],
          important: "Check the developer reads <b>MobileOptima, Inc.</b> — that is the official app.",
          tip: "It is small (~15 MB) and installs in a moment, even on mobile data.",
        },
        {
          nav: "Open",
          title: "Open & sign in",
          lead: "Launch Tarkie and log in.",
          instr:
            "Once installed, the <code>Install</code> button becomes <code>Open</code> — tap it to launch, then sign in with your registered mobile number.",
          screens: [
            {
              cap: "After install, Install becomes Open",
              img: "/pilot-guide/screen-1.jpg",
              pins: [{ n: 1, x: 44, y: 52, label: "Install → Open" }],
            },
          ],
          important:
            "Signing in (number, OTP, PIN, permissions) is covered separately by your CST rep once you're on the build.",
        },
      ],
    },
  ],
};

interface Props {
  open: boolean;
  onClose: () => void;
  // Scenario to open on. Screen C only shows internal-beta invitations, so we
  // default the guide to that scenario. When the pilot goes public, callers
  // can pass "regular" to open on that tab instead.
  initialScenario?: "beta" | "regular";
  // Optional URL for the "Accept invite" flow. When present, the "Next"
  // button on the final step of the Internal Beta scenario becomes an
  // "Open invitation" call-to-action that opens the invite in a new tab
  // and dismisses the guide — the user lands directly on the action the
  // guide just walked them through, no dead-end.
  invitationUrl?: string | null;
  // Same idea for the Regular Download scenario — the Play Store link,
  // used on the final step when the beta doesn't apply.
  playStoreUrl?: string | null;
}

export function PilotOnboardingGuide({
  open,
  onClose,
  initialScenario = "beta",
  invitationUrl,
  playStoreUrl,
}: Props) {
  const [scenIdx, setScenIdx] = useState(() =>
    GUIDE_DATA.scenarios.findIndex((s) => s.key === initialScenario) >= 0
      ? GUIDE_DATA.scenarios.findIndex((s) => s.key === initialScenario)
      : 0,
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [screenIdx, setScreenIdx] = useState(0);

  // Reset navigation state to the top when the drawer closes so that reopening
  // gives a clean state. Also lock body scroll while the drawer is open so
  // mobile Safari doesn't scroll the portal behind the overlay.
  useEffect(() => {
    if (!open) {
      setStepIdx(0);
      setScreenIdx(0);
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const scen = GUIDE_DATA.scenarios[scenIdx];
  const step = scen?.steps[stepIdx];
  const screen = step?.screens[screenIdx];

  const isLast = useMemo(() => {
    if (!scen || !step) return true;
    return stepIdx === scen.steps.length - 1 && screenIdx === step.screens.length - 1;
  }, [scen, step, stepIdx, screenIdx]);

  const isFirst = stepIdx === 0 && screenIdx === 0;

  // On the final screen, replace the disabled "Next" with a call-to-action
  // that opens the URL the guide was preparing the user to tap. Which URL
  // depends on which scenario they're viewing.
  const ctaUrl =
    isLast && scen?.key === "beta"
      ? invitationUrl || null
      : isLast && scen?.key === "regular"
      ? playStoreUrl || null
      : null;
  const ctaLabel =
    scen?.key === "beta" ? "Open invitation" : "Open Play Store";

  if (!open || typeof document === "undefined") return null;

  const goBack = () => {
    if (screenIdx > 0) setScreenIdx((s) => s - 1);
    else if (stepIdx > 0) {
      const prevStep = scen.steps[stepIdx - 1];
      setStepIdx((s) => s - 1);
      setScreenIdx(prevStep.screens.length - 1);
    }
  };
  const goNext = () => {
    if (!step) return;
    if (screenIdx < step.screens.length - 1) setScreenIdx((s) => s + 1);
    else if (stepIdx < scen.steps.length - 1) {
      setStepIdx((s) => s + 1);
      setScreenIdx(0);
    }
  };
  const switchScenario = (i: number) => {
    setScenIdx(i);
    setStepIdx(0);
    setScreenIdx(0);
  };
  const jumpToStep = (i: number) => {
    setStepIdx(i);
    setScreenIdx(0);
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-black/80 flex flex-col">
      {/* Sticky top bar — always reachable by thumb */}
      <div className="flex items-center justify-between bg-white border-b border-gray-200 px-4 py-3 shrink-0">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            How to accept the invite
          </div>
          <div className="text-xs text-gray-500">Illustrated step-by-step</div>
        </div>
        <button
          type="button"
          aria-label="Close guide"
          onClick={onClose}
          className="p-2 -mr-2 rounded-md hover:bg-gray-100 text-gray-700"
        >
          <X size={22} />
        </button>
      </div>

      {/* Scenario tabs */}
      <div className="bg-white border-b border-gray-100 px-4 flex gap-2 shrink-0 overflow-x-auto">
        {GUIDE_DATA.scenarios.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => switchScenario(i)}
            className={
              "px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap " +
              (i === scenIdx
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-800")
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {/* Scenario blurb + step pills */}
        <div className="bg-white border-b border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-700 leading-snug">{scen.blurb}</p>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {scen.steps.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => jumpToStep(i)}
                className={
                  "shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs " +
                  (i === stepIdx
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50")
                }
              >
                <span
                  className={
                    "inline-flex items-center justify-center rounded-full text-[10px] font-bold w-4 h-4 " +
                    (i === stepIdx ? "bg-white/20 text-white" : "bg-gray-100 text-gray-700")
                  }
                >
                  {i + 1}
                </span>
                {s.nav}
              </button>
            ))}
          </div>
        </div>

        {/* Step body */}
        <div className="p-4 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-blue-700 font-semibold">
              Step {stepIdx + 1} of {scen.steps.length}
            </div>
            <h3
              className="text-base font-semibold text-gray-900 mt-0.5"
              dangerouslySetInnerHTML={{ __html: step.title }}
            />
            <p className="text-xs text-gray-500 mt-0.5">{step.lead}</p>
          </div>

          {/* Phone frame with screenshot + pins */}
          {screen ? (
            <div className="mx-auto max-w-[260px]">
              <div className="relative rounded-[20px] bg-gray-900 p-1.5 shadow-xl">
                <div className="relative rounded-[14px] overflow-hidden bg-white" style={{ aspectRatio: "1080/2340" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screen.img}
                    alt={screen.cap}
                    className="absolute inset-0 w-full h-full object-cover object-top"
                    loading="lazy"
                  />
                  {/* Pin badge shows the CURRENT STEP number, not a per-screen
                      counter — the original data was authored with n:1 on every
                      pin, which was misleading when the step was "2. Accept
                      invite". Anchoring to stepIdx keeps the label honest even
                      when we later add multi-pin screens. */}
                  {(screen.pins || []).map((p) => (
                    <div
                      key={p.n}
                      className="absolute w-6 h-6 rounded-full bg-lime-400 border-2 border-white text-xs font-bold text-lime-900 flex items-center justify-center shadow-lg"
                      style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%,-50%)" }}
                      title={p.label}
                    >
                      {stepIdx + 1}
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-center text-[11px] text-gray-500 mt-2 leading-tight">
                {screen.cap}
              </p>
              {step.screens.length > 1 && (
                <div className="mt-2 flex justify-center gap-1.5 flex-wrap">
                  {step.screens.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setScreenIdx(i)}
                      className={
                        "text-[10px] font-medium px-2 py-1 rounded border " +
                        (i === screenIdx
                          ? "bg-blue-50 border-blue-300 text-blue-700"
                          : "border-gray-300 text-gray-600 hover:bg-gray-50")
                      }
                    >
                      {s.label || `View ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Instruction blurb */}
          <div
            className="text-sm text-gray-800 leading-relaxed bg-white rounded-lg border border-gray-200 p-3"
            dangerouslySetInnerHTML={{ __html: step.instr }}
          />

          {step.important && (
            <div className="flex gap-2 text-xs bg-orange-50 border border-orange-200 rounded-lg p-3 text-orange-900">
              <AlertTriangle size={14} className="shrink-0 text-orange-600 mt-0.5" />
              <div dangerouslySetInnerHTML={{ __html: step.important }} />
            </div>
          )}
          {step.tip && (
            <div className="flex gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-900">
              <Lightbulb size={14} className="shrink-0 text-emerald-600 mt-0.5" />
              <div dangerouslySetInnerHTML={{ __html: step.tip }} />
            </div>
          )}
        </div>
      </div>

      {/* Sticky footer nav */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={goBack}
          disabled={isFirst}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 max-w-[220px] px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Back to portal
        </button>
        {isLast && ctaUrl ? (
          // Seamless hand-off — the guide's last screen shows the user WHERE
          // to tap; the CTA takes them straight to that URL and dismisses the
          // guide so they land back in the portal underneath afterwards.
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            {scen?.key === "beta" ? <Mail size={14} /> : <ExternalLink size={14} />}
            {ctaLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={goNext}
            disabled={isLast}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
