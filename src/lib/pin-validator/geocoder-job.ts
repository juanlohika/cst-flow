/**
 * Background-job geocoder for Pin Validator.
 *
 * Replaces the synchronous geocodeSheet() flow that hit the platform's
 * request-duration ceiling on large batches (a ~1,200-row list needed
 * 4-5 manual clicks to finish). Now it's one job that runs in the
 * background and self-heals if killed mid-run.
 *
 * Lifecycle:
 *   startGeocodingJob(projectId, userId)
 *     → inserts row (status='queued', totalRows = pending count)
 *     → caller fire-and-forget triggers /worker?jobId=...
 *
 *   runGeocodingJob(jobId)  (the worker — called from the worker route)
 *     → loads job, finds pending rows in the Sheet
 *     → for each row:
 *         * check cancelRequested → exit
 *         * check quota cap → mark paused
 *         * geocode via Places API
 *         * write result to Sheet
 *         * incrementUsage()
 *         * update job row (processed++, currentLocation, heartbeat)
 *         * sleep 300ms
 *         * every 200 rows: politeness pause (5s, resting=true)
 *         * on 429: backoff [5s, 30s, 120s]
 *     → finally mark status='completed', finishedAt=now()
 *
 * Watchdog:
 *   resumeStaleJob(jobId)
 *     If status='running' AND now - lastHeartbeatAt > 2 min, re-trigger
 *     the worker. Idempotent and safe to call from the poller.
 */
import { db } from "@/db";
import {
  pinValidatorGeocodingJobs,
  pinValidatorProjects,
  globalSettings,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { canGeocodeBatch, incrementUsage } from "./quota";

const PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText";
const SETTING_KEY_API_KEY = "GOOGLE_MAPS_API_KEY";
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.id",
].join(",");

const THROTTLE_MS = 300;                    // 3 calls/sec
const POLITENESS_PAUSE_EVERY = 200;         // rows
const POLITENESS_PAUSE_MS = 5_000;
const QUOTA_RECHECK_EVERY = 100;            // rows
const BACKOFF_SCHEDULE_MS = [5_000, 30_000, 120_000];
const HEARTBEAT_STALE_MS = 2 * 60_000;      // 2 min — watchdog threshold

const COL_LOCATION = 0;
const COL_LAT = 2;

export interface JobView {
  id: string;
  projectId: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  totalRows: number;
  processedRows: number;
  notFoundRows: number;
  failedRows: number;
  currentLocation: string | null;
  resting: boolean;
  restUntilMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

// ─── DB helpers ──────────────────────────────────────────────────────────

async function loadJob(jobId: string) {
  const rows = await db
    .select()
    .from(pinValidatorGeocodingJobs)
    .where(eq(pinValidatorGeocodingJobs.id, jobId))
    .limit(1);
  return rows[0] || null;
}

async function patchJob(
  jobId: string,
  changes: Partial<typeof pinValidatorGeocodingJobs.$inferInsert>,
): Promise<void> {
  await db
    .update(pinValidatorGeocodingJobs)
    .set(changes)
    .where(eq(pinValidatorGeocodingJobs.id, jobId));
}

async function heartbeat(jobId: string, extra: Partial<typeof pinValidatorGeocodingJobs.$inferInsert> = {}) {
  await patchJob(jobId, { ...extra, lastHeartbeatAt: new Date().toISOString() });
}

// ─── Sheets + Places clients ─────────────────────────────────────────────

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

async function loadMapsApiKey(): Promise<string> {
  const rows = await db
    .select({ value: globalSettings.value })
    .from(globalSettings)
    .where(eq(globalSettings.key, SETTING_KEY_API_KEY))
    .limit(1);
  const apiKey = rows[0]?.value || process.env.GOOGLE_MAPS_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY missing. Add it under Admin → Google Integration.",
    );
  }
  return apiKey;
}

interface PlacesResp {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  }>;
  error?: { code: number; message: string; status: string };
}

interface LookupResult {
  ok: true;
  lat: number;
  lng: number;
  address: string;
}
interface LookupNotFound {
  ok: false;
  reason: "not_found";
}
interface LookupTransport {
  ok: false;
  reason: "transport_error";
  detail: string;
  httpStatus: number;
}

async function lookupOne(
  query: string,
  apiKey: string,
): Promise<LookupResult | LookupNotFound | LookupTransport> {
  try {
    const res = await fetch(PLACES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
    });
    const data: PlacesResp = await res.json().catch(() => ({}) as PlacesResp);
    if (!res.ok || data.error) {
      const status = data.error?.status || `HTTP ${res.status}`;
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return { ok: false, reason: "transport_error", detail: `${status}: ${msg}`, httpStatus: res.status };
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
    };
  } catch (e: any) {
    return { ok: false, reason: "transport_error", detail: e?.message || String(e), httpStatus: 0 };
  }
}

// ─── Discovery: which rows still need geocoding ──────────────────────────

interface PendingRow {
  rowNumber: number;
  location: string;
}

async function findPendingRows(sheets: any, sheetId: string): Promise<PendingRow[]> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Pins!A2:F",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values: any[][] = resp.data.values || [];
  const out: PendingRow[] = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const location = String(row[COL_LOCATION] ?? "").trim();
    if (!location) continue;
    const lat = row[COL_LAT];
    if (lat !== undefined && lat !== null && lat !== "" && lat !== "Not Found") continue;
    out.push({ rowNumber: i + 2, location });
  }
  return out;
}

// ─── Public API: start a job ─────────────────────────────────────────────

export interface StartResult {
  jobId: string;
  totalRows: number;
}

/**
 * Insert a queued job row. The CALLER is responsible for triggering the
 * worker afterward (typically a detached fetch to /api/.../worker).
 * Throws if a job is already in-flight for this project.
 */
export async function startGeocodingJob(opts: {
  projectId: string;
  startedByUserId?: string;
}): Promise<StartResult> {
  // Reject if there's already a running/queued job.
  const inflight = await db
    .select({ id: pinValidatorGeocodingJobs.id, status: pinValidatorGeocodingJobs.status })
    .from(pinValidatorGeocodingJobs)
    .where(eq(pinValidatorGeocodingJobs.projectId, opts.projectId));
  const active = inflight.find((j) => j.status === "queued" || j.status === "running");
  if (active) {
    throw new Error(
      "A geocoding job is already in progress for this project. Wait for it to finish or cancel it.",
    );
  }

  // Look up sheet id, count pending rows.
  const projectRows = await db
    .select({ googleSheetId: pinValidatorProjects.googleSheetId })
    .from(pinValidatorProjects)
    .where(eq(pinValidatorProjects.id, opts.projectId))
    .limit(1);
  if (projectRows.length === 0) {
    throw new Error("Project not found.");
  }
  const sheetId = projectRows[0].googleSheetId;

  const { sheets } = await loadSheetsClient();
  const pending = await findPendingRows(sheets, sheetId);

  // Up-front quota guard. The runner will re-check periodically.
  const guard = await canGeocodeBatch(pending.length);
  if (!guard.ok && pending.length > 0) {
    // Insert the job anyway, in 'paused' status — the UI can show why.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(pinValidatorGeocodingJobs).values({
      id,
      projectId: opts.projectId,
      status: "paused",
      totalRows: pending.length,
      processedRows: 0,
      notFoundRows: 0,
      failedRows: 0,
      resting: false,
      cancelRequested: false,
      startedAt: now,
      lastHeartbeatAt: now,
      finishedAt: now,
      errorMessage: guard.reason || null,
      startedByUserId: opts.startedByUserId || null,
    });
    return { jobId: id, totalRows: pending.length };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(pinValidatorGeocodingJobs).values({
    id,
    projectId: opts.projectId,
    status: "queued",
    totalRows: pending.length,
    processedRows: 0,
    notFoundRows: 0,
    failedRows: 0,
    resting: false,
    cancelRequested: false,
    startedAt: now,
    lastHeartbeatAt: now,
    startedByUserId: opts.startedByUserId || null,
  });

  return { jobId: id, totalRows: pending.length };
}

// ─── Public API: the worker ──────────────────────────────────────────────

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the job to completion (or until killed by the platform / cancelled).
 * Safe to call multiple times for the same jobId — the second call will
 * see status='running' and exit early, OR if status='running' but the
 * heartbeat is stale, it resumes.
 */
export async function runGeocodingJob(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) {
    console.warn("[geocoder-job] job not found:", jobId);
    return;
  }
  if (
    job.status === "completed" ||
    job.status === "cancelled" ||
    job.status === "failed"
  ) {
    return; // terminal — nothing to do
  }

  // If another worker is already mid-run AND its heartbeat is fresh, exit.
  // Watchdog scenario: heartbeat stale → we take over.
  if (job.status === "running") {
    const last = new Date(job.lastHeartbeatAt).getTime();
    if (Date.now() - last < HEARTBEAT_STALE_MS) {
      return;
    }
    console.log(`[geocoder-job] taking over stale job ${jobId}`);
  }

  await patchJob(jobId, {
    status: "running",
    resting: false,
    restUntilMs: null,
    errorMessage: null,
    lastHeartbeatAt: new Date().toISOString(),
  });

  let projectId = job.projectId;
  let sheets: any;
  let apiKey: string;
  let sheetId: string;
  try {
    const projectRows = await db
      .select({ googleSheetId: pinValidatorProjects.googleSheetId })
      .from(pinValidatorProjects)
      .where(eq(pinValidatorProjects.id, projectId))
      .limit(1);
    if (projectRows.length === 0) {
      throw new Error("Project not found.");
    }
    sheetId = projectRows[0].googleSheetId;
    sheets = (await loadSheetsClient()).sheets;
    apiKey = await loadMapsApiKey();
  } catch (e: any) {
    await patchJob(jobId, {
      status: "failed",
      errorMessage: e?.message || String(e),
      finishedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    });
    return;
  }

  // We re-discover pending rows on resume — covers the case where the
  // user edited the Sheet between runs.
  const pending = await findPendingRows(sheets, sheetId);
  // Honor 'processedRows' as a starting point only conceptually; in practice
  // we just iterate the freshly-discovered pending list. If half were done
  // last run, only the still-pending ones come back here.
  let { processedRows, notFoundRows, failedRows } = job;
  let consecutive429 = 0;

  for (let i = 0; i < pending.length; i++) {
    // Cancel check — read fresh from DB so cancels propagate quickly.
    const live = await loadJob(jobId);
    if (!live || live.cancelRequested) {
      await patchJob(jobId, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        resting: false,
        restUntilMs: null,
        currentLocation: null,
      });
      return;
    }

    // Periodic quota recheck.
    if (i > 0 && i % QUOTA_RECHECK_EVERY === 0) {
      const g = await canGeocodeBatch(pending.length - i);
      if (!g.ok) {
        await patchJob(jobId, {
          status: "paused",
          errorMessage: g.reason || "Quota exhausted.",
          finishedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
          processedRows,
          notFoundRows,
          failedRows,
          resting: false,
          restUntilMs: null,
          currentLocation: null,
        });
        return;
      }
    }

    const { rowNumber, location } = pending[i];
    await heartbeat(jobId, {
      currentLocation: location,
      processedRows,
      notFoundRows,
      failedRows,
      resting: false,
      restUntilMs: null,
    });

    const result = await lookupOne(location, apiKey);
    if (result.ok) {
      const mapsUrl = `https://www.google.com/maps?q=${result.lat},${result.lng}`;
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
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `Pins!F${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Pending"]] },
      });
      processedRows++;
      consecutive429 = 0;
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
      notFoundRows++;
      consecutive429 = 0;
      await incrementUsage(1);
    } else if (result.httpStatus === 429) {
      // Rate-limited. Back off per the schedule.
      const backoff = BACKOFF_SCHEDULE_MS[consecutive429] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
      consecutive429++;
      if (consecutive429 > BACKOFF_SCHEDULE_MS.length) {
        await patchJob(jobId, {
          status: "failed",
          errorMessage: "Rate limited too aggressively by Places API. Please wait and retry.",
          finishedAt: new Date().toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
          processedRows,
          notFoundRows,
          failedRows,
          currentLocation: null,
          resting: false,
          restUntilMs: null,
        });
        return;
      }
      const restUntil = Date.now() + backoff;
      await patchJob(jobId, {
        resting: true,
        restUntilMs: restUntil,
        lastHeartbeatAt: new Date().toISOString(),
      });
      await SLEEP(backoff);
      // Retry this row — back up the index by 1.
      i--;
      continue;
    } else {
      // Other transport error — record + move on.
      failedRows++;
      consecutive429 = 0;
    }

    // Throttle between calls.
    if (i < pending.length - 1) {
      await SLEEP(THROTTLE_MS);

      // Politeness pause every N successful rows.
      const nextIndex = i + 1;
      if (nextIndex % POLITENESS_PAUSE_EVERY === 0) {
        const restUntil = Date.now() + POLITENESS_PAUSE_MS;
        await patchJob(jobId, {
          resting: true,
          restUntilMs: restUntil,
          lastHeartbeatAt: new Date().toISOString(),
          processedRows,
          notFoundRows,
          failedRows,
        });
        await SLEEP(POLITENESS_PAUSE_MS);
      }
    }
  }

  // Done.
  await patchJob(jobId, {
    status: "completed",
    finishedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    processedRows,
    notFoundRows,
    failedRows,
    currentLocation: null,
    resting: false,
    restUntilMs: null,
  });
}

// ─── Public API: status, cancel, watchdog ───────────────────────────────

export async function loadLatestJob(projectId: string): Promise<JobView | null> {
  const rows = await db
    .select()
    .from(pinValidatorGeocodingJobs)
    .where(eq(pinValidatorGeocodingJobs.projectId, projectId))
    .orderBy(desc(pinValidatorGeocodingJobs.startedAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.projectId,
    status: r.status as JobView["status"],
    totalRows: r.totalRows,
    processedRows: r.processedRows,
    notFoundRows: r.notFoundRows,
    failedRows: r.failedRows,
    currentLocation: r.currentLocation,
    resting: r.resting,
    restUntilMs: r.restUntilMs,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    errorMessage: r.errorMessage,
  };
}

export async function loadLatestCompletedJob(projectId: string): Promise<JobView | null> {
  const rows = await db
    .select()
    .from(pinValidatorGeocodingJobs)
    .where(
      and(
        eq(pinValidatorGeocodingJobs.projectId, projectId),
        eq(pinValidatorGeocodingJobs.status, "completed"),
      ),
    )
    .orderBy(desc(pinValidatorGeocodingJobs.finishedAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    projectId: r.projectId,
    status: r.status as JobView["status"],
    totalRows: r.totalRows,
    processedRows: r.processedRows,
    notFoundRows: r.notFoundRows,
    failedRows: r.failedRows,
    currentLocation: r.currentLocation,
    resting: r.resting,
    restUntilMs: r.restUntilMs,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    errorMessage: r.errorMessage,
  };
}

export async function requestCancel(jobId: string): Promise<void> {
  await patchJob(jobId, { cancelRequested: true });
}

/**
 * Watchdog: if the job is 'running' but its heartbeat is stale, the worker
 * was killed (platform recycle, network hiccup, etc.). Caller should
 * re-trigger the worker. Returns true if a stale state was detected so
 * the caller knows to re-trigger.
 */
export async function isJobStale(jobId: string): Promise<boolean> {
  const j = await loadJob(jobId);
  if (!j) return false;
  if (j.status !== "running") return false;
  const last = new Date(j.lastHeartbeatAt).getTime();
  return Date.now() - last > HEARTBEAT_STALE_MS;
}
