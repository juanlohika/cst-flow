/**
 * Pilot Tracker — state machine + issue-flag derivation.
 *
 * Every mutation to a PilotParticipant routes through computeStage() so
 * currentStage and issueFlag stay in sync with the source booleans. Storing
 * them (not deriving on read) means the dashboard can filter and sort by
 * stage/flag directly against indexed columns, which matters when the
 * roster is a few thousand people across many pilots.
 *
 * The "why" of the stages is in Tarkie-V5-Pilot-Tracker-Spec.md §7; this
 * module is the executable version of that table.
 *
 * The `CLICKED_NOT_REGISTERED` contradiction is the single highest-value
 * piece of logic in the whole tracker: it's the only automated way to
 * distinguish "participant is lying / confused" from "dev genuinely hasn't
 * registered them yet." Both look identical over Viber; only this rule
 * separates them.
 */

// Priority order for issue-flag resolution — first match wins.
// CLICKED_NOT_REGISTERED is highest because it's a contradiction that
// needs immediate dev action to unblock the participant. VERSION_MISMATCH
// is next because it's the only flag that lands on a *completed* stage
// (participant did everything but is on the wrong build). Everything else
// is stage-appropriate friction.
export type IssueFlag =
  | "CLICKED_NOT_REGISTERED"
  | "VERSION_MISMATCH"
  | "INVITE_NOT_RECEIVED"
  | "WRONG_EMAIL"
  | "AWAITING_REGISTRATION"
  | "STALE"
  | "NONE";

// The 8 stages of onboarding. See spec §7 for the narrative version.
//   0 IMPORTED           — roster row exists, participant hasn't opened portal
//   1 EMAIL_CAPTURED     — playstoreEmail set + emailConfirmedIsPlaystore=true
//   2 BETA_REGISTERED    — dev has added the email to Play tester list (hard gate)
//   3 INVITATION_ACCEPTED — participant clicked opt-in link + tapped "Become a tester"
//   4 APP_UPDATED        — participant updated the app from Play Store
//   5 CONTACTS_CONFIRMED  — participant confirmed mobile number (and work email, if
//                           they have one on file). Screenshot is no longer a stage;
//                           it's optional evidence for Stage 6.
//   6 VERSION_VERIFIED   — versionVerified === "verified" (one-tap confirmation OR
//                           CST/AI reviewed a screenshot).
//   7 NO_BLOCKERS        — Stage 6 AND no outstanding portal-driven corrections
//                           still need CST attention. Only participants at this
//                           stage are "truly complete" from an onboarding
//                           perspective.
export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * The subset of participant fields the state machine reads. Kept as a plain
 * interface (not `typeof pilotParticipants.$inferSelect`) so this module has
 * no Drizzle import — makes it trivially testable and callable from anywhere.
 */
export interface ParticipantState {
  // Stage 1 inputs
  playstoreEmail: string | null | undefined;
  emailConfirmedIsPlaystore: boolean;
  // Stage 2 input (dev/CST-controlled)
  betaRegistered: boolean;
  // Stage 3 inputs
  invitationAcceptedDeclared: boolean;
  invitationLinkFailed: boolean;
  // Stage 4 input
  appUpdatedDeclared: boolean;
  // Stage 5 inputs — participant confirmed mobile (and, if their roster
  // row shipped a work email, they confirmed that too). Screenshot upload
  // is now decoupled from stage progression; it's just optional evidence
  // that helps CST/AI verify Stage 6.
  mobileConfirmed: boolean;
  workEmail?: string | null;
  workEmailConfirmed?: boolean;
  versionScreenshotDriveId: string | null | undefined;
  versionConfirmedByUser?: boolean;
  // Stage 6 input (CST/AI-controlled)
  versionVerified: "pending" | "verified" | "mismatch" | string;
  // Stage 7 inputs — CST has resolved every portal-driven correction so
  // the participant has no outstanding actions on our side. Nullable ISO
  // timestamps; presence = resolved.
  contactCorrectionResolvedAt?: string | null;
  emailCorrectionResolvedAt?: string | null;
  // Whether this participant has *any* unresolved portal correction on
  // record. The caller sets this by consulting the change log — the state
  // machine takes it as a plain boolean so it stays pure.
  hasUnresolvedContactCorrection?: boolean;
  hasUnresolvedEmailCorrection?: boolean;
  // For STALE detection. ISO-8601 datetime string. Optional — if omitted,
  // STALE never fires.
  lastActivityAt?: string | null;
}

export interface ProjectState {
  // Comma-separated list of email domains that flag WRONG_EMAIL.
  // e.g. "sepco.com.ph,mopt.com". Case-insensitive.
  blockedEmailDomains?: string | null;
  // Days of inactivity before STALE fires. Spec default: 3.
  staleThresholdDays?: number | null;
  // Whether this pilot requires participants to opt into an internal-test
  // track (Screens C + D). When false, Stages 2 (beta registered) and 3
  // (invitation accepted) are auto-satisfied — the participant just needs
  // to update the app from the public store. Defaults to true (safest).
  internalBetaRequired?: boolean | null;
}

export interface ComputedState {
  stage: Stage;
  issueFlag: IssueFlag;
}

/**
 * Compute the stage + issue flag for a participant. Deterministic — same
 * inputs always yield the same outputs. Never throws.
 *
 * Reads `project.blockedEmailDomains` for WRONG_EMAIL detection and
 * `project.staleThresholdDays` for STALE detection. Both are optional.
 */
export function computeStage(
  participant: ParticipantState,
  project: ProjectState = {},
): ComputedState {
  // When the project doesn't require internal-beta enrollment (public app
  // pilot), synthesize the two beta gates as satisfied. Everything else in
  // the derivation is unchanged.
  const p: ParticipantState =
    project.internalBetaRequired === false
      ? {
          ...participant,
          betaRegistered: true,
          invitationAcceptedDeclared: true,
          invitationLinkFailed: false, // Never fires the "invite" flag on public flow.
        }
      : participant;
  const stage = computeStageOnly(p);
  const issueFlag = computeIssueFlag(p, project, stage);
  return { stage, issueFlag };
}

/**
 * Stage-only derivation, extracted so the issue-flag logic can reference the
 * stage without re-computing. The order of checks matters — descend from
 * highest stage down; return the first that qualifies. A participant at
 * Stage 4 (app updated) is by definition also past Stages 1–3, so the
 * cascade is correct: any earlier stage's requirements are implicit.
 */
function computeStageOnly(p: ParticipantState): Stage {
  // Stage 7 — the "truly complete" bucket. Requires Stage 6 semantics
  // AND no outstanding portal correction still awaiting CST resolution.
  // The `hasUnresolved*Correction` inputs are computed by the caller
  // (participant-mutations reads the change log); their absence
  // defaults to false, so a fresh-inserted verified participant lands
  // directly at Stage 7 with no lookups.
  if (
    p.versionVerified === "verified" &&
    !p.hasUnresolvedContactCorrection &&
    !p.hasUnresolvedEmailCorrection
  ) {
    return 7;
  }

  // Stage 6 — verified, but at least one CST-side correction is
  // outstanding. The participant is on the target build but we still
  // need to mirror their mobile / work email / Play Store email to
  // our other systems.
  if (p.versionVerified === "verified") return 6;

  // Stage 5 — participant has confirmed their contact details.
  //   • Mobile is always required.
  //   • Work email is required only when they have one on file — mobile-
  //     only field users don't have a work email to confirm, so mobile
  //     alone qualifies them.
  //
  // Screenshot / one-tap version confirmation live at Stage 6 only.
  const hasWorkEmail = Boolean(p.workEmail);
  const workEmailOk = hasWorkEmail ? Boolean(p.workEmailConfirmed) : true;
  if (p.mobileConfirmed && workEmailOk) return 5;

  // Stage 4 — participant claims app updated.
  if (p.appUpdatedDeclared) return 4;

  // Stage 3 — invitation accepted. Guarded by betaRegistered so a lying
  // or confused participant doesn't get credited for a stage they can't
  // actually be at. The mismatch surfaces as the CLICKED_NOT_REGISTERED
  // flag below (not as a stage — the participant is still legitimately at
  // Stage 2 or lower until dev registers them).
  if (p.invitationAcceptedDeclared && p.betaRegistered) return 3;

  // Stage 2 — beta registration (dev-controlled).
  if (p.betaRegistered) return 2;

  // Stage 1 — email captured + acknowledged.
  if (p.playstoreEmail && p.emailConfirmedIsPlaystore) return 1;

  // Stage 0 — imported, no participant action yet.
  return 0;
}

/**
 * Issue-flag derivation. Priority order matters — the first match wins,
 * because a single record shows exactly one flag in the dashboard.
 *
 * Rationale for the order:
 *   1. CLICKED_NOT_REGISTERED — data contradiction. Needs dev NOW.
 *   2. VERSION_MISMATCH       — objective proof of the wrong build.
 *   3. INVITE_NOT_RECEIVED    — participant said the link didn't work, and
 *                               they're already registered, so it's a real
 *                               Play-list issue not an expected pre-reg fail.
 *   4. WRONG_EMAIL            — heuristic (company domain match). Soft signal.
 *   5. AWAITING_REGISTRATION  — the largest bucket. Dev handles via bulk export.
 *   6. STALE                  — no participant activity in N days. Follow-up.
 *   7. NONE                   — on track.
 */
function computeIssueFlag(
  p: ParticipantState,
  project: ProjectState,
  stage: Stage,
): IssueFlag {
  // 1. Contradiction: claims accepted but not on the tester list.
  //    This is the whole point of the tracker — surface this immediately.
  if (p.invitationAcceptedDeclared && !p.betaRegistered) {
    return "CLICKED_NOT_REGISTERED";
  }

  // 2. Verified wrong build. Never masks — even completed-looking flow
  //    reverts to VERSION_MISMATCH if the screenshot doesn't match target.
  if (p.versionVerified === "mismatch") {
    return "VERSION_MISMATCH";
  }

  // 3. Registered but the link didn't work. Real problem on Play side.
  //    (Before registration, "link didn't work" is expected — no flag.)
  if (p.betaRegistered && p.invitationLinkFailed) {
    return "INVITE_NOT_RECEIVED";
  }

  // 4. Heuristic — email domain matches an admin-configured blocklist.
  //    Applies even after Stage 1 as a persistent "this looks wrong."
  //    Doesn't fire if the participant explicitly acknowledged it IS their
  //    Play Store email? No — we still warn, because ack doesn't make it
  //    correct. If dev later confirms the email works, they mark Beta
  //    registered which promotes past Stage 1, and this flag stays visible
  //    as a soft-warning breadcrumb in the audit but doesn't block.
  //    Actually, we DO clear it once betaRegistered flips to true — if it
  //    worked, it was fine after all. Guard here.
  if (
    !p.betaRegistered &&
    p.playstoreEmail &&
    emailMatchesBlockedDomain(p.playstoreEmail, project.blockedEmailDomains)
  ) {
    return "WRONG_EMAIL";
  }

  // 5. The routine "dev needs to add this email" bucket. Applies whenever
  //    email is captured but not yet registered. This is what the bulk
  //    export feeds off (§9.4).
  if (p.playstoreEmail && p.emailConfirmedIsPlaystore && !p.betaRegistered) {
    return "AWAITING_REGISTRATION";
  }

  // 6. Stale — only meaningful before Complete. A verified participant
  //    doesn't get flagged stale; they're done.
  if (stage < 6 && isStale(p.lastActivityAt, project.staleThresholdDays)) {
    return "STALE";
  }

  return "NONE";
}

/**
 * Email domain match — case-insensitive, tolerant of whitespace.
 *
 * blockedDomains is a comma-separated string like "sepco.com.ph, mopt.com".
 * The check compares the email's domain against each entry after both are
 * lowercased and trimmed. Exact match only (no subdomain wildcard); if
 * someone's Google account is on a subdomain, that's usually intentional
 * and shouldn't false-positive.
 */
function emailMatchesBlockedDomain(
  email: string,
  blockedDomains: string | null | undefined,
): boolean {
  if (!blockedDomains) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  const blocklist = blockedDomains
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return blocklist.includes(domain);
}

/**
 * Stale check — has this participant been inactive longer than the
 * configured threshold? Missing `lastActivityAt` or missing threshold
 * both mean "not stale" (never fires).
 */
function isStale(
  lastActivityAt: string | null | undefined,
  thresholdDays: number | null | undefined,
): boolean {
  if (!lastActivityAt || !thresholdDays || thresholdDays <= 0) return false;
  const last = new Date(lastActivityAt).getTime();
  if (Number.isNaN(last)) return false;
  const cutoff = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
  return last < cutoff;
}

/**
 * Human-readable stage label — for the admin dashboard.
 */
export function stageLabel(stage: Stage): string {
  return [
    "Imported",
    "Email captured",
    "Beta registered",
    "Invitation accepted",
    "App updated",
    "Mobile & work email confirmed",
    "Version verified",
    "Complete (no blockers)",
  ][stage] || "Unknown";
}


/**
 * Human-readable flag label — for the admin dashboard chips.
 */
export function flagLabel(flag: IssueFlag): string {
  const map: Record<IssueFlag, string> = {
    CLICKED_NOT_REGISTERED: "Accepted but not registered",
    VERSION_MISMATCH:       "Wrong app version",
    INVITE_NOT_RECEIVED:    "Invite link didn't work",
    WRONG_EMAIL:            "Email looks wrong",
    AWAITING_REGISTRATION:  "Waiting on dev",
    STALE:                  "No activity",
    NONE:                   "On track",
  };
  return map[flag];
}
