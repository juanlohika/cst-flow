/**
 * Pilot Tracker — XLSX roster import.
 *
 * Two-step flow (matches the existing accounts/bulk-import.ts pattern):
 *   1. validateWorkbook(buffer) — parses the XLSX, returns per-row
 *      {status: ok|warn|error, message} report. No DB writes.
 *   2. applyValidated(projectId, rows, uploaderId) — inserts / updates
 *      participants for rows that passed validation.
 *
 * Template (single sheet named "Roster" — falls back to first sheet):
 *   Column A: Employee ID (required, unique-within-project match key)
 *   Column B: Full Name    (required, display only)
 *   Column C: Mobile Number (required, digits only in normalized form)
 *
 * On apply, we upsert by (projectId, employeeId) — re-uploading the same
 * spreadsheet is idempotent and safe. Existing participants with new data
 * are updated (name / mobile can change over the pilot's life). Stage
 * derivation happens automatically via updateParticipant().
 */
import * as XLSX from "xlsx";
import crypto from "crypto";
import { db } from "@/db";
import { pilotParticipants, pilotUploadBatches } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { updateParticipant } from "./participant-mutations";

export type RowStatus = "ok" | "warn" | "error";

export interface ParsedRow {
  rowNumber: number;          // 1-indexed (matches Excel row number)
  employeeId?: string;
  fullName?: string;
  mobileNumber?: string;
  // Two distinct emails. Different purposes:
  //   workEmail       — admin/control-tower identity. Optional in the roster.
  //   playstoreEmail  — the Google account participant uses on Play Store.
  //                     Optional at import; usually captured on Screen B.
  workEmail?: string;
  playstoreEmail?: string;
  status: RowStatus;
  message?: string;
}

export interface ValidationReport {
  rows: ParsedRow[];
  totalRows: number;
  okRows: number;
  warnRows: number;
  errorRows: number;
}

/**
 * Parse and validate an XLSX buffer. Never touches the DB.
 * Returns a report the admin previews before applying.
 */
export function validateWorkbook(buffer: Buffer): ValidationReport {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "roster") ||
    wb.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      totalRows: 0,
      okRows: 0,
      warnRows: 0,
      errorRows: 0,
    };
  }
  const sheet = wb.Sheets[sheetName];
  // Header expected on row 1. Convert to array-of-objects keyed on our
  // canonical field names — we accept a couple of column-header spellings
  // for resilience.
  const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const rows: ParsedRow[] = [];
  const seenIds = new Set<string>();
  // Sequential counter for participants missing an Emp ID entirely — we
  // synthesize NO-ID-1, NO-ID-2… so the roster still imports and the admin
  // can fix the ID later without losing the row.
  let missingIdCounter = 0;

  raw.forEach((r, idx) => {
    const rowNumber = idx + 2; // header is row 1
    let employeeId = readField(r, [
      "Employee ID", "Emp ID", "employeeId", "emp_id", "ID", "EmpID",
    ]);
    let fullName = readField(r, [
      "Full Name", "Name", "fullName", "name",
    ]);
    const mobileNumberRaw = readField(r, [
      "Mobile Number", "Mobile", "mobileNumber", "mobile", "Phone",
    ]);
    // Two email columns in the new template. Legacy "Email" / "Email Address"
    // headers are treated as WORK email (that's what CST already ships in
    // existing rosters, and it's the primary admin identifier now).
    const workEmail = readField(r, [
      "Work Email", "workEmail",
      "Email Address", "Email", "email",
    ]);
    const playstoreEmail = readField(r, [
      "Play Store Email", "playstoreEmail", "Google Play Email",
    ]);

    // Silently skip completely empty rows. Excel commonly saves sheets with
    // a used-range that extends thousands of rows past the last real cell,
    // and sheet_to_json walks the full range. Without this filter a user
    // uploads 5 real rows and sees 12,000 "Employee ID is required" errors.
    if (!employeeId && !fullName && !mobileNumberRaw && !workEmail && !playstoreEmail) return;

    // Silently skip the template's notes/guide row (row 3). Detected by
    // the "(required" marker in any field.
    const looksLikeNotesRow = [employeeId, fullName, mobileNumberRaw, workEmail, playstoreEmail].some(
      (v) => v.trim().toLowerCase().startsWith("(required") || v.trim().toLowerCase().startsWith("(optional"),
    );
    if (looksLikeNotesRow) return;

    // Silently skip the template's example row. Very narrow match — Emp ID
    // "EMP-001" + name "Juan Dela Cruz" + example mobile.
    if (
      employeeId === "EMP-001" &&
      fullName === "Juan Dela Cruz" &&
      normalizeMobile(mobileNumberRaw) === "639171234567"
    ) {
      return;
    }

    // Emp ID fallback #1: numeric prefix bleeding into Full Name column.
    // Excel commonly does this when column A is blank — the number lands
    // in column B. Example: Emp ID: "" / Name: "1 TARKIE, ABI"
    //   → Emp ID: "1", Name: "TARKIE, ABI"
    if (!employeeId && fullName) {
      const m = fullName.match(/^(\d+)\s+(.+)$/);
      if (m) {
        employeeId = m[1];
        fullName = m[2].trim();
      }
    }

    // Emp ID fallback #2: no ID at all — synthesize NO-ID-N and flag as
    // warn so the row still imports and the admin can fix it later.
    let missingIdSynthesized = false;
    if (!employeeId) {
      missingIdCounter++;
      employeeId = `NO-ID-${missingIdCounter}`;
      missingIdSynthesized = true;
    }

    // Required-field checks — after fallbacks
    if (!fullName) {
      rows.push({ rowNumber, employeeId, status: "error", message: "Full Name is required" });
      return;
    }
    if (!mobileNumberRaw) {
      rows.push({
        rowNumber, employeeId, fullName, workEmail, playstoreEmail,
        status: "error", message: "Mobile Number is required",
      });
      return;
    }

    // Normalize mobile to canonical E.164-ish form: strip everything
    // non-digit, then coerce to 639… (PH country prefix). We accept:
    //   09171234567  → 639171234567
    //    9171234567  → 639171234567
    //   639171234567 → 639171234567 (unchanged)
    //  +639171234567 → 639171234567
    //   (0917) 123-4567 → 639171234567
    const normalizedMobile = normalizeMobilePH(mobileNumberRaw);
    if (!normalizedMobile) {
      rows.push({
        rowNumber, employeeId, fullName,
        mobileNumber: mobileNumberRaw, playstoreEmail,
        status: "error",
        message: `Mobile "${mobileNumberRaw}" isn't a recognizable PH number`,
      });
      return;
    }

    // Basic email sanity — warn on malformed, accept empty (both emails
    // are optional at import).
    const emailWarnings: string[] = [];
    const isValidEmail = (v: string) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    if (workEmail && !isValidEmail(workEmail)) {
      emailWarnings.push(`Work Email "${workEmail}" looks malformed`);
    }
    if (playstoreEmail && !isValidEmail(playstoreEmail)) {
      emailWarnings.push(`Play Store Email "${playstoreEmail}" looks malformed`);
    }

    // Duplicate check within the same upload
    if (seenIds.has(employeeId)) {
      rows.push({
        rowNumber, employeeId, fullName,
        mobileNumber: normalizedMobile, workEmail, playstoreEmail,
        status: "error",
        message: `Employee ID "${employeeId}" appears more than once in this file`,
      });
      return;
    }
    seenIds.add(employeeId);

    // Assemble any warnings
    const warnings: string[] = [];
    if (missingIdSynthesized) warnings.push(`Emp ID was blank — assigned "${employeeId}" placeholder`);
    warnings.push(...emailWarnings);

    rows.push({
      rowNumber, employeeId, fullName,
      mobileNumber: normalizedMobile, workEmail, playstoreEmail,
      status: warnings.length ? "warn" : "ok",
      message: warnings.join("; ") || undefined,
    });
  });

  return {
    rows,
    totalRows: rows.length,
    okRows: rows.filter((r) => r.status === "ok").length,
    warnRows: rows.filter((r) => r.status === "warn").length,
    errorRows: rows.filter((r) => r.status === "error").length,
  };
}

/**
 * Apply a validated report to a project's roster. Only `ok` and `warn`
 * rows are written. `error` rows are skipped. Existing participants
 * (matched on employeeId within project) are updated with new name /
 * mobile; new ones are inserted.
 *
 * Returns applied / rejected counts + writes a PilotUploadBatch audit row.
 */
export async function applyValidated(args: {
  projectId: string;
  rows: ParsedRow[];
  uploadedBy: string;
  filename?: string;
}): Promise<{
  applied: number;
  rejected: number;
  inserted: number;
  updated: number;
  batchId: string;
}> {
  const { projectId, rows, uploadedBy, filename } = args;
  const applicable = rows.filter((r) => r.status === "ok" || r.status === "warn");

  // Load existing participants for the project so we can upsert without
  // extra round-trips per row.
  const existing = await db
    .select({ id: pilotParticipants.id, employeeId: pilotParticipants.employeeId })
    .from(pilotParticipants)
    .where(eq(pilotParticipants.projectId, projectId));
  const idByEmp = new Map(existing.map((r) => [r.employeeId, r.id]));

  let inserted = 0;
  let updated = 0;
  // Accumulate participants that transition INTO the AWAITING_REGISTRATION
  // state during this import so we can fire a single digest broadcast at
  // the end (avoids 75 individual Telegram messages for a 75-row XLSX).
  const digestEntries: Array<{
    participantId: string;
    fullName: string;
    employeeId: string;
    playstoreEmail: string;
  }> = [];

  for (const row of applicable) {
    if (!row.employeeId || !row.fullName || !row.mobileNumber) continue;
    const existingId = idByEmp.get(row.employeeId);
    if (existingId) {
      // Update the display fields via a raw update (updateParticipant()
      // is designed for state-machine fields; these are import-side
      // fields that don't affect stage). Kept minimal.
      const patch: Record<string, unknown> = {
        fullName: row.fullName,
        mobileNumber: row.mobileNumber,
        updatedAt: new Date().toISOString(),
      };
      // Only overwrite emails if the roster shipped a value — never erase
      // a self-declared email during re-import.
      if (row.playstoreEmail) patch.playstoreEmail = row.playstoreEmail;
      if (row.workEmail) patch.workEmail = row.workEmail;
      await db
        .update(pilotParticipants)
        .set(patch)
        .where(eq(pilotParticipants.id, existingId));
      updated++;
      // Re-import with a Play Store email: if the participant had no
      // confirmed email yet, treat the shipped value as pre-confirmed and
      // flip the state-machine flag. Per-participant broadcasts are
      // suppressed here — the digest fires once at the end.
      if (row.playstoreEmail) {
        try {
          const result = await updateParticipant(
            existingId,
            {
              playstoreEmail: row.playstoreEmail,
              emailConfirmedIsPlaystore: true,
            },
            {
              actor: "cst",
              actorUserId: uploadedBy,
              note: `Roster re-import (batch ${filename || "unnamed"}) — pre-confirmed Play Store email`,
              suppressInternalBroadcast: true,
            },
          );
          // Only include in the digest if this participant actually
          // transitioned into AWAITING_REGISTRATION on this call.
          if (result.newFlag === "AWAITING_REGISTRATION" && result.flagChanged) {
            digestEntries.push({
              participantId: existingId,
              fullName: row.fullName,
              employeeId: row.employeeId,
              playstoreEmail: row.playstoreEmail,
            });
          }
        } catch (e) {
          console.warn("[pilot/import] re-confirm on re-import failed:", e);
        }
      }
    } else {
      // Insert first so we have an id, then route the "email captured"
      // state through updateParticipant() so the state machine re-derives
      // AWAITING_REGISTRATION and the internal-channel broadcast fires.
      const newId = crypto.randomUUID();
      await db.insert(pilotParticipants).values({
        id: newId,
        projectId,
        employeeId: row.employeeId,
        fullName: row.fullName,
        mobileNumber: row.mobileNumber,
        workEmail: row.workEmail || null,
        // playstoreEmail is set through updateParticipant() below so it
        // routes through the state-machine + broadcast path uniformly.
        playstoreEmail: null,
        lastActivityBy: "cst",
      });
      inserted++;
      if (row.playstoreEmail) {
        try {
          const result = await updateParticipant(
            newId,
            {
              playstoreEmail: row.playstoreEmail,
              // Roster-supplied email is CST-verified — Step 1 is
              // considered already captured, and the participant lands
              // directly on Step 2 in the portal.
              emailConfirmedIsPlaystore: true,
            },
            {
              actor: "cst",
              actorUserId: uploadedBy,
              note: `Roster import (batch ${filename || "unnamed"}) — pre-confirmed Play Store email`,
              suppressInternalBroadcast: true,
            },
          );
          if (result.newFlag === "AWAITING_REGISTRATION" && result.flagChanged) {
            digestEntries.push({
              participantId: newId,
              fullName: row.fullName,
              employeeId: row.employeeId,
              playstoreEmail: row.playstoreEmail,
            });
          }
        } catch (e) {
          console.warn("[pilot/import] pre-confirm on insert failed:", e);
        }
      }
    }
  }

  // Emit one digest broadcast for the entire batch. Fire-and-forget —
  // never blocks the API response.
  if (digestEntries.length > 0) {
    try {
      // Resolve client company name for the digest header. Optional.
      let clientCompanyName: string | null = null;
      try {
        const { pilotProjects, clientProfiles } = await import("@/db/schema");
        const rows = await db
          .select({ companyName: clientProfiles.companyName })
          .from(pilotProjects)
          .leftJoin(clientProfiles, eq(clientProfiles.id, pilotProjects.clientProfileId))
          .where(eq(pilotProjects.id, projectId))
          .limit(1);
        clientCompanyName = rows[0]?.companyName || null;
      } catch {}
      const { broadcastPilotRegistrationDigest } = await import("./notifications");
      broadcastPilotRegistrationDigest({
        entries: digestEntries,
        clientCompanyName,
        source: "roster-import",
      }).catch((e) =>
        console.warn("[pilot/import] digest broadcast failed:", e),
      );
    } catch (e) {
      console.warn("[pilot/import] digest broadcast setup failed:", e);
    }
  }

  const batch = {
    projectId,
    uploadedBy,
    filename: filename || null,
    totalRows: rows.length,
    appliedRows: inserted + updated,
    rejectedRows: rows.length - (inserted + updated),
    validationReport: JSON.stringify(rows),
    status: "applied",
  };
  const [inserted_] = await db
    .insert(pilotUploadBatches)
    .values(batch as any)
    .returning({ id: pilotUploadBatches.id });

  return {
    applied: inserted + updated,
    rejected: rows.length - (inserted + updated),
    inserted,
    updated,
    batchId: inserted_.id,
  };
}

/**
 * Generate the downloadable template as an XLSX buffer. One sheet
 * "Roster" with header row + one example row + a notes row.
 *
 * Mobile is shown in 639… form intentionally — Excel strips leading zeros
 * from 09… numbers if the cell isn't pre-formatted as text, which broke
 * previous imports.
 */
export function generateTemplate(): Buffer {
  const headers = [
    "Employee ID",
    "Full Name",
    "Mobile Number",
    "Work Email",
    "Play Store Email",
  ];
  const example = [
    "EMP-001",
    "Juan Dela Cruz",
    "639171234567",
    "juan@acme.com",
    "juan.tester@gmail.com",
  ];
  const notes = [
    "(required; must be unique within this pilot)",
    "(required)",
    "(required; use 639XXXXXXXXX to survive Excel's leading-zero eat — 09/+639/9 forms also OK)",
    "(optional; work email for admins who sign in to the control tower — OTPs go here for them)",
    "(optional; the Google account used on Play Store — participant can correct on the portal)",
  ];
  const aoa = [headers, example, notes];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 20 }, { wch: 30 }, { wch: 20 }, { wch: 30 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Roster");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** Read a field from a row object, trying multiple header spellings. */
function readField(row: Record<string, any>, candidates: string[]): string {
  for (const c of candidates) {
    if (c in row) {
      const v = row[c];
      if (v !== null && v !== undefined) {
        const s = String(v).trim();
        if (s.length > 0) return s;
      }
    }
  }
  return "";
}

/** Loose digits-only normalizer. Kept for internal use. */
function normalizeMobile(input: string): string {
  return input.replace(/[^0-9+]/g, "").replace(/^\+/, "");
}

/**
 * PH-mobile normalization. Returns the canonical 639XXXXXXXXX form (12
 * digits, no plus) if the input parses as a plausible PH mobile, or ""
 * if it doesn't.
 *
 * Accepts:
 *   09171234567        (11 digits, leading 0)
 *    9171234567        (10 digits, missing 0)
 *   639171234567       (12 digits, country code)
 *  +639171234567       (with plus)
 *  0917 123 4567       (any spacing / dashes / parens)
 *
 * Rejects anything that isn't a plausible mobile — landlines, garbage,
 * short strings. PH mobiles are always +63 + 9XX + 7 digits = 12 digits
 * in canonical form, and the subscriber number always starts with 9.
 */
export function normalizeMobilePH(input: string): string {
  if (!input) return "";
  // Strip everything non-digit, drop leading +.
  const digits = input.replace(/[^\d]/g, "");
  if (!digits) return "";

  // 09XXXXXXXXX (11 digits) → 63 + strip the leading 0
  if (digits.length === 11 && digits.startsWith("09")) {
    return "63" + digits.slice(1);
  }
  // 9XXXXXXXXX (10 digits, missing leading 0)
  if (digits.length === 10 && digits.startsWith("9")) {
    return "63" + digits;
  }
  // 639XXXXXXXXX (12 digits, country code prefix)
  if (digits.length === 12 && digits.startsWith("639")) {
    return digits;
  }
  // 0063… or 63… without the 9 marker → treat as trailing-9-required
  // path if a stripped leading 0 gets us to 639… of the right length.
  if (digits.length === 13 && digits.startsWith("0639")) {
    return digits.slice(1);
  }
  return "";
}
