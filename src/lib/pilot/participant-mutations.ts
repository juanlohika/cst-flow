/**
 * Pilot Tracker — participant mutation helpers.
 *
 * Every write to PilotParticipant flows through updateParticipant() so
 * we always: (a) re-derive currentStage + issueFlag via computeStage,
 * (b) bump lastActivityAt + updatedAt, (c) write a PilotChangeLog row
 * per changed field.
 *
 * Never mutate PilotParticipant with `db.update()` directly from routes.
 * Always call updateParticipant() — it's the invariant guard.
 */
import { db } from "@/db";
import { pilotParticipants, pilotProjects, pilotChangeLog } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { computeStage, type IssueFlag } from "./state-machine";

/**
 * Fields a mutation can touch. Excludes derived (currentStage, issueFlag)
 * and audit (lastActivityAt, updatedAt) — those are set by this helper.
 * Excludes createdAt + id — those are immutable after creation.
 */
export interface ParticipantUpdate {
  playstoreEmail?: string | null;
  emailConfirmedIsPlaystore?: boolean;
  emailCapturedAt?: string | null;
  workEmail?: string | null;
  workEmailConfirmed?: boolean;
  workEmailConfirmedAt?: string | null;
  betaRegistered?: boolean;
  betaRegisteredAt?: string | null;
  betaRegisteredByUserId?: string | null;
  invitationAcceptedDeclared?: boolean;
  invitationAcceptedAt?: string | null;
  invitationLinkFailed?: boolean;
  appUpdatedDeclared?: boolean;
  appUpdatedAt?: string | null;
  mobileNumberCorrected?: string | null;
  mobileConfirmed?: boolean;
  mobileConfirmedAt?: string | null;
  reportedVersion?: string | null;
  versionScreenshotDriveId?: string | null;
  versionScreenshotUrl?: string | null;
  versionScreenshotUploadedAt?: string | null;
  versionConfirmedByUser?: boolean;
  versionConfirmedByUserAt?: string | null;
  versionVerified?: "pending" | "verified" | "mismatch";
  versionVerifiedByUserId?: string | null;
  versionVerifiedByAi?: boolean;
  versionAiExtractedText?: string | null;
  versionVerifiedAt?: string | null;
  // CST-side resolution flags for portal-driven corrections. Setting
  // these true stamps the *At and *By fields; the state machine reads
  // the resolved status to decide whether the participant is eligible
  // for Stage 7 (Complete, no blockers).
  contactCorrectionResolved?: boolean;
  contactCorrectionResolvedAt?: string | null;
  contactCorrectionResolvedBy?: string | null;
  emailCorrectionResolved?: boolean;
  emailCorrectionResolvedAt?: string | null;
  emailCorrectionResolvedBy?: string | null;
}

export type Actor = "participant" | "cst" | "dev" | "ai" | "system";

export interface UpdateOptions {
  actor: Actor;
  // For actor === "cst" | "dev": the userId of the admin performing the change.
  // Optional otherwise.
  actorUserId?: string | null;
  // Optional context appended to every ChangeLog row written from this call.
  note?: string;
  // Callers doing a bulk operation (e.g. roster XLSX import) set this true
  // so per-participant broadcasts are suppressed. The bulk caller is
  // expected to collect events and emit a single digest broadcast at the
  // end. All non-broadcast side effects (audit log, stage derivation,
  // web-push / email dispatch) still run.
  suppressInternalBroadcast?: boolean;
}

export interface UpdateResult {
  updated: boolean;                    // false if no fields differed from current
  stageChanged: boolean;
  flagChanged: boolean;
  newStage: number;
  newFlag: IssueFlag;
  changedFields: string[];             // names of fields whose values actually changed
}

/**
 * Update a participant, re-derive stage + flag, write the audit log.
 * Returns a summary of what changed. Callers use `stageChanged`/`flagChanged`
 * to decide whether to dispatch a notification (e.g. CLICKED_NOT_REGISTERED).
 *
 * Design notes:
 * - Reads the current row first so we can diff and audit accurately. One
 *   extra SELECT per write — acceptable at pilot scale (dozens of writes/day).
 * - We never write to lastActivityAt directly here — it's derived from the
 *   fact that a mutation happened. If the caller wants to record activity
 *   without mutating (rare), they can pass an empty `updates` object.
 * - versionVerified transitions to "verified" auto-set versionVerifiedAt if
 *   the caller didn't pass one. Same for the analogous timestamp fields on
 *   the participant-declared booleans (invitationAcceptedAt, appUpdatedAt).
 *   Timestamp fields are still overridable by explicit updates.
 */
export async function updateParticipant(
  participantId: string,
  updates: ParticipantUpdate,
  options: UpdateOptions,
): Promise<UpdateResult> {
  // Load current + project (for state-machine context).
  const [current] = await db
    .select()
    .from(pilotParticipants)
    .where(eq(pilotParticipants.id, participantId))
    .limit(1);
  if (!current) throw new Error(`Participant ${participantId} not found`);

  const [project] = await db
    .select({
      blockedEmailDomains: pilotProjects.blockedEmailDomains,
      staleThresholdDays: pilotProjects.staleThresholdDays,
      internalBetaRequired: pilotProjects.internalBetaRequired,
      targetAppVersion: pilotProjects.targetAppVersion,
    })
    .from(pilotProjects)
    .where(eq(pilotProjects.id, current.projectId))
    .limit(1);

  // Auto-timestamp bookkeeping — set matching *At field when the boolean
  // flips true and the caller didn't override the timestamp. Doesn't fire
  // when the boolean stays true or flips false.
  const now = new Date().toISOString();
  const finalUpdates = { ...updates } as ParticipantUpdate;
  autoStamp(finalUpdates, current, "invitationAcceptedDeclared", "invitationAcceptedAt", now);
  autoStamp(finalUpdates, current, "appUpdatedDeclared", "appUpdatedAt", now);
  autoStamp(finalUpdates, current, "mobileConfirmed", "mobileConfirmedAt", now);
  autoStamp(finalUpdates, current, "betaRegistered", "betaRegisteredAt", now);
  autoStamp(finalUpdates, current, "emailConfirmedIsPlaystore", "emailCapturedAt", now);
  autoStamp(finalUpdates, current, "workEmailConfirmed", "workEmailConfirmedAt", now);
  autoStamp(finalUpdates, current, "versionConfirmedByUser", "versionConfirmedByUserAt", now);

  // CST-side blocker resolution — the caller passes {contactCorrectionResolved:
  // true} (or the email variant); we translate that into the persisted
  // *ResolvedAt / *ResolvedBy columns. Passing false clears the resolution
  // so the blocker re-appears (rare, but supported).
  if (finalUpdates.contactCorrectionResolved !== undefined) {
    if (finalUpdates.contactCorrectionResolved) {
      finalUpdates.contactCorrectionResolvedAt = now;
      finalUpdates.contactCorrectionResolvedBy = options.actorUserId ?? null;
    } else {
      finalUpdates.contactCorrectionResolvedAt = null;
      finalUpdates.contactCorrectionResolvedBy = null;
    }
    delete (finalUpdates as any).contactCorrectionResolved;
  }
  if (finalUpdates.emailCorrectionResolved !== undefined) {
    if (finalUpdates.emailCorrectionResolved) {
      finalUpdates.emailCorrectionResolvedAt = now;
      finalUpdates.emailCorrectionResolvedBy = options.actorUserId ?? null;
    } else {
      finalUpdates.emailCorrectionResolvedAt = null;
      finalUpdates.emailCorrectionResolvedBy = null;
    }
    delete (finalUpdates as any).emailCorrectionResolved;
  }
  // Auto-verify on user confirmation. If the participant taps "Yes, I'm on
  // {target}" on Screen F and the target version is set on the project,
  // stamp reportedVersion + flip versionVerified to 'verified' in one go.
  // CST can revert this from the roster drawer if the user turns out to
  // have lied — see updateParticipant options for the revert path.
  if (
    finalUpdates.versionConfirmedByUser === true &&
    !current.versionConfirmedByUser &&
    finalUpdates.versionVerified === undefined
  ) {
    finalUpdates.versionVerified = "verified";
    if (finalUpdates.reportedVersion === undefined) {
      // Target version comes from the project — capture it here so audit
      // history shows exactly what the participant confirmed.
      const target = (project as any)?.targetAppVersion;
      if (target) finalUpdates.reportedVersion = target;
    }
  }
  // versionScreenshotDriveId is a value-not-bool but same logic: setting it
  // from empty to a value → stamp the uploaded-at field.
  if (
    finalUpdates.versionScreenshotDriveId !== undefined &&
    finalUpdates.versionScreenshotDriveId &&
    !current.versionScreenshotDriveId &&
    finalUpdates.versionScreenshotUploadedAt === undefined
  ) {
    finalUpdates.versionScreenshotUploadedAt = now;
  }
  // If a participant makes a fresh correction (mobile / work email /
  // playstore email) via the portal AFTER CST already resolved a prior
  // one, the resolution has to reset — otherwise the blocker count would
  // stay wrongly at zero while a new correction sits unaddressed.
  // Only fire when the actor is the participant (a CST edit is not the
  // participant "again correcting themselves").
  if (options.actor === "participant") {
    const contactChanged =
      (finalUpdates.mobileNumberCorrected !== undefined &&
        finalUpdates.mobileNumberCorrected !== current.mobileNumberCorrected) ||
      (finalUpdates.workEmail !== undefined &&
        finalUpdates.workEmail !== current.workEmail);
    if (contactChanged && current.contactCorrectionResolvedAt) {
      finalUpdates.contactCorrectionResolvedAt = null;
      finalUpdates.contactCorrectionResolvedBy = null;
    }
    const emailChanged =
      finalUpdates.playstoreEmail !== undefined &&
      finalUpdates.playstoreEmail !== current.playstoreEmail;
    if (emailChanged && current.emailCorrectionResolvedAt) {
      finalUpdates.emailCorrectionResolvedAt = null;
      finalUpdates.emailCorrectionResolvedBy = null;
    }
  }

  // versionVerified transitioning into verified/mismatch → stamp
  if (
    finalUpdates.versionVerified !== undefined &&
    finalUpdates.versionVerified !== "pending" &&
    current.versionVerified !== finalUpdates.versionVerified &&
    finalUpdates.versionVerifiedAt === undefined
  ) {
    finalUpdates.versionVerifiedAt = now;
  }

  // Diff — which fields actually changed?
  const changedFields: string[] = [];
  const changeLogRows: Array<{
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }> = [];
  for (const [key, newVal] of Object.entries(finalUpdates)) {
    if (newVal === undefined) continue;
    const oldVal = (current as any)[key];
    // Boolean-vs-int coerce: SQLite booleans come back as 0/1 numbers.
    const oldNorm = typeof oldVal === "boolean" ? Boolean(oldVal) : oldVal;
    const newNorm = typeof newVal === "boolean" ? Boolean(newVal) : newVal;
    if (oldNorm === newNorm) continue;
    changedFields.push(key);
    changeLogRows.push({
      field: key,
      oldValue: oldVal === null || oldVal === undefined ? null : String(oldVal),
      newValue: newVal === null ? null : String(newVal),
    });
  }

  // Build the "next" participant state for stage/flag derivation.
  const next = { ...current, ...finalUpdates };
  // Compute the "unresolved correction" flags for Stage-7 gating. Only
  // relevant when the participant is at Stage 6 semantically — for
  // earlier stages the derivation ignores these inputs. Read the
  // change log for correction events, then compare against the current
  // resolution timestamp.
  const nextContactResolvedAt = (next as any).contactCorrectionResolvedAt as string | null | undefined;
  const nextEmailResolvedAt = (next as any).emailCorrectionResolvedAt as string | null | undefined;
  let hasUnresolvedContactCorrection = false;
  let hasUnresolvedEmailCorrection = false;
  if (next.versionVerified === "verified" && !nextContactResolvedAt) {
    const rows = await db
      .select({ id: pilotChangeLog.id })
      .from(pilotChangeLog)
      .where(
        and(
          eq(pilotChangeLog.participantId, participantId),
          eq(pilotChangeLog.actor, "participant"),
          or(
            eq(pilotChangeLog.field, "mobileNumberCorrected"),
            eq(pilotChangeLog.field, "workEmail"),
          )!,
        ),
      )
      .limit(1);
    hasUnresolvedContactCorrection = rows.length > 0;
  }
  if (next.versionVerified === "verified" && !nextEmailResolvedAt) {
    const rows = await db
      .select({ id: pilotChangeLog.id })
      .from(pilotChangeLog)
      .where(
        and(
          eq(pilotChangeLog.participantId, participantId),
          eq(pilotChangeLog.actor, "participant"),
          eq(pilotChangeLog.field, "playstoreEmail"),
        ),
      )
      .limit(1);
    hasUnresolvedEmailCorrection = rows.length > 0;
  }

  const derived = computeStage(
    {
      playstoreEmail: next.playstoreEmail,
      emailConfirmedIsPlaystore: Boolean(next.emailConfirmedIsPlaystore),
      betaRegistered: Boolean(next.betaRegistered),
      invitationAcceptedDeclared: Boolean(next.invitationAcceptedDeclared),
      invitationLinkFailed: Boolean(next.invitationLinkFailed),
      appUpdatedDeclared: Boolean(next.appUpdatedDeclared),
      mobileConfirmed: Boolean(next.mobileConfirmed),
      workEmail: next.workEmail,
      workEmailConfirmed: Boolean(next.workEmailConfirmed),
      versionScreenshotDriveId: next.versionScreenshotDriveId,
      versionConfirmedByUser: Boolean(next.versionConfirmedByUser),
      versionVerified: next.versionVerified,
      contactCorrectionResolvedAt: nextContactResolvedAt ?? null,
      emailCorrectionResolvedAt: nextEmailResolvedAt ?? null,
      hasUnresolvedContactCorrection,
      hasUnresolvedEmailCorrection,
      lastActivityAt: now,  // treat "now" as the activity timestamp for STALE
    },
    {
      blockedEmailDomains: project?.blockedEmailDomains ?? null,
      staleThresholdDays: project?.staleThresholdDays ?? null,
      internalBetaRequired: project?.internalBetaRequired ?? true,
    },
  );

  const stageChanged = current.currentStage !== derived.stage;
  const flagChanged = current.issueFlag !== derived.issueFlag;
  if (stageChanged) {
    changeLogRows.push({
      field: "currentStage",
      oldValue: String(current.currentStage),
      newValue: String(derived.stage),
    });
  }
  if (flagChanged) {
    changeLogRows.push({
      field: "issueFlag",
      oldValue: current.issueFlag,
      newValue: derived.issueFlag,
    });
  }

  // If nothing to write, short-circuit — including no ChangeLog. Prevents
  // callers that repost the same values from polluting the audit.
  if (changeLogRows.length === 0) {
    return {
      updated: false,
      stageChanged: false,
      flagChanged: false,
      newStage: derived.stage,
      newFlag: derived.issueFlag,
      changedFields: [],
    };
  }

  // Persist the update (including derived stage + flag + activity bookkeeping).
  await db
    .update(pilotParticipants)
    .set({
      ...finalUpdates,
      currentStage: derived.stage,
      issueFlag: derived.issueFlag,
      lastActivityAt: now,
      lastActivityBy: options.actor,
      updatedAt: now,
    })
    .where(eq(pilotParticipants.id, participantId));

  // Audit log — one row per changed field.
  for (const row of changeLogRows) {
    await db.insert(pilotChangeLog).values({
      participantId,
      field: row.field,
      oldValue: row.oldValue,
      newValue: row.newValue,
      actor: options.actor,
      actorUserId: options.actorUserId ?? null,
      note: options.note ?? null,
    });
  }

  // Fire pilot notifications for the specific events CST cares about.
  // Fire-and-forget — never blocks the mutation response.
  fireEventNotifications(participantId, current, finalUpdates, derived, {
    suppressInternalBroadcast: options.suppressInternalBroadcast === true,
  }).catch(
    (e) => console.warn("[pilot/mutations] notify failed:", e),
  );

  return {
    updated: true,
    stageChanged,
    flagChanged,
    newStage: derived.stage,
    newFlag: derived.issueFlag,
    changedFields,
  };
}

/**
 * Dispatch pilot-issue notifications based on what changed. Import
 * lazily to avoid a circular dependency (notifications module reads
 * pilotParticipants + pilotProjects tables).
 */
async function fireEventNotifications(
  participantId: string,
  before: any,
  updates: ParticipantUpdate,
  derived: { stage: number; issueFlag: string },
  opts: { suppressInternalBroadcast: boolean } = { suppressInternalBroadcast: false },
): Promise<void> {
  const { notifyPilotEvent, broadcastPilotRegistrationRequest } = await import("./notifications");

  // Beta registration request — broadcast into every internal Telegram
  // channel so devs can add the email to the Play Console tester list.
  //
  // Fires in two cases:
  //   (a) transition INTO AWAITING_REGISTRATION (first time the participant
  //       captures a Play Store email + ticks confirm),
  //   (b) participant is ALREADY AWAITING_REGISTRATION and taps Update
  //       again with a DIFFERENT email — treat that as a fresh event so
  //       devs see the corrected value.
  //
  // Same email + Update = no-op (nothing changed in changedFields).
  const transitionedIntoAwaiting =
    derived.issueFlag === "AWAITING_REGISTRATION" &&
    before.issueFlag !== "AWAITING_REGISTRATION";
  const emailChangedWhileAwaiting =
    derived.issueFlag === "AWAITING_REGISTRATION" &&
    before.issueFlag === "AWAITING_REGISTRATION" &&
    updates.playstoreEmail !== undefined &&
    updates.playstoreEmail !== before.playstoreEmail &&
    !!updates.playstoreEmail;
  if (transitionedIntoAwaiting || emailChangedWhileAwaiting) {
    // Load the client company name for the message context. Optional — if
    // the join fails, we still send the message with just employeeId/name.
    let clientCompanyName: string | null = null;
    try {
      const { db } = await import("@/db");
      const { pilotProjects, clientProfiles } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({ companyName: clientProfiles.companyName })
        .from(pilotProjects)
        .leftJoin(clientProfiles, eq(clientProfiles.id, pilotProjects.clientProfileId))
        .where(eq(pilotProjects.id, before.projectId))
        .limit(1);
      clientCompanyName = rows[0]?.companyName || null;
    } catch {}

    const email =
      updates.playstoreEmail !== undefined
        ? updates.playstoreEmail
        : before.playstoreEmail;
    if (email && !opts.suppressInternalBroadcast) {
      broadcastPilotRegistrationRequest({
        participantId,
        fullName: before.fullName,
        employeeId: before.employeeId,
        playstoreEmail: email,
        clientCompanyName,
      }).catch((e) =>
        console.warn("[pilot/mutations] internal broadcast failed:", e),
      );
    }
  }

  // Mobile corrected — only fire when the corrected number actually changes.
  if (
    updates.mobileNumberCorrected !== undefined &&
    updates.mobileNumberCorrected &&
    updates.mobileNumberCorrected !== before.mobileNumberCorrected
  ) {
    await notifyPilotEvent({
      participantId,
      event: "mobile_corrected",
      title: `Mobile corrected: ${before.fullName}`,
      body: `Was: ${before.mobileNumber} → Now: ${updates.mobileNumberCorrected}`,
    });
  }

  // Contradiction — participant claims accepted, but not registered.
  // Only fire on the transition INTO the contradiction (once), not every
  // subsequent update while the record is still in that state.
  if (
    derived.issueFlag === "CLICKED_NOT_REGISTERED" &&
    before.issueFlag !== "CLICKED_NOT_REGISTERED"
  ) {
    await notifyPilotEvent({
      participantId,
      event: "contradiction",
      title: `${before.fullName} says accepted, but not registered`,
      body: `${before.employeeId} — add ${before.playstoreEmail || "their email"} to the Play tester list.`,
    });
  }

  // Screenshot uploaded — landed in review queue (or auto-verified below).
  if (
    updates.versionScreenshotDriveId !== undefined &&
    updates.versionScreenshotDriveId &&
    !before.versionScreenshotDriveId
  ) {
    await notifyPilotEvent({
      participantId,
      event: "screenshot_uploaded",
      title: `Screenshot to review: ${before.fullName}`,
      body: `${before.employeeId} uploaded a version screenshot for verification.`,
    });
  }
}

/**
 * Fill in a timestamp field when a boolean field flips false → true and
 * the caller hasn't set the timestamp explicitly. Mutates `updates` in
 * place. Safe to call for a bool that isn't being updated (no-op).
 */
function autoStamp<T extends ParticipantUpdate>(
  updates: T,
  current: Record<string, any>,
  boolField: keyof T,
  timestampField: keyof T,
  now: string,
): void {
  const nextBool = updates[boolField];
  if (nextBool !== true) return;
  const oldBool = Boolean(current[boolField as string]);
  if (oldBool === true) return;
  if (updates[timestampField] !== undefined) return;
  (updates as any)[timestampField] = now;
}
