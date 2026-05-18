/**
 * Phase D — Executive Summary aggregator.
 *
 * Builds the CEO-facing portfolio snapshot from accountAssessments +
 * clientProfiles. Pure data assembly (no AI calls). AI clustering of
 * top risks / top opportunities is a separate pass via clusterThemes().
 *
 * Used by:
 *   - GET /api/admin/executive-summary          → interactive page
 *   - POST /api/admin/executive-summary/export  → PDF/.docx export
 */
import { db } from "@/db";
import {
  accountAssessments,
  clientProfiles,
  accountMemberships,
  users,
} from "@/db/schema";
import { desc, eq, inArray, and } from "drizzle-orm";
import { computeHealth, type HealthResult, type HealthColor } from "./health-score";
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import { loadTierFrequencyMap, resolveAccountFrequency, callCompliance } from "./tier-frequency";

export interface AccountSnapshot {
  accountId: string;
  companyName: string;
  industry: string;
  engagementStatus: string;
  primaryRmName: string | null;
  primaryRmEmail: string | null;
  health: HealthResult;
  lastAssessedAt: string | null;
  aiSummary: string | null;
  topRisks: string[];
  topOpportunities: string[];
  notableRequests: string[];
  requestedModules: string[];
  satisfaction: number | null;
  ebaDecisionMaker: number | null;
  ebaAdmin: number | null;
  v5Readiness: number | null;
  isTarkieSsot: boolean | null;
  thirdPartySsot: string | null;
  contactChangeRecent: boolean;
  // Phase E — CRM fields
  clientShortName: string | null;
  clientLongName: string | null;
  groupName: string | null;
  tier: string | null;
  groupTier: string | null;
  rmEmail: string | null;
  pmEmail: string | null;
  baEmail: string | null;
  assignedOnMonth: string | null;
  lastCourtesyCall: string | null;
  // Compliance (derived)
  frequencyLabel: string;
  complianceStatus: "compliant" | "warning" | "overdue" | "unknown";
  daysSinceCall: number | null;
}

export interface ColorCounts {
  green: number;
  yellow: number;
  red: number;
  grey: number;
  critical: number;
}

export interface ComplianceCounts {
  compliant: number;
  warning: number;
  overdue: number;
  unknown: number;
}

export interface TierBreakdownRow {
  tier: string;                // 'VIP' | '1'..'5' | 'Unset'
  accountCount: number;
  health: ColorCounts;
  compliance: ComplianceCounts;
  avgScore: number | null;     // mean health score across this tier
}

export interface GroupBreakdownRow {
  groupName: string;
  accountCount: number;
  health: ColorCounts;
  compliance: ComplianceCounts;
  worstColor: HealthColor;     // any red → group is red; else any yellow → yellow; etc.
  rollupScore: number | null;  // avg health score
  members: string[];           // child account names (top 5)
}

export interface RmBreakdownRow {
  rmEmail: string;
  rmName: string | null;       // resolved from users table if email matches
  accountCount: number;
  health: ColorCounts;
  compliance: ComplianceCounts;
  avgScore: number | null;
}

export interface ExecutiveSummary {
  generatedAt: string;
  // Portfolio totals
  totalAccounts: number;
  assessed: number;
  unassessed: number;
  // Color counts
  greenCount: number;
  yellowCount: number;
  redCount: number;
  greyCount: number;
  criticalCount: number;
  // EBA distribution
  ebaDMDistribution: number[];     // index 0..4 = counts for scores 1..5
  ebaAdminDistribution: number[];
  // V5 readiness
  v5Distribution: number[];
  // SSOT
  ssotTarkie: number;
  ssotThirdParty: number;
  ssotUnknown: number;
  thirdPartyTools: Array<{ tool: string; count: number }>;
  // Top requested modules
  topRequestedModules: Array<{ module: string; count: number }>;
  // Phase E — compliance + breakdowns
  complianceCounts: ComplianceCounts;
  byTier: TierBreakdownRow[];
  byGroup: GroupBreakdownRow[];
  byRm: RmBreakdownRow[];
  // Account snapshots (every account, sorted: critical → unassessed → yellow → green)
  accounts: AccountSnapshot[];
  // AI clustering — populated when clusterThemes() runs separately
  aiTopRisks?: string[];
  aiTopOpportunities?: string[];
  aiPortfolioSummary?: string;
  aiClusteringError?: string;
}

export async function buildExecutiveSummary(): Promise<ExecutiveSummary> {
  // Load tier-frequency map once (used in compliance calculation)
  const tierMap = await loadTierFrequencyMap();

  // 1. Load every active account (with CRM fields)
  const allAccounts = await db.select({
    id: clientProfiles.id,
    companyName: clientProfiles.companyName,
    industry: clientProfiles.industry,
    engagementStatus: clientProfiles.engagementStatus,
    clientShortName: clientProfiles.clientShortName,
    clientLongName: clientProfiles.clientLongName,
    groupName: clientProfiles.groupName,
    tier: clientProfiles.tier,
    groupTier: clientProfiles.groupTier,
    frequencyOverride: clientProfiles.frequencyOverride,
    rmEmail: clientProfiles.rmEmail,
    pmEmail: clientProfiles.pmEmail,
    baEmail: clientProfiles.baEmail,
    assignedOnMonth: clientProfiles.assignedOnMonth,
    lastCourtesyCall: clientProfiles.lastCourtesyCall,
  }).from(clientProfiles);

  // 2. Load latest assessment per account (group + take first via ordering)
  const allAssessments = await db.select({
    id: accountAssessments.id,
    clientProfileId: accountAssessments.clientProfileId,
    submittedAt: accountAssessments.submittedAt,
    satisfaction: accountAssessments.satisfaction,
    ebaDecisionMaker: accountAssessments.ebaDecisionMaker,
    ebaAdmin: accountAssessments.ebaAdmin,
    v5Readiness: accountAssessments.v5Readiness,
    isTarkieSsot: accountAssessments.isTarkieSsot,
    thirdPartySsot: accountAssessments.thirdPartySsot,
    contactChangeRecent: accountAssessments.contactChangeRecent,
    aiSummary: accountAssessments.aiSummary,
    aiRisks: accountAssessments.aiRisks,
    aiOpportunities: accountAssessments.aiOpportunities,
    notableRequests: accountAssessments.notableRequests,
    requestedModules: accountAssessments.requestedModules,
  })
  .from(accountAssessments)
  .orderBy(desc(accountAssessments.submittedAt));

  const latestByAccount = new Map<string, typeof allAssessments[number]>();
  for (const a of allAssessments) {
    if (!latestByAccount.has(a.clientProfileId)) {
      latestByAccount.set(a.clientProfileId, a);
    }
  }

  // 3. Load primary RM per account
  const primaries = await db.select({
    clientProfileId: accountMemberships.clientProfileId,
    rmUserId: accountMemberships.userId,
  })
  .from(accountMemberships)
  .where(eq(accountMemberships.isPrimary, true));
  const primaryByAccount = new Map(primaries.map(p => [p.clientProfileId, p.rmUserId]));

  const rmIds = Array.from(new Set(primaries.map(p => p.rmUserId)));
  const rmRows = rmIds.length > 0
    ? await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, rmIds))
    : [];
  const rmById = new Map(rmRows.map(u => [u.id, u]));

  // 4. Build the snapshots
  const snapshots: AccountSnapshot[] = [];

  // Counters
  let greenCount = 0, yellowCount = 0, redCount = 0, greyCount = 0, criticalCount = 0;
  const ebaDMDist = [0, 0, 0, 0, 0];
  const ebaAdminDist = [0, 0, 0, 0, 0];
  const v5Dist = [0, 0, 0, 0, 0];
  let ssotTarkie = 0, ssotThirdParty = 0, ssotUnknown = 0;
  const thirdPartyToolCounts = new Map<string, number>();
  const requestedModuleCounts = new Map<string, number>();

  for (const account of allAccounts) {
    const latest = latestByAccount.get(account.id) || null;
    const health = computeHealth(latest ? {
      satisfaction: latest.satisfaction,
      ebaDecisionMaker: latest.ebaDecisionMaker,
      ebaAdmin: latest.ebaAdmin,
      v5Readiness: latest.v5Readiness,
      isTarkieSsot: latest.isTarkieSsot,
      thirdPartySsot: latest.thirdPartySsot,
      contactChangeRecent: latest.contactChangeRecent,
    } : null);

    // Update counts
    switch (health.color) {
      case "green": greenCount++; break;
      case "yellow": yellowCount++; break;
      case "red": redCount++; if (health.isCritical) criticalCount++; break;
      case "grey": greyCount++; break;
    }

    if (latest) {
      if (typeof latest.ebaDecisionMaker === "number" && latest.ebaDecisionMaker >= 1 && latest.ebaDecisionMaker <= 5) {
        ebaDMDist[latest.ebaDecisionMaker - 1]++;
      }
      if (typeof latest.ebaAdmin === "number" && latest.ebaAdmin >= 1 && latest.ebaAdmin <= 5) {
        ebaAdminDist[latest.ebaAdmin - 1]++;
      }
      if (typeof latest.v5Readiness === "number" && latest.v5Readiness >= 1 && latest.v5Readiness <= 5) {
        v5Dist[latest.v5Readiness - 1]++;
      }
      if (latest.isTarkieSsot === true) ssotTarkie++;
      else if (latest.isTarkieSsot === false) {
        ssotThirdParty++;
        const tool = (latest.thirdPartySsot || "").trim();
        if (tool) {
          thirdPartyToolCounts.set(tool, (thirdPartyToolCounts.get(tool) || 0) + 1);
        }
      } else ssotUnknown++;

      const mods = safeJsonArray(latest.requestedModules);
      for (const m of mods) {
        const norm = String(m).trim();
        if (norm) {
          requestedModuleCounts.set(norm, (requestedModuleCounts.get(norm) || 0) + 1);
        }
      }
    } else {
      ssotUnknown++;
    }

    const primaryRmId = primaryByAccount.get(account.id);
    const rm = primaryRmId ? rmById.get(primaryRmId) : null;

    // Compliance derived from tier + last courtesy call
    const freq = resolveAccountFrequency({
      tier: (account as any).tier || null,
      frequencyOverride: (account as any).frequencyOverride || null,
      tierMap,
    });
    const compliance = callCompliance({
      lastCourtesyCall: (account as any).lastCourtesyCall || null,
      frequencyDays: freq.days,
    });

    snapshots.push({
      accountId: account.id,
      companyName: account.companyName,
      industry: account.industry,
      engagementStatus: account.engagementStatus,
      primaryRmName: rm?.name || null,
      primaryRmEmail: rm?.email || null,
      health,
      lastAssessedAt: latest?.submittedAt || null,
      aiSummary: latest?.aiSummary || null,
      topRisks: safeJsonArray(latest?.aiRisks),
      topOpportunities: safeJsonArray(latest?.aiOpportunities),
      notableRequests: safeJsonArray(latest?.notableRequests),
      requestedModules: safeJsonArray(latest?.requestedModules),
      satisfaction: latest?.satisfaction ?? null,
      ebaDecisionMaker: latest?.ebaDecisionMaker ?? null,
      ebaAdmin: latest?.ebaAdmin ?? null,
      v5Readiness: latest?.v5Readiness ?? null,
      isTarkieSsot: latest?.isTarkieSsot ?? null,
      thirdPartySsot: latest?.thirdPartySsot || null,
      contactChangeRecent: !!latest?.contactChangeRecent,
      // CRM fields
      clientShortName: (account as any).clientShortName || null,
      clientLongName: (account as any).clientLongName || null,
      groupName: (account as any).groupName || null,
      tier: (account as any).tier || null,
      groupTier: (account as any).groupTier || null,
      rmEmail: (account as any).rmEmail || null,
      pmEmail: (account as any).pmEmail || null,
      baEmail: (account as any).baEmail || null,
      assignedOnMonth: (account as any).assignedOnMonth || null,
      lastCourtesyCall: (account as any).lastCourtesyCall || null,
      frequencyLabel: freq.label,
      complianceStatus: compliance.status,
      daysSinceCall: compliance.daysSince,
    });
  }

  // 5. Sort: critical (red) first, then grey (unassessed), then yellow, then green
  // Within each bucket, sort by score ascending (most-needs-attention first)
  const colorPriority: Record<string, number> = { red: 0, grey: 1, yellow: 2, green: 3 };
  snapshots.sort((a, b) => {
    const ap = colorPriority[a.health.color];
    const bp = colorPriority[b.health.color];
    if (ap !== bp) return ap - bp;
    return a.health.score - b.health.score;
  });

  // Portfolio-level compliance counts
  const complianceCounts: ComplianceCounts = { compliant: 0, warning: 0, overdue: 0, unknown: 0 };
  for (const s of snapshots) complianceCounts[s.complianceStatus]++;

  return {
    generatedAt: new Date().toISOString(),
    totalAccounts: allAccounts.length,
    assessed: latestByAccount.size,
    unassessed: allAccounts.length - latestByAccount.size,
    greenCount,
    yellowCount,
    redCount,
    greyCount,
    criticalCount,
    ebaDMDistribution: ebaDMDist,
    ebaAdminDistribution: ebaAdminDist,
    v5Distribution: v5Dist,
    ssotTarkie,
    ssotThirdParty,
    ssotUnknown,
    thirdPartyTools: Array.from(thirdPartyToolCounts.entries())
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count),
    topRequestedModules: Array.from(requestedModuleCounts.entries())
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    complianceCounts,
    byTier: buildTierBreakdown(snapshots),
    byGroup: buildGroupBreakdown(snapshots),
    byRm: buildRmBreakdown(snapshots, rmRows),
    accounts: snapshots,
  };
}

// ─── Breakdown builders ────────────────────────────────────────────────────

function emptyColorCounts(): ColorCounts {
  return { green: 0, yellow: 0, red: 0, grey: 0, critical: 0 };
}
function emptyComplianceCounts(): ComplianceCounts {
  return { compliant: 0, warning: 0, overdue: 0, unknown: 0 };
}

function buildTierBreakdown(accounts: AccountSnapshot[]): TierBreakdownRow[] {
  const tierOrder = ["VIP", "1", "2", "3", "4", "5", "Unset"];
  const buckets = new Map<string, { accounts: AccountSnapshot[]; }>();
  for (const t of tierOrder) buckets.set(t, { accounts: [] });

  for (const a of accounts) {
    const key = a.tier && tierOrder.includes(a.tier) ? a.tier : "Unset";
    buckets.get(key)!.accounts.push(a);
  }

  return tierOrder.map(tier => summarizeBucket({ label: tier, accounts: buckets.get(tier)!.accounts }))
    .filter(row => row.accountCount > 0)
    .map(row => ({
      tier: row.label,
      accountCount: row.accountCount,
      health: row.health,
      compliance: row.compliance,
      avgScore: row.avgScore,
    }));
}

function buildGroupBreakdown(accounts: AccountSnapshot[]): GroupBreakdownRow[] {
  const buckets = new Map<string, AccountSnapshot[]>();
  for (const a of accounts) {
    if (!a.groupName) continue;   // Only accounts with a group are aggregated here
    const key = a.groupName;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a);
  }

  const rows: GroupBreakdownRow[] = [];
  buckets.forEach((members, groupName) => {
    const summary = summarizeBucket({ label: groupName, accounts: members });
    // Worst color: red dominates yellow dominates green dominates grey
    let worstColor: HealthColor = "grey";
    if (summary.health.red > 0) worstColor = "red";
    else if (summary.health.yellow > 0) worstColor = "yellow";
    else if (summary.health.green > 0) worstColor = "green";
    rows.push({
      groupName,
      accountCount: summary.accountCount,
      health: summary.health,
      compliance: summary.compliance,
      worstColor,
      rollupScore: summary.avgScore,
      members: members.map(m => m.companyName).slice(0, 5),
    });
  });

  // Sort: worst worstColor first, then by count descending
  const colorPriority: Record<HealthColor, number> = { red: 0, yellow: 1, grey: 2, green: 3 };
  rows.sort((a, b) => {
    const ap = colorPriority[a.worstColor];
    const bp = colorPriority[b.worstColor];
    if (ap !== bp) return ap - bp;
    return b.accountCount - a.accountCount;
  });
  return rows;
}

function buildRmBreakdown(accounts: AccountSnapshot[], rmRows: Array<{ id: string; name: string | null; email: string | null }>): RmBreakdownRow[] {
  // Use rmEmail (CRM field) as the primary key — falls back to primaryRmEmail (membership).
  const buckets = new Map<string, AccountSnapshot[]>();
  for (const a of accounts) {
    const key = (a.rmEmail || a.primaryRmEmail || "").toLowerCase().trim();
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a);
  }
  const emailToUser = new Map(
    rmRows
      .filter(r => r.email)
      .map(r => [String(r.email).toLowerCase(), r])
  );

  const rows: RmBreakdownRow[] = [];
  buckets.forEach((accs, rmEmail) => {
    const summary = summarizeBucket({ label: rmEmail, accounts: accs });
    const user = emailToUser.get(rmEmail);
    rows.push({
      rmEmail,
      rmName: user?.name || null,
      accountCount: summary.accountCount,
      health: summary.health,
      compliance: summary.compliance,
      avgScore: summary.avgScore,
    });
  });

  // Sort: most critical RM first (highest red count), then by lowest avg score
  rows.sort((a, b) => {
    if (b.health.red !== a.health.red) return b.health.red - a.health.red;
    const aScore = a.avgScore ?? 0;
    const bScore = b.avgScore ?? 0;
    return aScore - bScore;
  });
  return rows;
}

function summarizeBucket(args: { label: string; accounts: AccountSnapshot[] }): {
  label: string;
  accountCount: number;
  health: ColorCounts;
  compliance: ComplianceCounts;
  avgScore: number | null;
} {
  const health = emptyColorCounts();
  const compliance = emptyComplianceCounts();
  let scoreSum = 0;
  let scoreN = 0;
  for (const a of args.accounts) {
    health[a.health.color]++;
    if (a.health.isCritical) health.critical++;
    compliance[a.complianceStatus]++;
    if (a.health.color !== "grey") {
      scoreSum += a.health.score;
      scoreN++;
    }
  }
  return {
    label: args.label,
    accountCount: args.accounts.length,
    health,
    compliance,
    avgScore: scoreN > 0 ? Math.round(scoreSum / scoreN) : null,
  };
}

/**
 * Run Gemini once over the full portfolio to produce CEO-grade clustered
 * themes: 5-7 risks across the whole book, 5-7 opportunities, and a
 * 4-6 sentence executive summary. Optional — the page renders fine without
 * this. Mutates the summary in place.
 */
export async function clusterThemes(summary: ExecutiveSummary): Promise<void> {
  if (summary.assessed === 0) {
    summary.aiPortfolioSummary = "No assessments have been submitted yet. The portfolio view is empty until at least one Primary RM completes a Health Assessment.";
    summary.aiTopRisks = [];
    summary.aiTopOpportunities = [];
    return;
  }

  try {
    const prompt = buildClusteringPrompt(summary);
    const model = await getModelForApp("brd-maker");
    if (!model) throw new Error("No AI model configured");
    const result = await generateWithRetry(model, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const raw = (result?.response?.text?.() || "").trim();
    const parsed = extractJson(raw);
    if (!parsed) throw new Error("Couldn't parse model output as JSON");

    summary.aiPortfolioSummary = String(parsed.summary || "").trim();
    summary.aiTopRisks = Array.isArray(parsed.risks)
      ? parsed.risks.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 8)
      : [];
    summary.aiTopOpportunities = Array.isArray(parsed.opportunities)
      ? parsed.opportunities.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 8)
      : [];
  } catch (e: any) {
    summary.aiClusteringError = e?.message || String(e);
  }
}

function buildClusteringPrompt(s: ExecutiveSummary): string {
  const accountLines = s.accounts.slice(0, 50).map(a => {
    const bits: string[] = [];
    bits.push(`[${a.health.color.toUpperCase()} ${a.health.score}] ${a.companyName} (${a.industry})`);
    if (a.aiSummary) bits.push(`  Summary: ${a.aiSummary}`);
    if (a.topRisks.length) bits.push(`  Risks: ${a.topRisks.join("; ")}`);
    if (a.topOpportunities.length) bits.push(`  Opportunities: ${a.topOpportunities.join("; ")}`);
    if (a.notableRequests.length) bits.push(`  Requests: ${a.notableRequests.join("; ")}`);
    return bits.join("\n");
  }).join("\n\n");

  return `You are the CEO's Chief of Staff at Mobile Optima / Tarkie. You're preparing the cross-portfolio executive summary from per-account Health Assessments.

PORTFOLIO STATS:
- Total accounts: ${s.totalAccounts}
- Healthy (green): ${s.greenCount}
- Watch (yellow): ${s.yellowCount}
- Critical (red): ${s.redCount} (of which ${s.criticalCount} hit critical override rules)
- Unassessed: ${s.greyCount}
- Tarkie is SSOT: ${s.ssotTarkie} / displaced by third-party: ${s.ssotThirdParty} / unknown: ${s.ssotUnknown}
- Top displacing tools: ${s.thirdPartyTools.slice(0, 5).map(t => `${t.tool} (${t.count})`).join(", ") || "—"}
- Most-requested modules: ${s.topRequestedModules.slice(0, 5).map(m => `${m.module} (${m.count})`).join(", ") || "—"}

ACCOUNT-LEVEL DETAIL:
${accountLines}

YOUR JOB — produce CEO-grade clustered themes. Three artifacts:

1. SUMMARY — 4-6 sentences. Open with the most important portfolio-level signal (e.g. "Critical attention needed: N accounts are at risk of churn, primarily driven by..."). Cover: portfolio health overall, the most acute concentration of risk, the biggest opportunity, and what they should prioritize this quarter. Don't list account names unless one is dominantly important.

2. RISKS — 5-7 clustered themes across the portfolio. Each bullet ≤ 25 words. Tie back to specific accounts only when calling out concentration ("3 accounts have been displaced by Hubspot for SSOT"). Cover: low-EBA clusters, SSOT displacement patterns, recent contact churn, module gaps. Don't repeat the same risk in different words.

3. OPPORTUNITIES — 5-7 clustered themes. Each bullet ≤ 25 words. Expansion signals (requested modules clustered), high-readiness accounts ripe for V5 push, strong-EBA accounts that could be expanded. Concrete and actionable.

OUTPUT — return EXACTLY this JSON, no markdown fences:

{
  "summary": "...",
  "risks": ["..."],
  "opportunities": ["..."]
}
`;
}

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  } catch {}
  return [];
}

function extractJson(raw: string): any | null {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const match = stripped.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}
