/**
 * Phase D+ — Live Google Sheet sync for the Executive Summary.
 *
 * Creates (first run) or updates (subsequent runs) a Google Sheet in the
 * configured Dashboards Drive folder. The sheetId is persisted to
 * globalSettings so the same Sheet is reused across syncs — meaning CEO can
 * bookmark a stable URL.
 *
 * Three tabs:
 *   1. Portfolio Overview — counts, distributions, top tools, AI summary
 *   2. Accounts            — one row per account (lean column set)
 *   3. Critical Accounts   — just red rows with their reasons
 *
 * Triggered:
 *   - Automatically (fire-and-forget) from POST /api/accounts/[id]/assessments
 *     after the assessment is saved (and the AI rollup is queued).
 *   - Manually from /admin/executive-summary via "Sync to Google Sheet" button.
 *
 * Failure is non-fatal — sync errors are logged but never block the originating
 * action. Manual sync surfaces the error to the user.
 */
import { db } from "@/db";
import { globalSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildExecutiveSummary, clusterThemes, type ExecutiveSummary, type AccountSnapshot } from "./executive-summary";
import { HEALTH_COLORS } from "./health-score";

interface SheetsConfig {
  serviceAccountJson: string;
  dashboardsFolderId: string;
  sheetId: string | null;       // persisted; null on first run
}

const APP_URL = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "https://cst-flow--cst-flowdesk.asia-east1.hosted.app";
const SHEET_TITLE = "Account Health · Live Dashboard";
const SETTING_KEY_DASHBOARDS_FOLDER = "GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID";
const SETTING_KEY_SHEET_ID = "GOOGLE_ACCOUNT_HEALTH_SHEET_ID";

export async function loadSheetsConfig(): Promise<SheetsConfig | null> {
  const rows = await db.select().from(globalSettings);
  const map = new Map(rows.map((r: any) => [r.key, r.value]));

  const serviceAccountJson = map.get("GOOGLE_SERVICE_ACCOUNT_JSON") || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  const dashboardsFolderId = map.get(SETTING_KEY_DASHBOARDS_FOLDER) || process.env.GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID || "";
  const sheetId = map.get(SETTING_KEY_SHEET_ID) || null;

  if (!serviceAccountJson || !dashboardsFolderId) return null;
  return { serviceAccountJson, dashboardsFolderId, sheetId };
}

async function saveSheetId(sheetId: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.select({ id: globalSettings.id })
    .from(globalSettings)
    .where(eq(globalSettings.key, SETTING_KEY_SHEET_ID))
    .limit(1);
  if (existing.length > 0) {
    await db.update(globalSettings).set({ value: sheetId, updatedAt: now }).where(eq(globalSettings.id, existing[0].id));
  } else {
    await db.insert(globalSettings).values({
      id: `gs_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      key: SETTING_KEY_SHEET_ID,
      value: sheetId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export interface SyncResult {
  ok: boolean;
  sheetId?: string;
  sheetUrl?: string;
  created?: boolean;
  error?: string;
}

export async function syncExecutiveSummaryToSheet(opts: { includeAi?: boolean } = {}): Promise<SyncResult> {
  let step = "init";
  try {
    return await _syncImpl(opts, (s: string) => { step = s; });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const code = e?.code || e?.status || "";
    console.error("[sheets-sync] failed at step:", step, "code:", code, msg);
    return { ok: false, error: `${msg} (step: ${step}${code ? `, code: ${code}` : ""})` };
  }
}

async function _syncImpl(opts: { includeAi?: boolean }, setStep: (s: string) => void): Promise<SyncResult> {
  setStep("load-config");
  const cfg = await loadSheetsConfig();
  if (!cfg) {
    return { ok: false, error: "Dashboards Sheet sync is not configured. Add GOOGLE_DRIVE_DASHBOARDS_FOLDER_ID in admin settings." };
  }

  let credentials: any;
  try {
    credentials = JSON.parse(cfg.serviceAccountJson);
  } catch (e: any) {
    return { ok: false, error: `Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e?.message}` };
  }

  setStep("build-summary");
  const summary = await buildExecutiveSummary();
  if (opts.includeAi) {
    try { await clusterThemes(summary); } catch { /* non-fatal */ }
  }

  setStep("authorize");
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

  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  setStep("verify-dashboards-folder");
  try {
    await drive.files.get({
      fileId: cfg.dashboardsFolderId,
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
  } catch (folderErr: any) {
    const code = folderErr?.code || folderErr?.status;
    if (code === 404) {
      return { ok: false, error: `Service account can't see the Dashboards folder (${cfg.dashboardsFolderId}). Share it with ${credentials.client_email} as Editor.` };
    }
    if (code === 403) {
      return { ok: false, error: `Service account lacks Editor permission on the Dashboards folder.` };
    }
    throw folderErr;
  }

  // Resolve or create the spreadsheet
  setStep("verify-cached-sheet");
  let sheetId = cfg.sheetId;
  let created = false;

  if (sheetId) {
    // Verify it still exists AND the service account can write to it.
    // If the previous sync got stuck in a bad state (e.g. Sheet exists but
    // outside the dashboards folder), fall through and create a fresh one.
    try {
      const verify = await drive.files.get({
        fileId: sheetId,
        fields: "id, parents, capabilities/canEdit",
        supportsAllDrives: true,
      });
      const canEdit = verify.data.capabilities?.canEdit;
      const parents = verify.data.parents || [];
      const inDashboardsFolder = parents.includes(cfg.dashboardsFolderId);
      if (!canEdit || !inDashboardsFolder) {
        // Either we can't write to it or it lives elsewhere. Drop the cached
        // id and create a new Sheet in the right place.
        console.warn("[sheets-sync] cached sheetId is unusable (canEdit=" + canEdit + ", inDashboardsFolder=" + inDashboardsFolder + "). Creating a fresh Sheet.");
        sheetId = null;
      }
    } catch (e: any) {
      if (e?.code === 404 || e?.status === 404 || e?.code === 403 || e?.status === 403) {
        sheetId = null;
      } else {
        throw e;
      }
    }
  }

  if (!sheetId) {
    setStep("create-sheet-in-folder");
    // Create the Sheet directly inside the dashboards folder via the Drive
    // API. This avoids the "service accounts can't manipulate their own
    // root" problem we'd hit with sheets.spreadsheets.create + later move.
    const created_ = await drive.files.create({
      requestBody: {
        name: SHEET_TITLE,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [cfg.dashboardsFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    sheetId = created_.data.id!;
    if (!sheetId) throw new Error("Drive didn't return an id for the new Sheet");

    setStep("setup-tabs");
    // Add the required tabs (the Drive-created Sheet starts with one
    // default "Sheet1" — we'll add ours then delete the default).
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const defaultSheet = meta.data.sheets?.[0]?.properties;
    const tabsToCreate = ["Portfolio Overview", "Accounts", "Critical Accounts", "By Tier", "By RM", "By Group"];
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          ...tabsToCreate.map(title => ({ addSheet: { properties: { title } } })),
          ...(defaultSheet?.sheetId != null
            ? [{ deleteSheet: { sheetId: defaultSheet.sheetId } }]
            : []),
        ],
      },
    });

    await saveSheetId(sheetId);
    created = true;
  } else {
    // Make sure the three tabs exist (no-op if they do)
    const existing = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const existingTitles = new Set((existing.data.sheets || []).map(s => s.properties?.title));
    const required = ["Portfolio Overview", "Accounts", "Critical Accounts", "By Tier", "By RM", "By Group"];
    const addRequests = required.filter(t => !existingTitles.has(t)).map(t => ({ addSheet: { properties: { title: t } } }));
    if (addRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: addRequests },
      });
    }
  }

  setStep("write-tabs");
  // Build rows for each tab
  const overviewRows = buildOverviewRows(summary);
  const accountRows = buildAccountRows(summary);
  const criticalRows = buildCriticalRows(summary);
  const tierRows = buildTierBreakdownRows(summary);
  const rmRows = buildRmBreakdownRows(summary);
  const groupRows = buildGroupBreakdownRows(summary);

  // Clear + write each tab. Using values.update with a range that covers
  // the full sheet width and clearing first via values.clear is the
  // simplest way to reset without trimming columns we just wrote.
  const tabs = [
    { range: "Portfolio Overview!A1:Z200", values: overviewRows },
    { range: "Accounts!A1:Z2000", values: accountRows },
    { range: "Critical Accounts!A1:Z2000", values: criticalRows },
    { range: "By Tier!A1:Z200", values: tierRows },
    { range: "By RM!A1:Z500", values: rmRows },
    { range: "By Group!A1:Z500", values: groupRows },
  ];

  for (const { range } of tabs) {
    try {
      await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range });
    } catch { /* non-fatal — write below will still overwrite */ }
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: tabs.map(t => ({
        range: t.range.replace(/!.*$/, `!A1`),
        majorDimension: "ROWS",
        values: t.values,
      })),
    },
  });

  // Freeze header rows on first creation. Idempotent across re-runs.
  if (created) {
    try {
      const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const tabsToFreeze = ["Portfolio Overview", "Accounts", "Critical Accounts", "By Tier", "By RM", "By Group"];
      const requests: any[] = [];
      for (const tab of tabsToFreeze) {
        const sheetIdNum = (sheetMeta.data.sheets || []).find(s => s.properties?.title === tab)?.properties?.sheetId;
        if (typeof sheetIdNum === "number") {
          requests.push({
            updateSheetProperties: {
              properties: { sheetId: sheetIdNum, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          });
        }
      }
      if (requests.length > 0) {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests } });
      }
    } catch {
      // Non-fatal — sheet still has the data, just no freeze.
    }
  }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  return { ok: true, sheetId, sheetUrl, created };
}

// ─── Row builders ──────────────────────────────────────────────────────────

function buildOverviewRows(s: ExecutiveSummary): any[][] {
  const generated = new Date(s.generatedAt).toLocaleString();
  const rows: any[][] = [];

  rows.push(["Account Health · Live Dashboard"]);
  rows.push([`Generated: ${generated}`]);
  rows.push([`Total accounts: ${s.totalAccounts} · Assessed: ${s.assessed} · Unassessed: ${s.unassessed}`]);
  rows.push([]);

  rows.push(["Portfolio Health"]);
  rows.push(["Status", "Count", "% of portfolio"]);
  rows.push(["🔴 Critical", s.redCount, percent(s.redCount, s.totalAccounts)]);
  rows.push(["🟡 Watch", s.yellowCount, percent(s.yellowCount, s.totalAccounts)]);
  rows.push(["🟢 Healthy", s.greenCount, percent(s.greenCount, s.totalAccounts)]);
  rows.push(["⚪ Unassessed", s.greyCount, percent(s.greyCount, s.totalAccounts)]);
  if (s.criticalCount > 0) {
    rows.push([`⚠ ${s.criticalCount} account(s) flagged by critical override (low EBA, SSOT displaced, etc.)`]);
  }
  rows.push([]);

  if (s.aiPortfolioSummary) {
    rows.push(["Executive Summary (AI)"]);
    rows.push([s.aiPortfolioSummary]);
    rows.push([]);
  }

  if (s.aiTopRisks && s.aiTopRisks.length > 0) {
    rows.push(["Top Risks Across Portfolio"]);
    for (const r of s.aiTopRisks) rows.push([`• ${r}`]);
    rows.push([]);
  }

  if (s.aiTopOpportunities && s.aiTopOpportunities.length > 0) {
    rows.push(["Top Opportunities Across Portfolio"]);
    for (const o of s.aiTopOpportunities) rows.push([`• ${o}`]);
    rows.push([]);
  }

  rows.push(["Score Distributions"]);
  rows.push(["Score", "1", "2", "3", "4", "5"]);
  rows.push(["EBA — Decision Maker", ...s.ebaDMDistribution]);
  rows.push(["EBA — Admin", ...s.ebaAdminDistribution]);
  rows.push(["V5 Readiness", ...s.v5Distribution]);
  rows.push([]);

  rows.push(["System of Record"]);
  rows.push(["Status", "Count"]);
  rows.push(["Tarkie is SSOT", s.ssotTarkie]);
  rows.push(["Displaced by third-party", s.ssotThirdParty]);
  rows.push(["Unknown / unassessed", s.ssotUnknown]);
  if (s.thirdPartyTools.length > 0) {
    rows.push([]);
    rows.push(["Tools displacing Tarkie"]);
    rows.push(["Tool", "Account count"]);
    for (const t of s.thirdPartyTools) rows.push([t.tool, t.count]);
  }
  rows.push([]);

  if (s.topRequestedModules.length > 0) {
    rows.push(["Top Requested Modules"]);
    rows.push(["Module", "Requested by"]);
    for (const m of s.topRequestedModules) rows.push([m.module, m.count]);
    rows.push([]);
  }

  // Courtesy Call Compliance summary
  if (s.complianceCounts) {
    rows.push(["Courtesy Call Compliance"]);
    rows.push(["Status", "Accounts"]);
    rows.push(["✓ Compliant", s.complianceCounts.compliant]);
    rows.push(["⚠ Warning", s.complianceCounts.warning]);
    rows.push(["⌛ Overdue", s.complianceCounts.overdue]);
    rows.push(["? Unknown", s.complianceCounts.unknown]);
    rows.push([`Detailed breakdowns: see "By Tier", "By RM", and "By Group" tabs`]);
  }

  return rows;
}

function buildAccountRows(s: ExecutiveSummary): any[][] {
  const rows: any[][] = [];
  // Header
  rows.push([
    "Health",
    "Score",
    "Account",
    "Tier",
    "Group",
    "Industry",
    "Engagement",
    "Primary RM",
    "RM Email",
    "EBA-DM",
    "EBA-Admin",
    "Satisfaction",
    "V5 Readiness",
    "SSOT",
    "Last Assessed",
    "Last Courtesy Call",
    "Compliance",
    "Days Since Call",
    "Frequency",
    "Link",
  ]);
  // Data rows
  for (const a of s.accounts) {
    rows.push(buildAccountRow(a));
  }
  return rows;
}

function buildCriticalRows(s: ExecutiveSummary): any[][] {
  const rows: any[][] = [];
  rows.push([
    "Account",
    "Industry",
    "Primary RM",
    "Score",
    "Reasons",
    "AI Summary",
    "Link",
  ]);
  for (const a of s.accounts.filter(x => x.health.color === "red")) {
    rows.push([
      a.companyName,
      a.industry,
      a.primaryRmName || "—",
      a.health.score,
      a.health.reasons.join(" · "),
      a.aiSummary || "",
      accountLink(a.accountId),
    ]);
  }
  return rows;
}

function buildAccountRow(a: AccountSnapshot): any[] {
  const daysSinceAssessment = a.lastAssessedAt
    ? Math.floor((Date.now() - new Date(a.lastAssessedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  return [
    healthLabel(a.health.color),
    a.health.color === "grey" ? "" : a.health.score,
    a.companyName,
    a.tier || "—",
    a.groupName || "—",
    a.industry,
    a.engagementStatus,
    a.primaryRmName || "—",
    a.primaryRmEmail || a.rmEmail || "",
    a.ebaDecisionMaker ?? "",
    a.ebaAdmin ?? "",
    a.satisfaction ?? "",
    a.v5Readiness ?? "",
    ssotLabel(a.isTarkieSsot, a.thirdPartySsot),
    a.lastAssessedAt ? new Date(a.lastAssessedAt).toLocaleDateString() : "—",
    a.lastCourtesyCall ? new Date(a.lastCourtesyCall).toLocaleDateString() : "—",
    complianceLabel(a.complianceStatus),
    a.daysSinceCall === null || a.daysSinceCall === undefined ? "" : a.daysSinceCall,
    a.frequencyLabel || "—",
    accountLink(a.accountId),
  ];
}

function buildTierBreakdownRows(s: ExecutiveSummary): any[][] {
  const rows: any[][] = [];
  rows.push(["Tier", "Accounts", "Avg Score", "🟢 Healthy", "🟡 Watch", "🔴 Critical", "⚪ Unassessed", "✓ Compliant", "⚠ Warning", "⌛ Overdue", "? Unknown"]);
  for (const r of s.byTier || []) {
    rows.push([
      r.tier === "Unset" ? "Unset" : r.tier === "VIP" ? "VIP" : `Tier ${r.tier}`,
      r.accountCount,
      r.avgScore ?? "—",
      r.health.green, r.health.yellow, r.health.red, r.health.grey,
      r.compliance.compliant, r.compliance.warning, r.compliance.overdue, r.compliance.unknown,
    ]);
  }
  return rows;
}

function buildRmBreakdownRows(s: ExecutiveSummary): any[][] {
  const rows: any[][] = [];
  rows.push(["RM", "Email", "Accounts", "Avg Score", "🟢 Healthy", "🟡 Watch", "🔴 Critical", "⚪ Unassessed", "✓ Compliant", "⚠ Warning", "⌛ Overdue", "? Unknown"]);
  for (const r of s.byRm || []) {
    rows.push([
      r.rmName || "(unknown user)",
      r.rmEmail,
      r.accountCount,
      r.avgScore ?? "—",
      r.health.green, r.health.yellow, r.health.red, r.health.grey,
      r.compliance.compliant, r.compliance.warning, r.compliance.overdue, r.compliance.unknown,
    ]);
  }
  return rows;
}

function buildGroupBreakdownRows(s: ExecutiveSummary): any[][] {
  const rows: any[][] = [];
  rows.push(["Group", "Worst Color", "Accounts", "Avg Score", "Members", "🟢", "🟡", "🔴", "⚪", "✓", "⚠", "⌛", "?"]);
  for (const r of s.byGroup || []) {
    const memberList = r.members.join(", ") + (r.accountCount > r.members.length ? ` (+${r.accountCount - r.members.length} more)` : "");
    rows.push([
      r.groupName,
      colorEmoji(r.worstColor),
      r.accountCount,
      r.rollupScore ?? "—",
      memberList,
      r.health.green, r.health.yellow, r.health.red, r.health.grey,
      r.compliance.compliant, r.compliance.warning, r.compliance.overdue, r.compliance.unknown,
    ]);
  }
  return rows;
}

function complianceLabel(status: string | undefined): string {
  switch (status) {
    case "compliant": return "✓ Compliant";
    case "warning": return "⚠ Warning";
    case "overdue": return "⌛ Overdue";
    default: return "—";
  }
}

function colorEmoji(color: string): string {
  switch (color) {
    case "red": return "🔴 Critical";
    case "yellow": return "🟡 Watch";
    case "green": return "🟢 Healthy";
    default: return "⚪ Unassessed";
  }
}

function healthLabel(color: string): string {
  switch (color) {
    case "red": return "🔴 Critical";
    case "yellow": return "🟡 Watch";
    case "green": return "🟢 Healthy";
    default: return "⚪ Unassessed";
  }
}

function ssotLabel(isTarkieSsot: boolean | null | undefined, thirdPartySsot: string | null | undefined): string {
  if (isTarkieSsot === true) return "✓ Tarkie";
  if (isTarkieSsot === false) {
    return thirdPartySsot ? `⚠ ${thirdPartySsot}` : "⚠ Third-party";
  }
  return "—";
}

function accountLink(accountId: string): string {
  return `${APP_URL}/accounts/${accountId}`;
}

function percent(n: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((n / total) * 100)}%`;
}

