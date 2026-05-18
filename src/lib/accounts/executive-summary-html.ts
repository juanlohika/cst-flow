/**
 * HTML rendering of the Executive Summary for Word/PDF export.
 * Mirrors the on-page layout (gauges, critical list, distributions, account
 * cards) but uses inline styles so html-to-docx and Drive's PDF converter
 * render it cleanly.
 */
import type { ExecutiveSummary, AccountSnapshot } from "./executive-summary";
import { HEALTH_COLORS } from "./health-score";

export function renderExecutiveSummaryHtml(summary: ExecutiveSummary): string {
  const generated = new Date(summary.generatedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111827; padding: 20pt; }
h1 { font-size: 22pt; font-weight: 700; margin: 0 0 4pt; color: #0f172a; border-bottom: 2pt solid #4f46e5; padding-bottom: 6pt; }
h2 { font-size: 14pt; font-weight: 700; margin: 18pt 0 8pt; color: #1e293b; }
h3 { font-size: 12pt; font-weight: 700; margin: 12pt 0 6pt; color: #334155; }
p { margin: 6pt 0; }
.meta { color: #64748b; font-size: 10pt; }
.counts-grid { display: table; width: 100%; border-collapse: separate; border-spacing: 6pt; margin: 8pt 0; }
.count-card { display: table-cell; padding: 10pt 12pt; border-radius: 4pt; border: 1pt solid #e5e7eb; vertical-align: top; }
.count-label { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
.count-value { font-size: 20pt; font-weight: 700; margin-top: 2pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
th, td { border: 1pt solid #cbd5e1; padding: 5pt 7pt; text-align: left; font-size: 10pt; vertical-align: top; }
th { background-color: #f1f5f9; font-weight: 700; }
ul { margin: 6pt 0; padding-left: 18pt; }
li { margin: 3pt 0; font-size: 10.5pt; }
.color-dot { display: inline-block; width: 10pt; height: 10pt; border-radius: 50%; margin-right: 4pt; vertical-align: middle; }
.tag { display: inline-block; padding: 2pt 6pt; border-radius: 4pt; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.critical-card { background-color: #fef2f2; border: 1pt solid #fecaca; padding: 8pt 10pt; margin: 4pt 0; border-radius: 4pt; }
.critical-card-name { font-weight: 700; color: #991b1b; }
.critical-card-reasons { color: #7f1d1d; font-size: 10pt; margin-top: 2pt; }
.exec-summary-block { background-color: #eef2ff; border-left: 3pt solid #4f46e5; padding: 10pt 14pt; margin: 8pt 0; border-radius: 4pt; }
</style>
</head>
<body>

<h1>Account Health · Executive Summary</h1>
<p class="meta">Generated ${escapeHtml(generated)} · ${summary.totalAccounts} account${summary.totalAccounts === 1 ? "" : "s"} in portfolio · ${summary.assessed} assessed</p>

${renderAiSummaryBlock(summary)}

<h2>Portfolio Health</h2>
<div class="counts-grid">
  ${renderCountCard("Critical", summary.redCount, "red", summary.totalAccounts)}
  ${renderCountCard("Watch", summary.yellowCount, "yellow", summary.totalAccounts)}
  ${renderCountCard("Healthy", summary.greenCount, "green", summary.totalAccounts)}
  ${renderCountCard("Unassessed", summary.greyCount, "grey", summary.totalAccounts)}
</div>

${renderCriticalAccountsSection(summary)}

${renderAiThemesSection(summary)}

<h2>Distributions</h2>
${renderDistributionTable("EBA — Decision Maker", summary.ebaDMDistribution)}
${renderDistributionTable("EBA — Admin", summary.ebaAdminDistribution)}
${renderDistributionTable("V5 Readiness", summary.v5Distribution)}

<h2>System of Record (SSOT)</h2>
<table>
  <thead><tr><th>Status</th><th style="width: 80pt;">Count</th></tr></thead>
  <tbody>
    <tr><td>Tarkie is SSOT</td><td>${summary.ssotTarkie}</td></tr>
    <tr><td>Displaced by third-party</td><td>${summary.ssotThirdParty}</td></tr>
    <tr><td>Unknown / unassessed</td><td>${summary.ssotUnknown}</td></tr>
  </tbody>
</table>
${summary.thirdPartyTools.length > 0 ? `
<h3>Tools displacing Tarkie</h3>
<ul>
  ${summary.thirdPartyTools.map(t => `<li><strong>${escapeHtml(t.tool)}</strong> — ${t.count} account${t.count === 1 ? "" : "s"}</li>`).join("")}
</ul>` : ""}

${summary.topRequestedModules.length > 0 ? `
<h2>Top Requested Modules</h2>
<ul>
  ${summary.topRequestedModules.map(m => `<li><strong>${escapeHtml(m.module)}</strong> — requested by ${m.count} account${m.count === 1 ? "" : "s"}</li>`).join("")}
</ul>` : ""}

<h2>All Accounts</h2>
${renderAccountsTable(summary.accounts)}

<p class="meta" style="margin-top: 24pt;">— End of report —</p>

</body>
</html>`;
}

function renderAiSummaryBlock(s: ExecutiveSummary): string {
  if (!s.aiPortfolioSummary) return "";
  return `
<div class="exec-summary-block">
  <p style="font-weight: 700; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; color: #4f46e5; margin: 0 0 4pt;">Executive Summary</p>
  <p style="margin: 0; color: #1e1b4b; font-size: 11pt; line-height: 1.55;">${escapeHtml(s.aiPortfolioSummary)}</p>
</div>`;
}

function renderAiThemesSection(s: ExecutiveSummary): string {
  const hasRisks = s.aiTopRisks && s.aiTopRisks.length > 0;
  const hasOpps = s.aiTopOpportunities && s.aiTopOpportunities.length > 0;
  if (!hasRisks && !hasOpps) return "";

  return `
<h2>Cross-Portfolio Themes</h2>
${hasRisks ? `
<h3 style="color: #b91c1c;">Top Risks</h3>
<ul>${s.aiTopRisks!.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
` : ""}
${hasOpps ? `
<h3 style="color: #047857;">Top Opportunities</h3>
<ul>${s.aiTopOpportunities!.map(o => `<li>${escapeHtml(o)}</li>`).join("")}</ul>
` : ""}`;
}

function renderCountCard(label: string, count: number, color: "red" | "yellow" | "green" | "grey", total: number): string {
  const palette = HEALTH_COLORS[color];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
<div class="count-card" style="background-color: ${palette.hex}11; border-color: ${palette.hex}55;">
  <div class="count-label" style="color: ${palette.hex};">${label}</div>
  <div class="count-value" style="color: ${palette.hex};">${count}</div>
  <div class="meta" style="font-size: 9pt;">${pct}% of portfolio</div>
</div>`;
}

function renderCriticalAccountsSection(s: ExecutiveSummary): string {
  const criticals = s.accounts.filter(a => a.health.color === "red");
  if (criticals.length === 0) return "";
  return `
<h2>Accounts needing attention (${criticals.length})</h2>
${criticals.map(a => `
<div class="critical-card">
  <p class="critical-card-name">${escapeHtml(a.companyName)} <span style="font-weight: 400; color: #64748b; font-size: 9pt;">· ${escapeHtml(a.industry)} · score ${a.health.score}/100${a.primaryRmName ? ` · RM: ${escapeHtml(a.primaryRmName)}` : ""}</span></p>
  <p class="critical-card-reasons">${a.health.reasons.map(escapeHtml).join(" · ")}</p>
  ${a.aiSummary ? `<p style="margin: 4pt 0 0; color: #475569; font-size: 10pt; font-style: italic;">"${escapeHtml(a.aiSummary)}"</p>` : ""}
</div>`).join("")}`;
}

function renderDistributionTable(label: string, dist: number[]): string {
  const total = dist.reduce((a, b) => a + b, 0);
  if (total === 0) return `<p><strong>${escapeHtml(label)}</strong>: no data yet</p>`;
  return `
<h3>${escapeHtml(label)}</h3>
<table>
  <thead><tr>${[1,2,3,4,5].map(n => `<th>${n}/5</th>`).join("")}</tr></thead>
  <tbody><tr>${dist.map(c => `<td>${c}</td>`).join("")}</tr></tbody>
</table>`;
}

function renderAccountsTable(accounts: AccountSnapshot[]): string {
  return `
<table>
  <thead>
    <tr>
      <th style="width: 14pt;"></th>
      <th>Account</th>
      <th style="width: 90pt;">Industry</th>
      <th style="width: 80pt;">Primary RM</th>
      <th style="width: 50pt; text-align: center;">Score</th>
      <th style="width: 50pt;">EBA-DM</th>
      <th style="width: 50pt;">EBA-Adm</th>
      <th style="width: 40pt;">V5</th>
      <th style="width: 70pt;">SSOT</th>
    </tr>
  </thead>
  <tbody>
    ${accounts.map(a => `
    <tr>
      <td style="background-color: ${HEALTH_COLORS[a.health.color].hex};"></td>
      <td><strong>${escapeHtml(a.companyName)}</strong>${a.aiSummary ? `<br/><span style="font-size: 9pt; color: #64748b;">${escapeHtml(truncate(a.aiSummary, 140))}</span>` : ""}</td>
      <td>${escapeHtml(a.industry)}</td>
      <td>${escapeHtml(a.primaryRmName || "—")}</td>
      <td style="text-align: center; font-weight: 700;">${a.health.color === "grey" ? "—" : a.health.score}</td>
      <td>${a.ebaDecisionMaker ?? "—"}</td>
      <td>${a.ebaAdmin ?? "—"}</td>
      <td>${a.v5Readiness ?? "—"}</td>
      <td>${a.isTarkieSsot === true ? "Tarkie" : a.isTarkieSsot === false ? escapeHtml(a.thirdPartySsot || "Other") : "—"}</td>
    </tr>`).join("")}
  </tbody>
</table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  } as any)[c]);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
