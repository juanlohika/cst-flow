/**
 * Push an RM's metrics into their own Google Sheet — one tab per month.
 *
 * Direction is ONE WAY: CST OS is the source of truth, the Sheet is a rendered
 * report. Nothing is ever read back. Two-way sync between a database and a
 * spreadsheet always drifts and you end up debugging which side is right; if
 * someone edits a pushed cell, the next push overwrites it, which is the
 * correct behaviour for a report.
 *
 * Layout mirrors the manual sheet's Courtesy Calls block so the numbers land
 * where people already look:
 *
 *   Account | Tier | Cadence | Planned CC | Completed | With MOM | Score
 *
 * Follows src/lib/accounts/sheets-sync.ts: create the file via the DRIVE api
 * (a service account cannot manipulate its own Drive root, so
 * sheets.spreadsheets.create + move fails), persist the id, verify it is still
 * writable on later runs.
 */
import { db } from "@/db";
import { globalSettings, users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { courtesyCallMetric } from "./courtesy-calls";

const SETTING_PREFIX = "METRICS_SHEET_ID_";     // + userId
const FOLDER_KEY = "GOOGLE_DRIVE_METRICS_FOLDER_ID";

type Cfg = { serviceAccountJson: string; folderId: string };

async function loadCfg(): Promise<Cfg | null> {
  const rows = await db.select().from(globalSettings);
  const map = new Map(rows.map(r => [r.key, r.value ?? ""]));
  const serviceAccountJson =
    map.get("GOOGLE_SERVICE_ACCOUNT_JSON") || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  // Falls back to the dashboards folder so this works with existing config.
  const folderId =
    map.get(FOLDER_KEY) || process.env.GOOGLE_DRIVE_METRICS_FOLDER_ID ||
    map.get("GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID") || "";
  if (!serviceAccountJson || !folderId) return null;
  return { serviceAccountJson, folderId };
}

async function clients(cfg: Cfg) {
  const { google } = await import("googleapis");
  const credentials = JSON.parse(cfg.serviceAccountJson);
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
    email: credentials.client_email as string,
  };
}

async function saveSheetId(userId: string, sheetId: string) {
  const key = SETTING_PREFIX + userId;
  const now = new Date().toISOString();
  const existing = await db.select().from(globalSettings).where(eq(globalSettings.key, key)).limit(1);
  if (existing[0]) {
    await db.update(globalSettings).set({ value: sheetId, updatedAt: now } as any)
      .where(eq(globalSettings.id, existing[0].id));
  } else {
    await db.insert(globalSettings).values({
      id: `gs_${key}`, key, value: sheetId, createdAt: now, updatedAt: now,
    } as any);
  }
}

function monthTab(month: string) {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1))
    .toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return name;   // "Aug 2026" — matches the manual workbook's tab naming
}

export async function pushMetricsToSheet(args: {
  userId: string;
  month: string;                 // YYYY-MM
}): Promise<{ ok: boolean; sheetId?: string; sheetUrl?: string; tab?: string; rows?: number; created?: boolean; reason?: string }> {
  const cfg = await loadCfg();
  if (!cfg) {
    return { ok: false, reason: `Metrics Sheets not configured. Set ${FOLDER_KEY} in GlobalSetting and share that folder with the service account.` };
  }

  const who = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, args.userId)).limit(1);
  if (!who[0]) return { ok: false, reason: "User not found" };
  const personName = who[0].name || who[0].email || args.userId;

  const cc = await courtesyCallMetric({ rmUserId: args.userId, month: args.month });
  const { drive, sheets, email } = await clients(cfg);

  // Resolve (or create) this person's workbook.
  const key = SETTING_PREFIX + args.userId;
  const stored = await db.select().from(globalSettings).where(eq(globalSettings.key, key)).limit(1);
  let sheetId: string | null = stored[0]?.value || null;
  let created = false;

  if (sheetId) {
    // A cached id that is gone or unwritable must not fail the whole push.
    try {
      const v = await drive.files.get({
        fileId: sheetId, fields: "id, capabilities/canEdit", supportsAllDrives: true,
      });
      if (!v.data.capabilities?.canEdit) sheetId = null;
    } catch { sheetId = null; }
  }

  if (!sheetId) {
    const made = await drive.files.create({
      requestBody: {
        name: `${personName} — CST Metrics ${args.month.slice(0, 4)}`,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [cfg.folderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    sheetId = made.data.id!;
    if (!sheetId) throw new Error("Drive did not return an id for the new Sheet");
    await saveSheetId(args.userId, sheetId);
    created = true;
  }

  // Ensure the month tab exists. A new month = a new tab, which is what the
  // manual workbook does (Feb 2026, Mar 2026, …).
  const tab = monthTab(args.month);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existingTabs = (meta.data.sheets || []).map(s => s.properties?.title).filter(Boolean) as string[];
  if (!existingTabs.includes(tab)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  // Drop the default "Sheet1" only once our own tab exists, so the workbook is
  // never left with zero sheets (the API rejects that).
  if (created) {
    const m2 = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const def = (m2.data.sheets || []).find(s => s.properties?.title === "Sheet1");
    if (def?.properties?.sheetId != null && (m2.data.sheets || []).length > 1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: def.properties.sheetId } }] },
      });
    }
  }

  const pct = (n: number) => Math.round(n * 10000) / 100;   // 2dp percentage
  const values: any[][] = [
    [`${personName} — Courtesy Calls`, "", "", "", "", "", ""],
    [`Month`, tab, "", "Pushed from CST OS", new Date().toISOString().slice(0, 16).replace("T", " "), "", ""],
    [],
    ["Account", "Tier", "Cadence", "Planned CC", "Completed", "With MOM", "Score %"],
    ...cc.accounts.map(a => [
      a.accountName, a.tier || "", a.cadence, a.planned, a.completed, a.compliant, pct(a.score),
    ]),
    [],
    ["TOTAL", "", "", cc.planned, cc.completed, cc.compliant, pct(cc.score)],
    ["Weighted contribution", "", "", "", "", "", pct(cc.weightedScore)],
    ["Area weight", "", "", "", "", "", pct(cc.weight)],
  ];
  if (cc.excludedNoTier.length) {
    values.push([], [
      `${cc.excludedNoTier.length} account(s) excluded — no tier set, so no target to score against`,
      cc.excludedNoTier.join(", "),
    ]);
  }

  // Clear then write, so a shrinking account list cannot leave stale rows behind.
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${tab}!A1:Z400` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  return {
    ok: true, sheetId, tab, created,
    rows: cc.accounts.length,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
  };
}

/** Every RM holding primary membership — the weekly cron's target set. */
export async function pushAllMetrics(month: string): Promise<{
  pushed: number; failed: Array<{ user: string; reason: string }>;
}> {
  const { accountMemberships } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const rms = await db
    .selectDistinct({ userId: accountMemberships.userId })
    .from(accountMemberships)
    .where(eq(accountMemberships.isPrimary, true));

  let pushed = 0;
  const failed: Array<{ user: string; reason: string }> = [];
  for (const rm of rms) {
    try {
      const r = await pushMetricsToSheet({ userId: rm.userId, month });
      if (r.ok) pushed++;
      else failed.push({ user: rm.userId, reason: r.reason || "unknown" });
    } catch (e: any) {
      failed.push({ user: rm.userId, reason: e?.message || String(e) });
    }
  }
  return { pushed, failed };
}
