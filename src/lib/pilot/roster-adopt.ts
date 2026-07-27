/**
 * Pilot Tracker — adopt the roster Sheet into the database.
 *
 * Two-phase, mirroring the XLSX import: previewAdopt() computes a diff and
 * writes nothing; applyAdopt() executes a previously-previewed plan. The
 * CST always sees exactly what will happen before it happens.
 *
 * ── The rules, and why ────────────────────────────────────────────────
 *
 * 1. Blank never overwrites. An admin leaving a cell empty means "I don't
 *    know", not "clear this". Without this rule a half-filled sheet would
 *    wipe data the portal had already captured.
 *
 * 2. The participant wins on their own contact details. If someone has
 *    personally corrected their Play Store email / mobile / work email via
 *    the portal, a conflicting sheet value is SKIPPED, not applied. They
 *    are the better authority on their own Google account, and silently
 *    reverting their correction would send dev to register an address that
 *    the participant already told us was wrong. Detected from the change
 *    log (actor='participant'), the same signal the blocker counts use.
 *
 * 3. Creates are surfaced separately and never implicit. The real risk of
 *    allowing creation isn't creation, it's creation BY ACCIDENT: a
 *    fat-fingered employee ID silently becomes a second, half-populated
 *    person while the row it was meant to update goes untouched. So new
 *    rows are counted apart from updates, require their own confirmation,
 *    and any ID within edit distance 2 of an existing one is reported as a
 *    probable typo rather than a new hire.
 *
 * 4. Never delete. A row vanishing from the sheet must not remove anyone —
 *    far too easy to do by accident with a filtered view or a stray row
 *    delete, and unrecoverable in a way that a duplicate isn't. Removals
 *    stay a deliberate action in the roster grid.
 */
import { db } from "@/db";
import { pilotChangeLog, pilotParticipants, pilotProjects } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { updateParticipant } from "./participant-mutations";
import { normalizeMobilePH } from "./bulk-import";
import { readSheet } from "./roster-sheet";

/** Fields an admin may set from the sheet. Nothing else is ever adopted. */
const ADMIN_FIELDS = [
  "fullName",
  "mobileNumber",
  "workEmail",
  "playstoreEmail",
  "custom1",
  "custom2",
] as const;

/** Contact fields the participant can also change from the portal. Rule 2. */
const PARTICIPANT_OWNED = new Set(["playstoreEmail", "workEmail", "mobileNumber"]);

export type RowAction = "update" | "create" | "unchanged" | "conflict" | "error";

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface PreviewRow {
  rowNumber: number;
  employeeId: string;
  fullName: string;
  action: RowAction;
  /** Field-level changes that WILL be applied. */
  changes: FieldChange[];
  /** Changes deliberately NOT applied, with the reason. */
  skipped: Array<{ field: string; reason: string }>;
  message?: string;
  /** Set on `create` rows whose ID looks like a typo of an existing one. */
  possibleTypoOf?: string;
  participantId?: string;
}

export interface AdoptPreview {
  rows: PreviewRow[];
  counts: {
    update: number;
    create: number;
    unchanged: number;
    conflict: number;
    error: number;
  };
  /** How many participants would newly gain a Play Store email — the size
   *  of the registration batch the lock digest will announce. */
  newRegistrationEmails: number;
}

/** Levenshtein distance, capped for early exit. Only used on short IDs. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * Compute the adopt plan. Pure read — never writes.
 *
 * `rows` is injectable so the diff rules can be exercised against known
 * inputs without a live spreadsheet; production callers omit it and the
 * rows are read from the project's Sheet.
 */
export async function previewAdopt(
  projectId: string,
  rows?: Array<{ rowNumber: number; values: Record<string, string> }>,
): Promise<AdoptPreview> {
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(eq(pilotProjects.id, projectId))
    .limit(1);
  if (!project) throw new Error("Pilot project not found");

  const sheetRows = rows ?? (await readSheet(projectId));
  const existing = await db
    .select()
    .from(pilotParticipants)
    .where(eq(pilotParticipants.projectId, projectId));

  const byEmpId = new Map<string, any>();
  for (const p of existing) byEmpId.set(String(p.employeeId).trim().toLowerCase(), p);
  const existingIds = existing.map((p: any) => String(p.employeeId).trim());

  // Which (participant, field) pairs has the participant personally
  // changed? One query for the whole project rather than per row.
  const participantEdited = new Set<string>();
  if (existing.length > 0) {
    const logs = await db
      .select({
        participantId: pilotChangeLog.participantId,
        field: pilotChangeLog.field,
      })
      .from(pilotChangeLog)
      .where(
        and(
          eq(pilotChangeLog.actor, "participant"),
          inArray(
            pilotChangeLog.participantId,
            existing.map((p: any) => p.id),
          ),
        ),
      );
    for (const l of logs) {
      participantEdited.add(`${l.participantId}::${l.field}`);
      // The portal writes corrected mobiles to mobileNumberCorrected, but
      // the sheet's column is mobileNumber. Treat them as the same claim.
      if (l.field === "mobileNumberCorrected") {
        participantEdited.add(`${l.participantId}::mobileNumber`);
      }
    }
  }

  const out: PreviewRow[] = [];
  const seenInSheet = new Set<string>();
  let newRegistrationEmails = 0;

  for (const sr of sheetRows) {
    const empId = (sr.values.employeeId || "").trim();
    const fullName = (sr.values.fullName || "").trim();
    if (!empId) {
      out.push({
        rowNumber: sr.rowNumber,
        employeeId: "",
        fullName,
        action: "error",
        changes: [],
        skipped: [],
        message: "No Employee ID — can't match or create this row.",
      });
      continue;
    }
    const key = empId.toLowerCase();
    if (seenInSheet.has(key)) {
      out.push({
        rowNumber: sr.rowNumber,
        employeeId: empId,
        fullName,
        action: "error",
        changes: [],
        skipped: [],
        message: `Duplicate Employee ID "${empId}" — appears more than once in the sheet.`,
      });
      continue;
    }
    seenInSheet.add(key);

    const current = byEmpId.get(key);

    // ── New participant ────────────────────────────────────────────
    if (!current) {
      const mobile = normalizeMobilePH(sr.values.mobileNumber || "");
      const problems: string[] = [];
      if (!fullName) problems.push("Full Name");
      if (!mobile) problems.push("a valid Mobile Number");
      // A row carrying only an email is nearly always a typo'd ID against
      // an existing person, not a new hire. Refuse rather than create.
      if (problems.length > 0) {
        out.push({
          rowNumber: sr.rowNumber,
          employeeId: empId,
          fullName,
          action: "error",
          changes: [],
          skipped: [],
          message: `Unknown Employee ID and missing ${problems.join(" + ")} — can't create this participant.`,
        });
        continue;
      }
      // Report the CLOSEST existing ID, not merely the first within
      // range. With IDs that share a prefix ("TARKIE-01", "TARKIE-06"),
      // first-match would name an arbitrary sibling and send the CST to
      // check the wrong person's record.
      let possibleTypoOf: string | undefined;
      let bestDistance = 3;
      for (const eid of existingIds) {
        const d = editDistance(empId.toLowerCase(), eid.toLowerCase());
        if (d < bestDistance) {
          bestDistance = d;
          possibleTypoOf = eid;
          if (d === 1) break;  // can't do better than one character off
        }
      }
      const changes: FieldChange[] = [];
      for (const f of ADMIN_FIELDS) {
        const v = (sr.values[f] || "").trim();
        if (!v) continue;
        changes.push({ field: f, from: "", to: f === "mobileNumber" ? mobile : v });
      }
      if ((sr.values.playstoreEmail || "").trim()) newRegistrationEmails++;
      out.push({
        rowNumber: sr.rowNumber,
        employeeId: empId,
        fullName,
        action: "create",
        changes,
        skipped: [],
        possibleTypoOf,
        message: possibleTypoOf
          ? `Looks like a typo of "${possibleTypoOf}" — check before creating a second person.`
          : undefined,
      });
      continue;
    }

    // ── Existing participant ───────────────────────────────────────
    const changes: FieldChange[] = [];
    const skipped: Array<{ field: string; reason: string }> = [];
    for (const f of ADMIN_FIELDS) {
      let v = (sr.values[f] || "").trim();
      if (!v) continue;  // Rule 1 — blank never overwrites.
      if (f === "mobileNumber") {
        const norm = normalizeMobilePH(v);
        if (!norm) {
          skipped.push({ field: f, reason: `"${v}" isn't a valid PH mobile number` });
          continue;
        }
        v = norm;
      }
      const currentVal = String(current[f] ?? "").trim();
      if (currentVal === v) continue;
      // Rule 2 — the participant's own correction outranks the sheet.
      if (
        PARTICIPANT_OWNED.has(f) &&
        participantEdited.has(`${current.id}::${f}`)
      ) {
        skipped.push({
          field: f,
          reason: `participant set this themselves in the portal — keeping "${currentVal || "(blank)"}"`,
        });
        continue;
      }
      changes.push({ field: f, from: currentVal, to: v });
    }

    if (changes.length === 0) {
      out.push({
        rowNumber: sr.rowNumber,
        employeeId: empId,
        fullName: current.fullName,
        action: skipped.length > 0 ? "conflict" : "unchanged",
        changes: [],
        skipped,
        participantId: current.id,
      });
      continue;
    }
    if (changes.some((c) => c.field === "playstoreEmail") && !current.playstoreEmail) {
      newRegistrationEmails++;
    }
    out.push({
      rowNumber: sr.rowNumber,
      employeeId: empId,
      fullName: current.fullName,
      action: "update",
      changes,
      skipped,
      participantId: current.id,
    });
  }

  const counts = { update: 0, create: 0, unchanged: 0, conflict: 0, error: 0 };
  for (const r of out) counts[r.action]++;
  return { rows: out, counts, newRegistrationEmails };
}

export interface ApplyResult {
  updated: number;
  created: number;
  skipped: number;
  failed: number;
  /** Participants now awaiting Play tester registration, for the digest. */
  pendingRegistration: Array<{
    participantId: string;
    employeeId: string;
    fullName: string;
    playstoreEmail: string;
  }>;
  errors: Array<{ rowNumber: number; employeeId: string; message: string }>;
}

/**
 * Execute the adopt.
 *
 * Every write goes through updateParticipant() so stage derivation and the
 * audit log stay correct — but with broadcasts suppressed, because the
 * caller emits ONE digest afterwards instead of up to N per-row messages.
 * That suppression is the entire reason the collection window exists.
 *
 * `allowCreate` is passed explicitly by the caller from a separate
 * confirmation, so creating people can never be a side effect of
 * approving a batch of updates.
 */
export async function applyAdopt(args: {
  projectId: string;
  actorUserId: string;
  allowCreate: boolean;
}): Promise<ApplyResult> {
  const { projectId, actorUserId, allowCreate } = args;
  const preview = await previewAdopt(projectId);
  const result: ApplyResult = {
    updated: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    pendingRegistration: [],
    errors: [],
  };

  for (const row of preview.rows) {
    if (row.action === "unchanged" || row.action === "conflict") {
      result.skipped++;
      continue;
    }
    if (row.action === "error") {
      result.failed++;
      result.errors.push({
        rowNumber: row.rowNumber,
        employeeId: row.employeeId,
        message: row.message || "Invalid row",
      });
      continue;
    }

    if (row.action === "create") {
      if (!allowCreate) {
        result.skipped++;
        continue;
      }
      try {
        const values: Record<string, any> = {
          projectId,
          employeeId: row.employeeId,
        };
        for (const c of row.changes) values[c.field] = c.to;
        if (!values.fullName) values.fullName = row.employeeId;
        const [inserted] = await db
          .insert(pilotParticipants)
          .values(values as any)
          .returning({ id: pilotParticipants.id });
        result.created++;
        // Re-run the state machine so a participant created WITH an email
        // lands on Stage 1 rather than sitting at 0 until their next
        // mutation. Empty update = derive-only; broadcasts suppressed.
        if (inserted?.id) {
          await updateParticipant(inserted.id, {}, {
            actor: "cst",
            actorUserId,
            note: "Created from roster Sheet adopt",
            suppressInternalBroadcast: true,
          });
          if (values.playstoreEmail) {
            result.pendingRegistration.push({
              participantId: inserted.id,
              employeeId: row.employeeId,
              fullName: values.fullName,
              playstoreEmail: values.playstoreEmail,
            });
          }
        }
      } catch (e: any) {
        result.failed++;
        result.errors.push({
          rowNumber: row.rowNumber,
          employeeId: row.employeeId,
          message: e?.message || "Insert failed",
        });
      }
      continue;
    }

    // update
    try {
      const updates: Record<string, any> = {};
      for (const c of row.changes) updates[c.field] = c.to;
      // An admin supplying a Play Store email is asserting it's the
      // participant's Google account — the same claim Screen B captures.
      // Without this the row would sit at Stage 0 and never reach the
      // registration list, which is the whole point of the exercise.
      if (updates.playstoreEmail) updates.emailConfirmedIsPlaystore = true;
      await updateParticipant(row.participantId!, updates, {
        actor: "cst",
        actorUserId,
        note: "Roster Sheet adopt",
        suppressInternalBroadcast: true,
      });
      result.updated++;
      if (updates.playstoreEmail) {
        result.pendingRegistration.push({
          participantId: row.participantId!,
          employeeId: row.employeeId,
          fullName: row.fullName,
          playstoreEmail: updates.playstoreEmail,
        });
      }
    } catch (e: any) {
      result.failed++;
      result.errors.push({
        rowNumber: row.rowNumber,
        employeeId: row.employeeId,
        message: e?.message || "Update failed",
      });
    }
  }

  return result;
}
