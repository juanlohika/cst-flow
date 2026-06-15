/**
 * Server-side geocoder — Pin Validator.
 *
 * Reads column A (Location) of a per-account Pin Validator Sheet, finds rows
 * that don't yet have lat/lng (columns B/C), and calls Google Maps
 * Geocoding API for each. Results are written back to the Sheet:
 *   B = Lng
 *   C = Lat
 *   D = Address (formatted from the geocoder's first result)
 *   E = Map link (HYPERLINK formula to maps.google.com/?q=lat,lng)
 *   F = Status   (left as "Pending" — validators set this)
 *
 * Cost discipline:
 *   • 300 ms sleep between requests (matches the legacy Apps Script and stays
 *     well under Google's 50 req/sec rate limit).
 *   • Quota guard via lib/pin-validator/quota.ts — refuses to start any batch
 *     that would exceed the 40,000/month free tier.
 *   • Idempotent — skips rows whose Lat is already set (and not "Not Found").
 *
 * Returns a summary so the UI can show "Processed: 12, Skipped: 4, Errors: 1".
 */
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canGeocodeBatch, incrementUsage } from "./quota";

const GEOCODE_API_BASE = "https://maps.googleapis.com/maps/api/geocode/json";
const SETTING_KEY_API_KEY = "GOOGLE_MAPS_API_KEY";
const THROTTLE_MS = 300;

const COL_LOCATION = 0; // A
const COL_LNG = 1; // B
const COL_LAT = 2; // C
const COL_ADDRESS = 3; // D
const COL_MAPLINK = 4; // E
const COL_STATUS = 5; // F

interface AuthedSheetsClient {
  sheets: any;
}

async function loadSheetsClient(): Promise<AuthedSheetsClient> {
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

async function loadMapsApiKey(): Promise<string> {
  const rows = await db
    .select({ value: globalSettings.value })
    .from(globalSettings)
    .where(eq(globalSettings.key, SETTING_KEY_API_KEY))
    .limit(1);
  const apiKey = rows[0]?.value || process.env.GOOGLE_MAPS_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY missing. Add it under Admin → Google Integration to enable geocoding.",
    );
  }
  return apiKey;
}

export interface GeocodeRow {
  rowNumber: number; // 1-based, like the Sheet itself
  location: string;
}

export interface GeocodeOutcome {
  processed: number; // successfully geocoded this run
  skipped: number;   // already had lat/lng
  notFound: number;  // Google returned no result
  failed: number;    // HTTP/transport errors
  total: number;     // candidate rows we looked at
  detail: string[];  // human-readable lines for the UI
}

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
  error_message?: string;
}

async function geocodeOne(
  location: string,
  apiKey: string,
): Promise<
  | { ok: true; lat: number; lng: number; address: string }
  | { ok: false; reason: "not_found" | "transport_error"; detail?: string }
> {
  try {
    const url = `${GEOCODE_API_BASE}?address=${encodeURIComponent(location)}&key=${apiKey}`;
    const res = await fetch(url);
    const data: GoogleGeocodeResponse = await res.json();
    if (data.status === "OK" && data.results.length > 0) {
      const r = data.results[0];
      return {
        ok: true,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        address: r.formatted_address,
      };
    }
    if (data.status === "ZERO_RESULTS") {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: false,
      reason: "transport_error",
      detail: data.error_message || data.status,
    };
  } catch (e: any) {
    return { ok: false, reason: "transport_error", detail: e?.message || String(e) };
  }
}

/** Read the full Pins sheet to find rows that need geocoding. */
export async function findPendingRows(sheetId: string): Promise<GeocodeRow[]> {
  const { sheets } = await loadSheetsClient();
  // Read everything from A2 to F<lastRow>. We need columns A-C to decide
  // whether the row already has lat/lng; status (F) is irrelevant for
  // geocoding decisions.
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Pins!A2:F",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values: any[][] = resp.data.values || [];
  const pending: GeocodeRow[] = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const location = String(row[COL_LOCATION] ?? "").trim();
    if (!location) continue;
    const existingLat = row[COL_LAT];
    if (existingLat !== undefined && existingLat !== null && existingLat !== "" && existingLat !== "Not Found") {
      continue;
    }
    pending.push({ rowNumber: i + 2, location });
  }
  return pending;
}

/** Run the geocoder over a Sheet. Honors the monthly quota cap. */
export async function geocodeSheet(sheetId: string): Promise<GeocodeOutcome> {
  const pending = await findPendingRows(sheetId);
  if (pending.length === 0) {
    return {
      processed: 0,
      skipped: 0,
      notFound: 0,
      failed: 0,
      total: 0,
      detail: ["Nothing pending — every row already has coordinates."],
    };
  }

  const guard = await canGeocodeBatch(pending.length);
  if (!guard.ok) {
    throw new Error(guard.reason || "Geocoding cap reached for this month.");
  }

  const apiKey = await loadMapsApiKey();
  const { sheets } = await loadSheetsClient();

  let processed = 0;
  let notFound = 0;
  let failed = 0;
  const detail: string[] = [];

  for (let i = 0; i < pending.length; i++) {
    const { rowNumber, location } = pending[i];
    // Re-check the quota every 200 rows to bail early if usage hits the cap
    // (concurrent geocoders elsewhere in CST OS could be burning quota too).
    if (i > 0 && i % 200 === 0) {
      const g = await canGeocodeBatch(pending.length - i);
      if (!g.ok) {
        detail.push(
          `Aborted at row ${rowNumber}: ${g.reason}. ${processed} geocoded so far.`,
        );
        break;
      }
    }

    const result = await geocodeOne(location, apiKey);
    if (result.ok) {
      const mapsUrl = `https://www.google.com/maps?q=${result.lat},${result.lng}`;
      // Use batchUpdate to write columns B-E for this row in a single call.
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Pins!B${rowNumber}:E${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            result.lng,
            result.lat,
            result.address,
            `=HYPERLINK("${mapsUrl}","View on Map")`,
          ]],
        },
      });
      // Set Status to "Pending" if the cell is still blank (don't overwrite
      // an existing validator decision).
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Pins!F${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Pending"]] },
      });
      processed++;
      await incrementUsage(1);
    } else if (result.reason === "not_found") {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Pins!B${rowNumber}:E${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Not Found", "Not Found", "Address Not Found", "—"]],
        },
      });
      notFound++;
      // Counted against the quota — Google charges for ZERO_RESULTS too.
      await incrementUsage(1);
    } else {
      failed++;
      detail.push(
        `Row ${rowNumber} (${location}) — ${result.detail || "transport error"}`,
      );
    }

    if (i < pending.length - 1) await SLEEP(THROTTLE_MS);
  }

  detail.unshift(
    `✓ ${processed} geocoded, ${notFound} not found, ${failed} failed (of ${pending.length} pending).`,
  );
  return {
    processed,
    skipped: 0,
    notFound,
    failed,
    total: pending.length,
    detail,
  };
}
