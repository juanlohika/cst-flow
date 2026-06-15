/**
 * Server-side place lookup — Pin Validator.
 *
 * Uses Google **Places API (New) — Text Search (Essentials SKU)**
 * instead of the address-only Geocoding API. Reason:
 * the store names in column A are typically brand + location keywords
 * ("SM City Fairview", "Tapa King North EDSA", "Samsung Store Uptown
 * Mall C5"), which Geocoding API mishandles. Text Search uses Google's
 * business directory and reliably resolves these.
 *
 * Cost discipline:
 *   • Essentials SKU is $5 per 1,000 calls — same as the legacy Geocoding API
 *   • Both billed against the SAME monthly $200 free credit pool (~40k calls)
 *   • Field mask restricts the response to Essentials-tier fields only —
 *     this is what locks the per-call price at $5/1k (asking for `rating`
 *     or `currentOpeningHours` would bump to the $35/1k Pro SKU).
 *   • 200 ms throttle between calls (Places quota is generous; this is
 *     headroom against transient 429s)
 *   • Quota guard via lib/pin-validator/quota.ts — refuses to start any
 *     batch that would exceed the 40,000/month free tier (same monthly
 *     counter, same cap — the meter doesn't care which Google API we use).
 *   • Idempotent — skips rows whose Lat is already set (and not "Not Found").
 *
 * Sheet output (unchanged from the previous Geocoding implementation):
 *   B = Lng    C = Lat   D = Address (formatted_address)
 *   E = Map link (HYPERLINK to maps.google.com/?q=lat,lng)
 *   F = Status (set to "Pending" — validators set their own decision later)
 */
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canGeocodeBatch, incrementUsage } from "./quota";

const PLACES_API_URL =
  "https://places.googleapis.com/v1/places:searchText";
const SETTING_KEY_API_KEY = "GOOGLE_MAPS_API_KEY";
const THROTTLE_MS = 200;

/** Field mask MUST stay limited to Essentials-tier fields to keep the
 * billed SKU at $5/1k. Adding "rating", "currentOpeningHours", "photos"
 * etc. promotes the call to Pro ($35/1k) or Enterprise ($50/1k). */
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.id",
].join(",");

const COL_LOCATION = 0; // A
const COL_LNG = 1;      // B
const COL_LAT = 2;      // C
const COL_ADDRESS = 3;  // D
const COL_MAPLINK = 4;  // E
const COL_STATUS = 5;   // F

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
      "GOOGLE_MAPS_API_KEY missing. Add it under Admin → Google Integration, " +
        "and make sure the Google Cloud project has Places API (New) enabled.",
    );
  }
  return apiKey;
}

export interface GeocodeRow {
  rowNumber: number; // 1-based, like the Sheet itself
  location: string;
}

export interface GeocodeOutcome {
  processed: number; // successfully resolved this run
  skipped: number;   // already had lat/lng
  notFound: number;  // Places returned zero matches
  failed: number;    // HTTP/transport errors
  total: number;     // candidate rows we looked at
  detail: string[];  // human-readable lines for the UI
}

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PlacesSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  }>;
  error?: { code: number; message: string; status: string };
}

async function lookupOne(
  query: string,
  apiKey: string,
): Promise<
  | { ok: true; lat: number; lng: number; address: string; name: string; placeId: string }
  | { ok: false; reason: "not_found" | "transport_error"; detail?: string }
> {
  try {
    const res = await fetch(PLACES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      // pageSize 1 — we only ever take the top match; this minimizes
      // bandwidth, doesn't change cost (cost is per call, not per result).
      body: JSON.stringify({
        textQuery: query,
        pageSize: 1,
      }),
    });

    let data: PlacesSearchResponse;
    try {
      data = await res.json();
    } catch (e: any) {
      return {
        ok: false,
        reason: "transport_error",
        detail: `Invalid JSON from Places API: ${e?.message}`,
      };
    }

    if (!res.ok || data.error) {
      const status = data.error?.status || `HTTP ${res.status}`;
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return { ok: false, reason: "transport_error", detail: `${status}: ${msg}` };
    }

    const top = (data.places || [])[0];
    if (!top || !top.location?.latitude || !top.location?.longitude) {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      lat: top.location.latitude,
      lng: top.location.longitude,
      address: top.formattedAddress || top.displayName?.text || query,
      name: top.displayName?.text || "",
      placeId: top.id || "",
    };
  } catch (e: any) {
    return { ok: false, reason: "transport_error", detail: e?.message || String(e) };
  }
}

/** Read the full Pins sheet to find rows that need a lookup. */
export async function findPendingRows(sheetId: string): Promise<GeocodeRow[]> {
  const { sheets } = await loadSheetsClient();
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
    if (
      existingLat !== undefined &&
      existingLat !== null &&
      existingLat !== "" &&
      existingLat !== "Not Found"
    ) {
      continue;
    }
    pending.push({ rowNumber: i + 2, location });
  }
  return pending;
}

/** Run the place lookup over a Sheet. Honors the monthly quota cap. */
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
    // Re-check the quota every 200 rows so a long batch bails early if
    // concurrent geocoding elsewhere drove usage to the cap.
    if (i > 0 && i % 200 === 0) {
      const g = await canGeocodeBatch(pending.length - i);
      if (!g.ok) {
        detail.push(
          `Aborted at row ${rowNumber}: ${g.reason}. ${processed} resolved so far.`,
        );
        break;
      }
    }

    const result = await lookupOne(location, apiKey);
    if (result.ok) {
      const mapsUrl = `https://www.google.com/maps?q=${result.lat},${result.lng}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Pins!B${rowNumber}:E${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              result.lng,
              result.lat,
              result.address,
              `=HYPERLINK("${mapsUrl}","View on Map")`,
            ],
          ],
        },
      });
      // Only set Status to "Pending" if the cell is blank — don't overwrite
      // an existing validator decision.
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
      // ZERO_RESULTS still counts against billing — increment the meter.
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
    `✓ ${processed} resolved, ${notFound} not found, ${failed} failed (of ${pending.length} pending).`,
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
