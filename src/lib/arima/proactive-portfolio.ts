/**
 * Phase E.7 — Proactive ARIMA portfolio updates.
 *
 * Posts portfolio summaries to the Super Admin GC on a schedule:
 *   - Bi-weekly maintenance status update
 *   - Monthly end-of-month CC compliance report
 *   - Hypercare-overdue alerts (DM to PM + each allowlisted Super Admin)
 *
 * Also drives on-demand commands from the SA GC: /ccstatus, /maintenance-update.
 *
 * All three live behind cron header `x-cron-secret` (env PORTFOLIO_CRON_SECRET)
 * and additionally refuse to post anywhere except the active bound SA GC.
 */
import { db } from "@/db";
import { users as usersTable, superAdminUsers, telegramAccountLinks } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { buildExecutiveSummary, type ExecutiveSummary, type AccountSnapshot } from "@/lib/accounts/executive-summary";
import { loadActiveSuperAdminContext, logSuperAdminAccess } from "@/lib/super-admin/context";
import { tgSendMessage, truncateForTelegram } from "@/lib/telegram/api";
import { getTelegramConfig } from "@/lib/telegram/config";
import { STATUS_LABELS } from "@/lib/accounts/lifecycle";

// ─── Public builders ─────────────────────────────────────────────────────

export function buildMaintenanceUpdate(summary: ExecutiveSummary): string {
  const inMaintenance = summary.accounts.filter(a => a.lifecycleStatus === "maintenance");
  const ccOverdue = inMaintenance.filter(a => a.complianceStatus === "overdue");
  const ccWarning = inMaintenance.filter(a => a.complianceStatus === "warning");
  const f2fOverdue = inMaintenance.filter(a => a.f2fComplianceStatus === "overdue");

  const lines: string[] = [];
  lines.push(`📊 *Maintenance Portfolio Update*`);
  lines.push(`_${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "short", day: "numeric" })}_`);
  lines.push(``);
  lines.push(`Accounts in Maintenance: *${inMaintenance.length}*`);
  lines.push(`• CC overdue: ${ccOverdue.length}`);
  lines.push(`• CC due soon: ${ccWarning.length}`);
  lines.push(`• F2F overdue: ${f2fOverdue.length}`);
  lines.push(``);

  if (ccOverdue.length > 0) {
    lines.push(`🔴 *CC Overdue* (most urgent)`);
    for (const a of ccOverdue.slice(0, 10)) {
      const days = a.daysSinceCall != null ? `${a.daysSinceCall}d` : "—";
      const rm = a.rmEmail ? ` · RM: ${a.rmEmail}` : "";
      lines.push(`• ${a.companyName} (T${a.tier || "?"}, ${days} since CC)${rm}`);
    }
    if (ccOverdue.length > 10) lines.push(`_…and ${ccOverdue.length - 10} more._`);
    lines.push(``);
  }

  if (f2fOverdue.length > 0) {
    lines.push(`🟠 *F2F Overdue*`);
    for (const a of f2fOverdue.slice(0, 5)) {
      const days = a.daysSinceF2F != null ? `${a.daysSinceF2F}d` : "—";
      lines.push(`• ${a.companyName} (${days} since F2F)`);
    }
    if (f2fOverdue.length > 5) lines.push(`_…and ${f2fOverdue.length - 5} more._`);
    lines.push(``);
  }

  if (ccOverdue.length === 0 && f2fOverdue.length === 0) {
    lines.push(`✅ All maintenance accounts are within cadence. Nothing to escalate.`);
  }
  return lines.join("\n");
}

export function buildCcStatusReport(summary: ExecutiveSummary): string {
  const lines: string[] = [];
  lines.push(`📞 *Courtesy Call — Portfolio Status*`);
  lines.push(`_${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}_`);
  lines.push(``);
  lines.push(`Compliant: ${summary.complianceCounts.compliant}`);
  lines.push(`Due soon: ${summary.complianceCounts.warning}`);
  lines.push(`Overdue: *${summary.complianceCounts.overdue}*`);
  lines.push(`Unknown / no history: ${summary.complianceCounts.unknown}`);
  lines.push(``);

  // Overdue by tier
  const overdueByTier = new Map<string, AccountSnapshot[]>();
  for (const a of summary.accounts) {
    if (a.complianceStatus !== "overdue") continue;
    const t = a.tier || "Unset";
    if (!overdueByTier.has(t)) overdueByTier.set(t, []);
    overdueByTier.get(t)!.push(a);
  }
  if (overdueByTier.size > 0) {
    lines.push(`*Overdue by tier*`);
    for (const tier of ["VIP", "1", "2", "3", "4", "5", "Unset"]) {
      const accts = overdueByTier.get(tier);
      if (!accts || accts.length === 0) continue;
      lines.push(`Tier ${tier} — ${accts.length}: ${accts.slice(0, 3).map(a => a.companyName).join(", ")}${accts.length > 3 ? `, +${accts.length - 3}` : ""}`);
    }
  } else {
    lines.push(`✅ No overdue CCs.`);
  }
  return lines.join("\n");
}

export interface HypercareOverdueRow {
  account: AccountSnapshot;
  daysOverdue: number;
}

export function findHypercareOverdue(summary: ExecutiveSummary): HypercareOverdueRow[] {
  const rows: HypercareOverdueRow[] = [];
  for (const a of summary.accounts) {
    if (a.hypercareStatus !== "overdue") continue;
    const daysOverdue = (a.hypercareDaysIn || 0) - 90;
    rows.push({ account: a, daysOverdue });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return rows;
}

export function buildHypercareGroupSummary(rows: HypercareOverdueRow[]): string {
  const lines: string[] = [];
  lines.push(`🚨 *Hypercare Overdue Alert*`);
  lines.push(`_${rows.length} account${rows.length === 1 ? "" : "s"} past the 90-day hypercare window without a Maintenance flip._`);
  lines.push(``);
  for (const { account, daysOverdue } of rows.slice(0, 15)) {
    const pm = account.pmEmail ? ` · PM: ${account.pmEmail}` : "";
    lines.push(`• ${account.companyName} — ${daysOverdue}d overdue${pm}`);
  }
  if (rows.length > 15) lines.push(`_…and ${rows.length - 15} more._`);
  lines.push(``);
  lines.push(`Reassess: promote to Maintenance, or extend hypercare with a reason.`);
  return lines.join("\n");
}

export function buildHypercareDmForPm(row: HypercareOverdueRow): string {
  const a = row.account;
  return [
    `Hi 👋 — ARIMA here. Reminder on hypercare:`,
    ``,
    `*${a.companyName}* has been in Hypercare for ${a.hypercareDaysIn} days (${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"} past the 90-day window).`,
    ``,
    `Next step: review the account and either flip to *Maintenance* (steady-state) or extend hypercare with a reason in the account profile.`,
    ``,
    `Go-live date: ${a.goLiveDate || "—"}`,
    `Tier: ${a.tier || "—"}`,
  ].join("\n");
}

// ─── Posters ─────────────────────────────────────────────────────────────

/**
 * Send to the bound Super Admin GC. Returns { ok, reason }.
 * Refuses (silently) if no active context.
 */
export async function postToSuperAdminGc(text: string, opts: { logToolName?: string; question?: string } = {}): Promise<{ ok: boolean; reason?: string; chatId?: string }> {
  const ctx = await loadActiveSuperAdminContext();
  if (!ctx) {
    return { ok: false, reason: "No active Super Admin context bound." };
  }
  if (new Date(ctx.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "Super Admin context expired." };
  }
  const cfg = await getTelegramConfig();
  if (!cfg.botToken) return { ok: false, reason: "Telegram bot token not configured." };
  try {
    await tgSendMessage(cfg.botToken, ctx.telegramChatId, truncateForTelegram(text), { parseMode: "Markdown" });
    await logSuperAdminAccess({
      contextId: ctx.id,
      telegramChatId: ctx.telegramChatId,
      toolName: opts.logToolName || "proactive_portfolio_post",
      question: opts.question || null,
      status: "allowed",
      reason: "Proactive portfolio update",
      responseSummary: text.slice(0, 200),
      responseBytes: text.length,
    });
    return { ok: true, chatId: ctx.telegramChatId };
  } catch (e: any) {
    console.warn("[proactive-portfolio] post failed:", e?.message);
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * DM each Super Admin allowlist member + the named PM (resolved from pmEmail
 * via users.email → telegramAccountLinks.cstUserId). Falls back gracefully
 * when a Telegram link is missing.
 */
export async function dmHypercareOverdue(row: HypercareOverdueRow): Promise<{ dmsSent: number; misses: string[] }> {
  const cfg = await getTelegramConfig();
  const misses: string[] = [];
  let dmsSent = 0;
  if (!cfg.botToken) return { dmsSent: 0, misses: ["Telegram bot not configured"] };

  // 1) Collect recipients: PM (via pmEmail) + every super admin user
  const recipients = new Map<string, { label: string; cstUserId: string }>();

  const pmEmail = row.account.pmEmail?.toLowerCase().trim();
  if (pmEmail) {
    const pmRows = await db.select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, pmEmail))
      .limit(1);
    if (pmRows[0]) recipients.set(pmRows[0].id, { label: `PM (${pmEmail})`, cstUserId: pmRows[0].id });
    else misses.push(`PM ${pmEmail} not found in CST OS users`);
  }

  const saRows = await db.select({ cstUserId: superAdminUsers.cstUserId })
    .from(superAdminUsers);
  for (const r of saRows) {
    if (!recipients.has(r.cstUserId)) {
      recipients.set(r.cstUserId, { label: "Super Admin", cstUserId: r.cstUserId });
    }
  }

  if (recipients.size === 0) {
    return { dmsSent: 0, misses: ["No recipients (no PM linked, no Super Admin allowlist)"] };
  }

  // 2) Resolve telegram chat ids via active telegramAccountLinks
  const cstIds = Array.from(recipients.values()).map(r => r.cstUserId);
  const links = await db.select({
    cstUserId: telegramAccountLinks.cstUserId,
    telegramUserId: telegramAccountLinks.telegramUserId,
  })
    .from(telegramAccountLinks)
    .where(inArray(telegramAccountLinks.cstUserId, cstIds));
  const tgByCst = new Map(links.map(l => [l.cstUserId, l.telegramUserId]));

  const message = buildHypercareDmForPm(row);
  const recipientList = Array.from(recipients.values());
  for (const r of recipientList) {
    const tgId = tgByCst.get(r.cstUserId);
    if (!tgId) {
      misses.push(`${r.label} has no Telegram link — skipped DM`);
      continue;
    }
    try {
      await tgSendMessage(cfg.botToken, tgId, truncateForTelegram(message), { parseMode: "Markdown" });
      dmsSent++;
    } catch (e: any) {
      misses.push(`${r.label} DM failed: ${e?.message || "unknown"}`);
    }
  }

  return { dmsSent, misses };
}

// ─── Orchestrators (called from cron / telegram commands) ────────────────

export async function runMaintenanceUpdate(): Promise<{ ok: boolean; reason?: string }> {
  const summary = await buildExecutiveSummary();
  const text = buildMaintenanceUpdate(summary);
  return postToSuperAdminGc(text, { logToolName: "proactive_maintenance_update" });
}

export async function runCcStatus(): Promise<{ ok: boolean; reason?: string }> {
  const summary = await buildExecutiveSummary();
  const text = buildCcStatusReport(summary);
  return postToSuperAdminGc(text, { logToolName: "proactive_cc_status" });
}

export async function runHypercareOverdueSweep(): Promise<{
  ok: boolean;
  reason?: string;
  groupPosted: boolean;
  dmStats: Array<{ account: string; dmsSent: number; misses: string[] }>;
}> {
  const summary = await buildExecutiveSummary();
  const rows = findHypercareOverdue(summary);
  if (rows.length === 0) {
    return { ok: true, groupPosted: false, dmStats: [] };
  }
  // Group post
  const groupResult = await postToSuperAdminGc(buildHypercareGroupSummary(rows), { logToolName: "proactive_hypercare_alert" });
  // Per-account DMs
  const dmStats: Array<{ account: string; dmsSent: number; misses: string[] }> = [];
  for (const row of rows) {
    const r = await dmHypercareOverdue(row);
    dmStats.push({ account: row.account.companyName, ...r });
  }
  return { ok: groupResult.ok, reason: groupResult.reason, groupPosted: groupResult.ok, dmStats };
}
