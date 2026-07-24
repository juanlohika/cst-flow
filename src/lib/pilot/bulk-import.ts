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

  raw.forEach((r, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const employeeId = readField(r, ["Employee ID", "employeeId", "emp_id", "ID"]);
    const fullName = readField(r, ["Full Name", "fullName", "Name", "name"]);
    const mobileNumber = readField(r, ["Mobile Number", "mobileNumber", "Mobile", "mobile"]);

    // Required-field checks
    if (!employeeId) {
      rows.push({ rowNumber, status: "error", message: "Employee ID is required" });
      return;
    }
    if (!fullName) {
      rows.push({ rowNumber, employeeId, status: "error", message: "Full Name is required" });
      return;
    }
    if (!mobileNumber) {
      rows.push({ rowNumber, employeeId, fullName, status: "error", message: "Mobile Number is required" });
      return;
    }

    // Normalize mobile: strip non-digits, keep leading 0 or country prefix
    // as typed. Not a strict validator — different pilots have different
    // conventions and we don't want to reject on spacing/punctuation.
    const normalizedMobile = normalizeMobile(mobileNumber);
    if (normalizedMobile.length < 8) {
      rows.push({
        rowNumber,
        employeeId,
        fullName,
        mobileNumber,
        status: "error",
        message: `Mobile number "${mobileNumber}" is too short after normalization`,
      });
      return;
    }

    // Duplicate check within the same upload
    if (seenIds.has(employeeId)) {
      rows.push({
        rowNumber,
        employeeId,
        fullName,
        mobileNumber: normalizedMobile,
        status: "error",
        message: `Employee ID "${employeeId}" appears more than once in this file`,
      });
      return;
    }
    seenIds.add(employeeId);

    rows.push({
      rowNumber,
      employeeId,
      fullName,
      mobileNumber: normalizedMobile,
      status: "ok",
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

  for (const row of applicable) {
    if (!row.employeeId || !row.fullName || !row.mobileNumber) continue;
    const existingId = idByEmp.get(row.employeeId);
    if (existingId) {
      // Update the display fields via a raw update (updateParticipant()
      // is designed for state-machine fields; these are import-side
      // fields that don't affect stage). Kept minimal.
      await db
        .update(pilotParticipants)
        .set({
          fullName: row.fullName,
          mobileNumber: row.mobileNumber,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pilotParticipants.id, existingId));
      updated++;
    } else {
      await db.insert(pilotParticipants).values({
        projectId,
        employeeId: row.employeeId,
        fullName: row.fullName,
        mobileNumber: row.mobileNumber,
        lastActivityBy: "cst",
      });
      inserted++;
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
 */
export function generateTemplate(): Buffer {
  const headers = ["Employee ID", "Full Name", "Mobile Number"];
  const example = ["EMP-001", "Juan Dela Cruz", "09171234567"];
  const notes = [
    "(required; must be unique within this pilot)",
    "(required)",
    "(required; digits only — spaces/dashes/parentheses are OK, we normalize)",
  ];
  const aoa = [headers, example, notes];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths for readability
  ws["!cols"] = [{ wch: 20 }, { wch: 30 }, { wch: 20 }];
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

function normalizeMobile(input: string): string {
  return input.replace(/[^0-9+]/g, "").replace(/^\+/, "");
}
