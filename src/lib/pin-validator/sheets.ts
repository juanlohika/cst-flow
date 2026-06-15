/**
 * Google Drive + Sheets helpers — Pin Validator.
 *
 * Two responsibilities:
 *
 *   1. Ensure a MASTER template Spreadsheet exists in the configured Pin
 *      Validator folder. Created programmatically on first use; ID cached in
 *      GlobalSetting so we don't recreate it.
 *
 *   2. Per-account activation: copy the master template, rename it after the
 *      account, leave the copy in the same folder. Returns the new Sheet's
 *      ID + URL.
 *
 * The validator backend (the future approve/flag API and the geocoder) talks
 * to the cloned Sheet using the service account stored in
 * `GlobalSetting.GOOGLE_SERVICE_ACCOUNT_JSON`.
 */
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

/** Drive folder where the master template + all account-specific Sheets live. */
const SETTING_KEY_FOLDER = "PIN_VALIDATOR_DRIVE_FOLDER_ID";
/** ID of the master template Sheet. We create it on first use. */
const SETTING_KEY_TEMPLATE_SHEET_ID = "PIN_VALIDATOR_TEMPLATE_SHEET_ID";

/** Default folder the team set up for Pin Validator Sheets. Override per-env
 * by writing a different value into GlobalSetting.PIN_VALIDATOR_DRIVE_FOLDER_ID. */
const DEFAULT_FOLDER_ID = "1UpHytw2gV_t-_RKwLnfluhTRt9KYG9MH";

const TEMPLATE_SHEET_TITLE = "[CST] Pin Validator — Template (do not delete)";

/** Columns in the validator Sheet, in order. Matches the legacy Apps Script
 * layout so any team member who knows the previous template feels at home. */
const TEMPLATE_HEADERS = [
  "Location",
  "Lng",
  "Lat",
  "Address",
  "Map link",
  "Status",
  "Note",
  "Validator",
  "Timestamp",
] as const;

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
      "GOOGLE_SERVICE_ACCOUNT_JSON missing. Set it in admin settings before activating Pin Validator.",
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
      "https://www.googleapis.com/auth/drive.file",
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

/** Get-or-set helper for GlobalSetting. */
async function readSetting(key: string): Promise<string | null> {
  const rows = await db
    .select({ value: globalSettings.value })
    .from(globalSettings)
    .where(eq(globalSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db
    .select({ id: globalSettings.id })
    .from(globalSettings)
    .where(eq(globalSettings.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(globalSettings)
      .set({ value, updatedAt: now })
      .where(eq(globalSettings.id, existing[0].id));
  } else {
    await db.insert(globalSettings).values({
      id: `gs_pv_${Math.random().toString(36).substring(2, 10)}`,
      key,
      value,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/** Resolve the Pin Validator Drive folder ID. Falls back to the default
 * the team set up if nobody has overridden it. */
export async function getPinValidatorFolderId(): Promise<string> {
  return (await readSetting(SETTING_KEY_FOLDER)) || DEFAULT_FOLDER_ID;
}

/**
 * Ensure the master template Sheet exists. Creates it on first call,
 * inside the Pin Validator folder, with the right header row already
 * populated. Returns the master Sheet's ID.
 *
 * Idempotent — subsequent calls just return the cached ID. Re-validates
 * that the cached ID still exists in Drive; recreates if it was deleted.
 */
export async function ensureTemplateSheet(): Promise<{
  templateSheetId: string;
  folderId: string;
  created: boolean;
}> {
  const folderId = await getPinValidatorFolderId();
  const { drive, sheets, serviceAccountEmail } = await loadAuthedClients();

  // Verify the folder is reachable. Common failure mode: someone forgot to
  // share it with the service account, so we surface a clear error.
  try {
    await drive.files.get({
      fileId: folderId,
      fields: "id, name",
      supportsAllDrives: true,
    });
  } catch (e: any) {
    const code = e?.code || e?.status;
    if (code === 404) {
      throw new Error(
        `Pin Validator Drive folder (${folderId}) not found. Make sure it exists and is shared with ${serviceAccountEmail} as Editor.`,
      );
    }
    if (code === 403) {
      throw new Error(
        `Service account ${serviceAccountEmail} lacks access to Pin Validator Drive folder (${folderId}). Share it as Editor.`,
      );
    }
    throw e;
  }

  // Reuse cached template if it still exists.
  const cachedId = await readSetting(SETTING_KEY_TEMPLATE_SHEET_ID);
  if (cachedId) {
    try {
      await drive.files.get({
        fileId: cachedId,
        fields: "id, name",
        supportsAllDrives: true,
      });
      return { templateSheetId: cachedId, folderId, created: false };
    } catch (e: any) {
      const code = e?.code || e?.status;
      if (code !== 404) throw e;
      // Cached template was deleted from Drive. Fall through to recreate.
    }
  }

  // Create the master template inside the folder.
  const created = await drive.files.create({
    requestBody: {
      name: TEMPLATE_SHEET_TITLE,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [folderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const templateSheetId = created.data.id!;
  if (!templateSheetId) {
    throw new Error("Drive did not return an ID for the new template Sheet");
  }

  // Initialize the template with the header row and a friendly default tab name.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: templateSheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: 0, title: "Pins" },
            fields: "title",
          },
        },
      ],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: templateSheetId,
    range: "Pins!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [TEMPLATE_HEADERS as unknown as string[]] },
  });
  // Freeze header row + bolden it for clarity in the master.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: templateSheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: 0,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
              },
            },
            fields: "userEnteredFormat(textFormat,backgroundColor)",
          },
        },
      ],
    },
  });

  await writeSetting(SETTING_KEY_TEMPLATE_SHEET_ID, templateSheetId);
  return { templateSheetId, folderId, created: true };
}

/** Generate a safe Sheet name from a company name. Trims to 80 chars,
 * strips characters Drive doesn't love. */
function buildSheetName(companyName: string): string {
  const cleaned = companyName.replace(/[\/\\:?*"<>|]/g, "").trim();
  return `${cleaned} — Pin Validator`.slice(0, 100);
}

/**
 * Create a per-account Pin Validator Sheet by copying the master template
 * into the same folder. Returns the new Sheet's ID and editable URL.
 */
export async function provisionAccountSheet(opts: {
  companyName: string;
}): Promise<{ sheetId: string; sheetUrl: string; name: string }> {
  const { drive } = await loadAuthedClients();
  const { templateSheetId, folderId } = await ensureTemplateSheet();
  const name = buildSheetName(opts.companyName);

  const copy = await drive.files.copy({
    fileId: templateSheetId,
    requestBody: {
      name,
      parents: [folderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  const sheetId = copy.data.id!;
  if (!sheetId) {
    throw new Error("Drive did not return an ID for the copied Sheet");
  }
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  return { sheetId, sheetUrl, name };
}
