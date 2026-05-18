/**
 * Phase A — Account & InternalTeam bulk import (XLSX).
 *
 * Two-sheet template:
 *   Sheet 1 "Accounts"     : account master data (upsert by accountId or
 *                            companyName).
 *   Sheet 2 "InternalTeam" : (account, user, role, isPrimary). One row per
 *                            (account, user) — multi-role not supported in v1
 *                            because the existing accountMemberships schema
 *                            stores a single internalRole per (user, account).
 *
 * Validation produces a per-row report with status (ok | warn | error). Apply
 * commits all ok+warn rows (warnings are non-blocking). Idempotent: re-running
 * the same upload produces no net change.
 */
import * as XLSX from "xlsx";
import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  accountMemberships as membershipsTable,
  users as usersTable,
  accountUploadBatches,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const VALID_INTERNAL_ROLES = ["RM", "PM", "BA", "Developer", "Other"] as const;
export type InternalRole = (typeof VALID_INTERNAL_ROLES)[number];

export const VALID_ENGAGEMENT_STATUSES = ["confirmed", "pilot", "exploratory", "inactive", "prospect"] as const;

export type RowStatus = "ok" | "warn" | "error";

export interface ParsedAccountRow {
  rowNumber: number;          // 1-indexed including header (sheet row number)
  accountId?: string;
  companyName?: string;
  industry?: string;
  modulesAvailed?: string;    // raw value, semicolon-separated
  engagementStatus?: string;
  primaryContact?: string;
  primaryContactEmail?: string;
}

export interface ParsedTeamRow {
  rowNumber: number;
  accountId?: string;
  companyName?: string;
  userEmail?: string;
  internalRole?: string;
  isPrimary?: string;         // raw string, parsed to boolean during validation
}

export interface RowReport {
  sheet: "Accounts" | "InternalTeam";
  rowNumber: number;
  status: RowStatus;
  message: string;
  details?: any;
}

export interface ValidationResult {
  accounts: ParsedAccountRow[];
  team: ParsedTeamRow[];
  report: RowReport[];
  totals: {
    totalRows: number;
    okRows: number;
    warnRows: number;
    errorRows: number;
  };
}

// ─── Parse: read XLSX bytes → rows ─────────────────────────────────────────
export function parseXlsx(buffer: ArrayBuffer): {
  accounts: ParsedAccountRow[];
  team: ParsedTeamRow[];
} {
  const wb = XLSX.read(buffer, { type: "array" });

  const accountsSheetName = findSheet(wb, "Accounts");
  const teamSheetName = findSheet(wb, "InternalTeam");

  const accounts: ParsedAccountRow[] = [];
  const team: ParsedTeamRow[] = [];

  if (accountsSheetName) {
    const raw: any[] = XLSX.utils.sheet_to_json(wb.Sheets[accountsSheetName], { defval: "" });
    raw.forEach((r, idx) => {
      accounts.push({
        rowNumber: idx + 2, // +1 for header, +1 to 1-index
        accountId: stringOrEmpty(r.account_id || r.accountId || r.id),
        companyName: stringOrEmpty(r.account_name || r.companyName || r.name),
        industry: stringOrEmpty(r.industry),
        modulesAvailed: stringOrEmpty(r.modules_in_use || r.modulesAvailed || r.modules),
        engagementStatus: stringOrEmpty(r.status || r.engagementStatus),
        primaryContact: stringOrEmpty(r.primary_contact || r.primaryContact),
        primaryContactEmail: stringOrEmpty(r.primary_contact_email || r.primaryContactEmail),
      });
    });
  }

  if (teamSheetName) {
    const raw: any[] = XLSX.utils.sheet_to_json(wb.Sheets[teamSheetName], { defval: "" });
    raw.forEach((r, idx) => {
      team.push({
        rowNumber: idx + 2,
        accountId: stringOrEmpty(r.account_id || r.accountId),
        companyName: stringOrEmpty(r.account_name || r.companyName),
        userEmail: stringOrEmpty(r.user_email || r.userEmail || r.email),
        internalRole: stringOrEmpty(r.role || r.internalRole || r.roles),
        isPrimary: stringOrEmpty(r.is_primary_rm || r.isPrimary || r.primary),
      });
    });
  }

  return { accounts, team };
}

// ─── Validate: rows → row report + resolved data ───────────────────────────
export async function validateRows(input: {
  accounts: ParsedAccountRow[];
  team: ParsedTeamRow[];
}): Promise<ValidationResult> {
  const report: RowReport[] = [];

  // Load all users and existing accounts upfront for cheap lookups
  const allUsers = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable);
  const usersByEmail = new Map(allUsers.map(u => [String(u.email).toLowerCase(), u]));

  const allAccounts = await db
    .select({
      id: clientProfilesTable.id,
      companyName: clientProfilesTable.companyName,
    })
    .from(clientProfilesTable);
  const accountsById = new Map(allAccounts.map(a => [a.id, a]));
  const accountsByCompanyName = new Map(
    allAccounts.map(a => [a.companyName.toLowerCase().trim(), a])
  );

  // Track what new account companyNames will exist after this import
  // so InternalTeam rows can refer to accounts being created in the same upload.
  const newCompanyNames = new Set<string>();

  // ─── Accounts sheet ──────────────────────────────────────────────────
  let okCountAcc = 0, warnCountAcc = 0, errCountAcc = 0;
  for (const row of input.accounts) {
    if (!row.accountId && !row.companyName) {
      report.push({ sheet: "Accounts", rowNumber: row.rowNumber, status: "error",
        message: "Row must have either account_id or account_name." });
      errCountAcc++;
      continue;
    }
    if (row.accountId && !accountsById.has(row.accountId)) {
      report.push({ sheet: "Accounts", rowNumber: row.rowNumber, status: "error",
        message: `account_id "${row.accountId}" not found in the system.` });
      errCountAcc++;
      continue;
    }

    const isUpdate = !!row.accountId || (row.companyName && accountsByCompanyName.has(row.companyName.toLowerCase().trim()));
    if (!isUpdate) {
      // New account — require industry + modulesAvailed at minimum (existing schema has them NOT NULL)
      if (!row.industry) {
        report.push({ sheet: "Accounts", rowNumber: row.rowNumber, status: "error",
          message: `Cannot create new account "${row.companyName}" — industry is required.` });
        errCountAcc++;
        continue;
      }
      newCompanyNames.add(row.companyName!.toLowerCase().trim());
    }

    if (row.engagementStatus && !VALID_ENGAGEMENT_STATUSES.includes(row.engagementStatus as any)) {
      report.push({ sheet: "Accounts", rowNumber: row.rowNumber, status: "warn",
        message: `engagementStatus "${row.engagementStatus}" is not standard (expected: ${VALID_ENGAGEMENT_STATUSES.join(", ")}). Will be saved as-is.` });
      warnCountAcc++;
      continue;
    }

    report.push({ sheet: "Accounts", rowNumber: row.rowNumber, status: "ok",
      message: isUpdate ? `Will update "${row.companyName || row.accountId}".`
                         : `Will create new account "${row.companyName}".` });
    okCountAcc++;
  }

  // ─── InternalTeam sheet ─────────────────────────────────────────────
  let okCountTeam = 0, warnCountTeam = 0, errCountTeam = 0;
  // One primary per (account) — track to flag conflicts inside the upload.
  const primaryPerAccount = new Map<string, number>(); // accountKey → rowNumber that claims it

  for (const row of input.team) {
    if (!row.accountId && !row.companyName) {
      report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "error",
        message: "Row must have either account_id or account_name." });
      errCountTeam++;
      continue;
    }
    if (!row.userEmail) {
      report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "error",
        message: "user_email is required." });
      errCountTeam++;
      continue;
    }
    if (!row.internalRole) {
      report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "error",
        message: "role is required (RM | PM | BA | Developer | Other)." });
      errCountTeam++;
      continue;
    }
    // Accept first role only (v1: single internalRole per membership)
    const firstRole = row.internalRole.split(/[;,]/)[0].trim();
    if (!VALID_INTERNAL_ROLES.includes(firstRole as InternalRole)) {
      report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "error",
        message: `role "${firstRole}" is not valid. Expected one of: ${VALID_INTERNAL_ROLES.join(", ")}.` });
      errCountTeam++;
      continue;
    }
    if (row.internalRole.match(/[;,]/)) {
      report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "warn",
        message: `Multiple roles given (${row.internalRole}). Only the first ("${firstRole}") will be saved — multi-role per account isn't supported yet.` });
      warnCountTeam++;
    }

    // Resolve the user
    const user = usersByEmail.get(row.userEmail.toLowerCase());
    if (!user) {
      report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "error",
        message: `user_email "${row.userEmail}" doesn't match any CST OS user. They must be registered first.` });
      errCountTeam++;
      continue;
    }

    // Resolve the account
    const accountKey = row.accountId
      ? `id:${row.accountId}`
      : `name:${row.companyName!.toLowerCase().trim()}`;
    const accountExists = row.accountId
      ? accountsById.has(row.accountId)
      : (accountsByCompanyName.has(row.companyName!.toLowerCase().trim()) ||
         newCompanyNames.has(row.companyName!.toLowerCase().trim()));
    if (!accountExists) {
      report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "error",
        message: `Account "${row.companyName || row.accountId}" not found and not being created in this upload.` });
      errCountTeam++;
      continue;
    }

    // Parse isPrimary
    const isPrimary = parseBool(row.isPrimary);
    if (isPrimary) {
      if (primaryPerAccount.has(accountKey)) {
        report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "error",
          message: `Another row (#${primaryPerAccount.get(accountKey)}) already claims is_primary_rm=true for this account.` });
        errCountTeam++;
        continue;
      }
      primaryPerAccount.set(accountKey, row.rowNumber);
    }

    report.push({ sheet: "InternalTeam", rowNumber: row.rowNumber, status: "ok",
      message: `Will assign ${row.userEmail} as ${firstRole}${isPrimary ? " (Primary RM)" : ""} on "${row.companyName || row.accountId}".` });
    okCountTeam++;
  }

  return {
    accounts: input.accounts,
    team: input.team,
    report,
    totals: {
      totalRows: input.accounts.length + input.team.length,
      okRows: okCountAcc + okCountTeam,
      warnRows: warnCountAcc + warnCountTeam,
      errorRows: errCountAcc + errCountTeam,
    },
  };
}

// ─── Apply: validated input → DB writes ────────────────────────────────────
export async function applyValidated(args: {
  validation: ValidationResult;
  uploadedBy: string;
  filename: string;
}): Promise<{ batchId: string; appliedAccounts: number; appliedTeam: number; skipped: number }> {
  const reportByKey = new Map<string, RowReport>();
  for (const r of args.validation.report) {
    reportByKey.set(`${r.sheet}:${r.rowNumber}`, r);
  }

  let appliedAccounts = 0;
  let appliedTeam = 0;
  let skipped = 0;

  // Resolve the uploader's user (for the userId column on new accounts — owner of the row)
  const uploaderRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, args.uploadedBy))
    .limit(1);
  if (uploaderRows.length === 0) throw new Error("Uploader user not found");

  // Build email → userId map once for the team sheet
  const allUsers = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable);
  const usersByEmail = new Map(allUsers.map(u => [String(u.email).toLowerCase(), u]));

  // 1. Apply Accounts sheet
  for (const row of args.validation.accounts) {
    const rep = reportByKey.get(`Accounts:${row.rowNumber}`);
    if (!rep || rep.status === "error") { skipped++; continue; }

    try {
      if (row.accountId) {
        // Update by ID
        await db
          .update(clientProfilesTable)
          .set(buildUpdatePatch(row))
          .where(eq(clientProfilesTable.id, row.accountId));
      } else {
        // Upsert by companyName
        const existing = await db
          .select({ id: clientProfilesTable.id })
          .from(clientProfilesTable)
          .where(eq(clientProfilesTable.companyName, row.companyName!))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(clientProfilesTable)
            .set(buildUpdatePatch(row))
            .where(eq(clientProfilesTable.id, existing[0].id));
        } else {
          // Insert new
          await db.insert(clientProfilesTable).values({
            userId: args.uploadedBy,
            companyName: row.companyName!,
            industry: row.industry || "Unknown",
            modulesAvailed: row.modulesAvailed || "[]",
            engagementStatus: row.engagementStatus || "confirmed",
            primaryContact: row.primaryContact || null,
            primaryContactEmail: row.primaryContactEmail || null,
          } as any);
        }
      }
      appliedAccounts++;
    } catch (e: any) {
      // Mutate the report so the batch record has the failure
      rep.status = "error";
      rep.message = `Apply failed: ${e?.message || e}`;
      skipped++;
    }
  }

  // 2. Apply InternalTeam sheet
  // Re-load accounts in case new ones were just created
  const accountsAfter = await db
    .select({ id: clientProfilesTable.id, companyName: clientProfilesTable.companyName })
    .from(clientProfilesTable);
  const accountsById = new Map(accountsAfter.map(a => [a.id, a]));
  const accountsByCompanyName = new Map(
    accountsAfter.map(a => [a.companyName.toLowerCase().trim(), a])
  );

  for (const row of args.validation.team) {
    const rep = reportByKey.get(`InternalTeam:${row.rowNumber}`);
    if (!rep || rep.status === "error") { skipped++; continue; }

    try {
      const account = row.accountId
        ? accountsById.get(row.accountId)
        : accountsByCompanyName.get(row.companyName!.toLowerCase().trim());
      if (!account) {
        rep.status = "error";
        rep.message = "Account not found at apply time (may have failed earlier).";
        skipped++;
        continue;
      }
      const user = usersByEmail.get(row.userEmail!.toLowerCase());
      if (!user) {
        rep.status = "error";
        rep.message = "User no longer exists.";
        skipped++;
        continue;
      }

      const internalRole = row.internalRole!.split(/[;,]/)[0].trim() as InternalRole;
      const isPrimary = parseBool(row.isPrimary);

      // If setting as primary, clear other primaries on this account first
      if (isPrimary) {
        await db
          .update(membershipsTable)
          .set({ isPrimary: false })
          .where(eq(membershipsTable.clientProfileId, account.id));
      }

      const existing = await db
        .select({ id: membershipsTable.id })
        .from(membershipsTable)
        .where(and(
          eq(membershipsTable.userId, user.id),
          eq(membershipsTable.clientProfileId, account.id),
        ))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(membershipsTable)
          .set({ internalRole, isPrimary })
          .where(eq(membershipsTable.id, existing[0].id));
      } else {
        await db.insert(membershipsTable).values({
          userId: user.id,
          clientProfileId: account.id,
          role: "member",
          internalRole,
          isPrimary,
          grantedBy: args.uploadedBy,
          grantedAt: new Date().toISOString(),
        });
      }
      appliedTeam++;
    } catch (e: any) {
      rep.status = "error";
      rep.message = `Apply failed: ${e?.message || e}`;
      skipped++;
    }
  }

  // 3. Record the batch
  const batchId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const finalReport = Array.from(reportByKey.values());
  const finalErrorCount = finalReport.filter(r => r.status === "error").length;
  await db.insert(accountUploadBatches).values({
    id: batchId,
    uploadedBy: args.uploadedBy,
    filename: args.filename,
    totalRows: args.validation.totals.totalRows,
    appliedRows: appliedAccounts + appliedTeam,
    rejectedRows: finalErrorCount,
    validationReport: JSON.stringify(finalReport).slice(0, 1_000_000),
    status: "applied",
  });

  return { batchId, appliedAccounts, appliedTeam, skipped };
}

// ─── Generate template XLSX (pre-filled with current data) ─────────────────
export async function generateTemplateXlsx(): Promise<Buffer> {
  const accounts = await db
    .select({
      id: clientProfilesTable.id,
      companyName: clientProfilesTable.companyName,
      industry: clientProfilesTable.industry,
      modulesAvailed: clientProfilesTable.modulesAvailed,
      engagementStatus: clientProfilesTable.engagementStatus,
      primaryContact: clientProfilesTable.primaryContact,
      primaryContactEmail: clientProfilesTable.primaryContactEmail,
    })
    .from(clientProfilesTable);

  const memberships = await db
    .select({
      clientProfileId: membershipsTable.clientProfileId,
      userId: membershipsTable.userId,
      internalRole: membershipsTable.internalRole,
      isPrimary: membershipsTable.isPrimary,
    })
    .from(membershipsTable);

  const allUsers = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable);
  const userEmailById = new Map(allUsers.map(u => [u.id, u.email]));
  const accountNameById = new Map(accounts.map(a => [a.id, a.companyName]));

  // Sheet 1: Accounts
  const accountsRows = accounts.map(a => ({
    account_id: a.id,
    account_name: a.companyName,
    industry: a.industry,
    modules_in_use: parseModulesForTemplate(a.modulesAvailed),
    status: a.engagementStatus,
    primary_contact: a.primaryContact || "",
    primary_contact_email: a.primaryContactEmail || "",
  }));

  // Sheet 2: InternalTeam — include only memberships with an internalRole set
  const teamRows = memberships
    .filter(m => m.internalRole)
    .map(m => ({
      account_id: m.clientProfileId,
      account_name: accountNameById.get(m.clientProfileId) || "",
      user_email: userEmailById.get(m.userId) || "",
      role: m.internalRole,
      is_primary_rm: m.isPrimary ? "true" : "",
    }));

  const wb = XLSX.utils.book_new();

  const wsAccounts = XLSX.utils.json_to_sheet(accountsRows, {
    header: ["account_id", "account_name", "industry", "modules_in_use", "status", "primary_contact", "primary_contact_email"],
  });
  wsAccounts["!cols"] = [
    { wch: 40 }, { wch: 30 }, { wch: 18 }, { wch: 40 }, { wch: 14 }, { wch: 22 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAccounts, "Accounts");

  const wsTeam = XLSX.utils.json_to_sheet(teamRows, {
    header: ["account_id", "account_name", "user_email", "role", "is_primary_rm"],
  });
  wsTeam["!cols"] = [{ wch: 40 }, { wch: 30 }, { wch: 28 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsTeam, "InternalTeam");

  // README sheet
  const readme = [
    ["CST OS — Account & Internal Team bulk import"],
    [""],
    ["INSTRUCTIONS"],
    ["1. Edit the Accounts sheet to update existing rows or add new ones."],
    ["   - account_id: leave blank for new accounts (companyName will be the upsert key)."],
    ["   - industry: required for new accounts."],
    ["   - modules_in_use: semicolon-separated list (e.g. Attendance;Inventory;Leads)."],
    ["   - status: confirmed | pilot | exploratory | inactive | prospect"],
    [""],
    ["2. Edit the InternalTeam sheet to assign CST team members to accounts."],
    ["   - account_id OR account_name must reference an account (existing or being created)."],
    ["   - user_email must match a registered CST OS user."],
    ["   - role: RM | PM | BA | Developer | Other (one per row)."],
    ["   - is_primary_rm: 'true' for the primary RM. Only one row per account."],
    [""],
    ["3. Upload via /admin/accounts/import. The system will validate first."],
    ["4. Re-uploading the same file is safe (idempotent)."],
  ].map(r => [r[0] || ""]);
  const wsReadme = XLSX.utils.aoa_to_sheet(readme);
  wsReadme["!cols"] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wsReadme, "README");

  // Move README to first position
  wb.SheetNames = ["README", "Accounts", "InternalTeam"];

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function findSheet(wb: XLSX.WorkBook, target: string): string | null {
  return wb.SheetNames.find(n => n.toLowerCase() === target.toLowerCase()) || null;
}

function stringOrEmpty(v: any): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseBool(raw?: string): boolean {
  if (!raw) return false;
  const v = String(raw).toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes" || v === "y";
}

function buildUpdatePatch(row: ParsedAccountRow): any {
  const patch: any = { updatedAt: new Date().toISOString() };
  if (row.companyName) patch.companyName = row.companyName;
  if (row.industry) patch.industry = row.industry;
  if (row.modulesAvailed) patch.modulesAvailed = row.modulesAvailed;
  if (row.engagementStatus) patch.engagementStatus = row.engagementStatus;
  if (row.primaryContact !== undefined) patch.primaryContact = row.primaryContact || null;
  if (row.primaryContactEmail !== undefined) patch.primaryContactEmail = row.primaryContactEmail || null;
  return patch;
}

function parseModulesForTemplate(raw: string | null | undefined): string {
  if (!raw) return "";
  // modulesAvailed may be JSON array or semicolon string — normalize to semicolon string
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(";");
  } catch {}
  return String(raw).replace(/,/g, ";");
}
