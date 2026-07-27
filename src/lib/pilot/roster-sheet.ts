/**
 * Pilot Tracker — roster Google Sheet.
 *
 * A per-project spreadsheet the CLIENT's own admins fill in with their
 * people's Play Store emails and organizational tags (Branch / Area).
 * Lives in the project's existing Drive folder so screenshots and roster
 * sit together.
 *
 * ── The central design decision ───────────────────────────────────────
 *
 * The Sheet is a SNAPSHOT + INBOX, not a live mirror of the database.
 *
 * A live mirror is impossible to do safely: a spreadsheet cell has no
 * merge semantics, so any background push would silently overwrite
 * whatever an admin happens to be typing at that moment. Two writers, one
 * cell, no conflict resolution. So the two directions are separated:
 *
 *   system → sheet   only the system's own columns, only on an explicit
 *                    Refresh (or right after an adopt). Admin columns are
 *                    never written by us, so in-flight typing survives.
 *
 *   sheet → system   only at Lock, all at once, behind a preview diff.
 *
 * ── Why the collection window matters ─────────────────────────────────
 *
 * While the sheet is `collecting`, NOTHING flows into the database. That's
 * not a limitation, it's the point: setting a participant's Play Store
 * email moves them to Stage 1 and derives AWAITING_REGISTRATION, which
 * broadcasts a "please add this email to the Play tester list" request to
 * the internal channels. Streaming 300 rows in one at a time would emit up
 * to 300 of those.
 *
 * By holding everything until Lock, the adopt runs as one pass with
 * per-row broadcasts suppressed and emits a SINGLE digest: "250 emails
 * ready for registration." The noise problem is solved structurally
 * rather than by suppressing notifications after the fact.
 *
 * ── Locking is a checkpoint, not a one-way door ───────────────────────
 *
 * Reopening is deliberately one click. Corrections don't stop just
 * because a window closed; if reopening were heavy, people would route
 * around it via Viber and hand-edits — putting the corrections exactly
 * where the tracker can't see them. Re-locking adopts only what changed,
 * so a follow-up digest says "3 more emails" rather than re-announcing
 * all 250.
 */
import { db } from "@/db";
import { globalSettings, pilotParticipants, pilotProjects } from "@/db/schema";
import { eq } from "drizzle-orm";

/** Tab name inside the spreadsheet. */
export const ROSTER_TAB = "Roster";

/**
 * Column layout. Order matters — it's the on-sheet left-to-right order and
 * the index basis for protected ranges, so never reorder without also
 * re-running protection.
 *
 * `owner` is the contract with the admins:
 *   key    — the match key. Protected; changing it would orphan the row.
 *   system — written by us on Refresh, protected so admins can't edit.
 *   admin  — theirs. We only ever READ these, and only at Lock.
 */
export interface RosterColumn {
  /** Participant field name, or a synthetic id for display-only columns. */
  field: string;
  header: string;
  owner: "key" | "system" | "admin";
}

/**
 * Build the column list for a project. Custom columns are included only
 * when the project has given them a label — an unlabeled custom column is
 * noise on a sheet that external people have to read.
 */
export function buildColumns(project: {
  custom1Label?: string | null;
  custom2Label?: string | null;
}): RosterColumn[] {
  const cols: RosterColumn[] = [
    { field: "employeeId", header: "Employee ID", owner: "key" },
    { field: "fullName", header: "Full Name", owner: "admin" },
    { field: "mobileNumber", header: "Mobile Number", owner: "admin" },
    { field: "workEmail", header: "Work Email", owner: "admin" },
    { field: "playstoreEmail", header: "Play Store Email", owner: "admin" },
  ];
  const c1 = (project.custom1Label || "").trim();
  const c2 = (project.custom2Label || "").trim();
  if (c1) cols.push({ field: "custom1", header: c1, owner: "admin" });
  if (c2) cols.push({ field: "custom2", header: c2, owner: "admin" });
  // System columns last, so the admin's working area is the left side of
  // the sheet and they don't have to scroll past our read-only noise.
  cols.push(
    { field: "currentStage", header: "Stage (system)", owner: "system" },
    { field: "issueFlag", header: "Flag (system)", owner: "system" },
    { field: "reportedVersion", header: "Version (system)", owner: "system" },
    { field: "lastActivityAt", header: "Last Activity (system)", owner: "system" },
  );
  return cols;
}

interface AuthedClients {
  drive: any;
  sheets: any;
  serviceAccountEmail: string;
}

async function loadAuthedClients(): Promise<AuthedClients> {
  const rows = await db.select().from(globalSettings);
  const map = new Map(rows.map((r: any) => [r.key, r.value]));
  const serviceAccountJson =
    map.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    "";
  if (!serviceAccountJson) {
    throw new Error(
      "Google service account not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON in GlobalSetting.",
    );
  }
  let credentials: any;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (e: any) {
    throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e?.message}`);
  }
  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
  await auth.authorize();
  return {
    drive: google.drive({ version: "v3", auth }),
    sheets: google.sheets({ version: "v4", auth }),
    serviceAccountEmail: credentials.client_email,
  };
}

/** A1-style column letter for a 0-based index (0 → A, 26 → AA). */
function colLetter(index: number): string {
  let n = index;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/**
 * The numeric sheetId of the roster tab. Almost always 0 (first tab of a
 * fresh spreadsheet) but we look it up rather than assume, because a
 * human who duplicates or reorders tabs would otherwise silently break
 * every protected range we set.
 */
async function getTabId(sheets: any, spreadsheetId: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const tab = (meta.data.sheets || []).find(
    (s: any) => s.properties?.title === ROSTER_TAB,
  );
  if (!tab) {
    throw new Error(
      `The roster spreadsheet has no "${ROSTER_TAB}" tab. It may have been renamed — rename it back or re-provision the sheet.`,
    );
  }
  return tab.properties.sheetId as number;
}

/**
 * Create the roster Sheet for a project inside its Drive folder, populate
 * headers + current participants, and apply initial protection.
 *
 * Idempotent: if the project already has a live rosterSheetId, that sheet
 * is returned untouched. Re-provisioning would orphan whatever the admins
 * had already typed.
 */
export async function provisionRosterSheet(projectId: string): Promise<{
  sheetId: string;
  sheetUrl: string;
  created: boolean;
}> {
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(eq(pilotProjects.id, projectId))
    .limit(1);
  if (!project) throw new Error("Pilot project not found");
  if (!project.driveFolderId) {
    throw new Error(
      "This pilot has no Drive folder yet. Open the Drive tab once to create it, then try again.",
    );
  }

  const { drive, sheets, serviceAccountEmail } = await loadAuthedClients();

  // Reuse an existing sheet if it's still in Drive. If it was deleted out
  // from under us, fall through and make a new one rather than erroring —
  // a missing sheet shouldn't be a dead end for the CST.
  if (project.rosterSheetId) {
    try {
      await drive.files.get({
        fileId: project.rosterSheetId,
        fields: "id",
        supportsAllDrives: true,
      });
      return {
        sheetId: project.rosterSheetId,
        sheetUrl: project.rosterSheetUrl || sheetUrlFor(project.rosterSheetId),
        created: false,
      };
    } catch (e: any) {
      const code = e?.code || e?.status;
      if (code !== 404) throw e;
    }
  }

  try {
    await drive.files.get({
      fileId: project.driveFolderId,
      fields: "id",
      supportsAllDrives: true,
    });
  } catch (e: any) {
    const code = e?.code || e?.status;
    if (code === 404 || code === 403) {
      throw new Error(
        `Service account ${serviceAccountEmail} can't reach this pilot's Drive folder. Share it as Editor and retry.`,
      );
    }
    throw e;
  }

  const name = `${project.name} — Roster`.replace(/[\/\\:?*"<>|]/g, "").slice(0, 100);
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [project.driveFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const sheetId = created.data.id as string;
  if (!sheetId) throw new Error("Drive did not return an ID for the new Sheet");

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: 0, title: ROSTER_TAB },
            fields: "title",
          },
        },
      ],
    },
  });

  const sheetUrl = sheetUrlFor(sheetId);
  await db
    .update(pilotProjects)
    .set({ rosterSheetId: sheetId, rosterSheetUrl: sheetUrl })
    .where(eq(pilotProjects.id, projectId));

  // Populate content + protection. Provisioning always lands in the
  // project's current state, so a sheet created while locked comes out
  // locked.
  await pushToSheet(projectId);
  await applyProtection(projectId, project.rosterSheetState === "locked");

  return { sheetId, sheetUrl, created: true };
}

function sheetUrlFor(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/**
 * Write the current roster to the Sheet.
 *
 * Writes EVERY column, including admin-owned ones — but only ever called
 * on an explicit Refresh or immediately after an adopt, never on a timer.
 * That's the safety property: an admin's in-flight typing can only be
 * clobbered by someone deliberately pressing Refresh, and right after an
 * adopt the sheet's admin values and the database agree anyway.
 *
 * Rows are keyed by employeeId and sorted by name, so the sheet's row
 * order is stable across refreshes and admins don't lose their place.
 */
export async function pushToSheet(projectId: string): Promise<{ rows: number }> {
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(eq(pilotProjects.id, projectId))
    .limit(1);
  if (!project?.rosterSheetId) {
    throw new Error("This pilot has no roster Sheet yet.");
  }
  const { sheets } = await loadAuthedClients();
  const cols = buildColumns(project);
  const participants = await db
    .select()
    .from(pilotParticipants)
    .where(eq(pilotParticipants.projectId, projectId));
  participants.sort((a: any, b: any) =>
    String(a.fullName || "").localeCompare(String(b.fullName || "")),
  );

  const syncedAt = new Date().toISOString();
  // Row 1 is a human-readable banner. Without it a stale sheet looks
  // identical to a fresh one — the single most likely way for someone to
  // act on old data.
  const banner = [
    project.rosterSheetState === "locked"
      ? "🔒 LOCKED — this sheet is closed for edits."
      : "✏️ OPEN — enter your people's details in the unshaded columns.",
    `Last synced: ${syncedAt.replace("T", " ").slice(0, 16)} UTC`,
    "Grey columns are maintained by the CST system and cannot be edited.",
  ];
  const header = cols.map((c) => c.header);
  const body = participants.map((p: any) =>
    cols.map((c) => {
      const v = p[c.field];
      return v === null || v === undefined ? "" : String(v);
    }),
  );

  // Clear first so deleted participants don't leave orphan rows behind.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: project.rosterSheetId,
    range: `${ROSTER_TAB}!A1:ZZ100000`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: project.rosterSheetId,
    range: `${ROSTER_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [banner, header, ...body] },
  });

  await formatSheet(project.rosterSheetId, cols, sheets);
  await db
    .update(pilotProjects)
    .set({ rosterSheetSyncedAt: syncedAt })
    .where(eq(pilotProjects.id, projectId));
  return { rows: body.length };
}

/**
 * Visual formatting: frozen banner+header, bold header, and a grey fill on
 * system columns so "you can't edit this" is obvious before anyone tries.
 * Protection enforces it; the colour just prevents the frustration.
 */
async function formatSheet(
  spreadsheetId: string,
  cols: RosterColumn[],
  sheets: any,
): Promise<void> {
  const tabId = await getTabId(sheets, spreadsheetId);
  const requests: any[] = [
    {
      updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: 2 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.98, green: 0.94, blue: 0.8 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: 2 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.9, green: 0.9, blue: 0.92 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
  ];
  cols.forEach((c, i) => {
    if (c.owner === "admin") return;
    requests.push({
      repeatCell: {
        range: {
          sheetId: tabId,
          startRowIndex: 2,
          startColumnIndex: i,
          endColumnIndex: i + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
          },
        },
        fields: "userEnteredFormat.backgroundColor",
      },
    });
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

/**
 * Apply protected ranges.
 *
 * Protection (rather than revoking edit access per-person) is what makes
 * the collection window cheap to toggle: locking is one API call and
 * fully reversible, and admins keep READ access throughout — which they
 * need, since they reference the roster during validation.
 *
 * `locked=false` → only key + system columns are protected.
 * `locked=true`  → the whole grid is protected.
 *
 * The service account is always in `editors.users` so the system itself
 * can keep writing through its own protection.
 */
export async function applyProtection(
  projectId: string,
  locked: boolean,
): Promise<void> {
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(eq(pilotProjects.id, projectId))
    .limit(1);
  if (!project?.rosterSheetId) throw new Error("This pilot has no roster Sheet yet.");
  const { sheets, serviceAccountEmail } = await loadAuthedClients();
  const spreadsheetId = project.rosterSheetId;
  const tabId = await getTabId(sheets, spreadsheetId);
  const cols = buildColumns(project);

  // Clear our previous protections before re-adding, otherwise toggling
  // the window repeatedly stacks up duplicate ranges.
  const existing = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(protectedRanges(protectedRangeId,description))",
  });
  const prior: any[] = [];
  for (const s of existing.data.sheets || []) {
    for (const pr of s.protectedRanges || []) {
      if (String(pr.description || "").startsWith("CST:")) {
        prior.push({ deleteProtectedRange: { protectedRangeId: pr.protectedRangeId } });
      }
    }
  }

  const editors = { users: [serviceAccountEmail] };
  const adds: any[] = [];
  if (locked) {
    adds.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: tabId },
          description: "CST: collection window closed",
          warningOnly: false,
          editors,
        },
      },
    });
  } else {
    // Banner + header rows are never editable — an admin who renames a
    // header would break the column mapping on adopt.
    adds.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 2 },
          description: "CST: header",
          warningOnly: false,
          editors,
        },
      },
    });
    cols.forEach((c, i) => {
      if (c.owner === "admin") return;
      adds.push({
        addProtectedRange: {
          protectedRange: {
            range: { sheetId: tabId, startColumnIndex: i, endColumnIndex: i + 1 },
            description: `CST: ${c.owner} column ${c.header}`,
            warningOnly: false,
            editors,
          },
        },
      });
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [...prior, ...adds] },
  });
}

/** One row as read back from the sheet, normalized to participant fields. */
export interface SheetRow {
  rowNumber: number;
  values: Record<string, string>;
}

/**
 * Read the admin-owned columns back out of the Sheet.
 *
 * Header-driven rather than position-driven: we map the sheet's actual
 * header row onto our column list by header text. If someone inserts a
 * column, we still read the right data instead of silently shifting every
 * value one field to the left.
 */
export async function readSheet(projectId: string): Promise<SheetRow[]> {
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(eq(pilotProjects.id, projectId))
    .limit(1);
  if (!project?.rosterSheetId) throw new Error("This pilot has no roster Sheet yet.");
  const { sheets } = await loadAuthedClients();
  const cols = buildColumns(project);
  const lastCol = colLetter(Math.max(cols.length, 1) + 5);

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: project.rosterSheetId,
    range: `${ROSTER_TAB}!A2:${lastCol}100000`,
  });
  const rows: string[][] = resp.data.values || [];
  if (rows.length === 0) return [];

  const headerRow = rows[0].map((h) => String(h || "").trim().toLowerCase());
  const indexFor = new Map<string, number>();
  for (const c of cols) {
    const i = headerRow.indexOf(c.header.toLowerCase());
    if (i >= 0) indexFor.set(c.field, i);
  }
  if (!indexFor.has("employeeId")) {
    throw new Error(
      `Couldn't find the "Employee ID" column in the sheet. Restore the header row or re-provision the sheet.`,
    );
  }

  const out: SheetRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r] || [];
    const values: Record<string, string> = {};
    let anyValue = false;
    for (const [field, i] of Array.from(indexFor.entries())) {
      const v = String(raw[i] ?? "").trim();
      values[field] = v;
      if (v) anyValue = true;
    }
    if (!anyValue) continue;  // blank spacer row
    // +2: row 1 is the banner, and r is 0-based within the header-led slice.
    out.push({ rowNumber: r + 2, values });
  }
  return out;
}
