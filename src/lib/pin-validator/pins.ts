/**
 * Read pins from a Pin Validator Sheet + write decisions back.
 *
 * The Sheet's "Pins" tab has the column layout:
 *   A Location · B Lng · C Lat · D Address · E Map link · F Status
 *   G Note · H Validator · I Timestamp
 *
 * Pins() returns only rows that have BOTH lat and lng (so the map can show
 * them). Pins still being geocoded ("Not Found" / blank) show up in the
 * management UI under a separate "pending geocoding" indicator instead.
 *
 * Decisions are written atomically per row — status, note, validator email,
 * and timestamp in one batched update. We never overwrite columns A-E,
 * so validator decisions never disturb the geocoded coordinates.
 */
import { db } from "@/db";
import { globalSettings } from "@/db/schema";

const TAB = "Pins";
const RANGE_ALL = "Pins!A2:I"; // start at row 2 to skip the header
const COL_STATUS_LETTER = "F";

const COL_LOCATION = 0;
const COL_LNG = 1;
const COL_LAT = 2;
const COL_ADDRESS = 3;
const COL_MAPLINK = 4;
const COL_STATUS = 5;
const COL_NOTE = 6;
const COL_VALIDATOR = 7;
const COL_TIMESTAMP = 8;

export interface Pin {
  row: number;       // 1-based row in the Sheet
  location: string;
  lng: number;
  lat: number;
  address: string;
  mapLink: string;
  status: "Pending" | "Approved" | "Flagged" | string;
  note: string;
  validator: string;
  timestamp: string;
}

export type Decision = "Approved" | "Flagged";

async function loadSheetsClient(): Promise<{ sheets: any }> {
  const rows = await db.select().from(globalSettings);
  const map = new Map(rows.map((r: any) => [r.key, r.value]));
  const serviceAccountJson =
    map.get("GOOGLE_SERVICE_ACCOUNT_JSON") ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    "";
  if (!serviceAccountJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON missing in admin settings.");
  }
  const credentials = JSON.parse(serviceAccountJson);
  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  await auth.authorize();
  return { sheets: google.sheets({ version: "v4", auth }) };
}

function toNum(v: any): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(parseFloat(v))) {
    return parseFloat(v);
  }
  return null;
}

export async function listPins(sheetId: string): Promise<Pin[]> {
  const { sheets } = await loadSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: RANGE_ALL,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const values: any[][] = resp.data.values || [];
  const out: Pin[] = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i] || [];
    const lat = toNum(r[COL_LAT]);
    const lng = toNum(r[COL_LNG]);
    if (lat === null || lng === null) continue;
    out.push({
      row: i + 2,
      location: String(r[COL_LOCATION] ?? "").trim(),
      lng,
      lat,
      address: String(r[COL_ADDRESS] ?? "").trim(),
      mapLink: String(r[COL_MAPLINK] ?? "").trim(),
      status: String(r[COL_STATUS] ?? "Pending").trim() || "Pending",
      note: String(r[COL_NOTE] ?? "").trim(),
      validator: String(r[COL_VALIDATOR] ?? "").trim(),
      timestamp: String(r[COL_TIMESTAMP] ?? "").trim(),
    });
  }
  return out;
}

export async function saveDecision(
  sheetId: string,
  rowNumber: number,
  decision: Decision,
  note: string,
  validatorEmail: string,
): Promise<void> {
  const { sheets } = await loadSheetsClient();
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Pins!${COL_STATUS_LETTER}${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[decision, note || "", validatorEmail, now]],
    },
  });
}

export async function saveDecisionsBulk(
  sheetId: string,
  decisions: Array<{ rowNumber: number; decision: Decision; note: string }>,
  validatorEmail: string,
): Promise<void> {
  if (decisions.length === 0) return;
  const { sheets } = await loadSheetsClient();
  const now = new Date().toISOString();
  const data = decisions.map((d) => ({
    range: `Pins!${COL_STATUS_LETTER}${d.rowNumber}:I${d.rowNumber}`,
    values: [[d.decision, d.note || "", validatorEmail, now]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}
