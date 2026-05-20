/**
 * Phase E.9 — Scope-aware portfolio slash-command renderer.
 *
 * Drives /ccstatus, /maintenanceupdate, /hypercarecheck, /myaccounts,
 * /redaccounts, /overdue. When called from a SA GC the scope is the full
 * portfolio; from an RM team room it's filtered to that RM's primary-
 * membership accounts.
 *
 * All renders post directly to the calling Telegram chat — caller passes
 * the bot token + chatId + replyToMessageId.
 */
import { buildExecutiveSummary, type AccountSnapshot, type ExecutiveSummary } from "@/lib/accounts/executive-summary";
import {
  buildCcStatusReport,
  buildMaintenanceUpdate,
  findHypercareOverdue,
  buildHypercareGroupSummary,
} from "./proactive-portfolio";
import { tgSendMessage, truncateForTelegram } from "@/lib/telegram/api";

export type PortfolioCommand =
  | "ccstatus"
  | "maintenanceupdate" | "maintenance"
  | "hypercarecheck"
  | "myaccounts"
  | "redaccounts"
  | "overdue";

const COLOR_EMOJI: Record<string, string> = {
  red: "🔴",
  yellow: "🟡",
  green: "🟢",
  grey: "⚪",
};

export async function handlePortfolioCommand(args: {
  command: string;
  /** null for SA-GC full-portfolio; userId for an RM team room. */
  rmUserId: string | null;
  botToken: string;
  chatId: number | string;
  replyToMessageId?: number;
}): Promise<{ posted: boolean; errorReason?: string }> {
  const summary = await buildExecutiveSummary(
    args.rmUserId ? { userId: args.rmUserId, isAdmin: false } : undefined,
  );

  let text: string;
  switch (args.command) {
    case "ccstatus":
      text = buildCcStatusReport(summary);
      break;
    case "maintenanceupdate":
    case "maintenance":
      text = buildMaintenanceUpdate(summary);
      break;
    case "hypercarecheck": {
      const rows = findHypercareOverdue(summary);
      if (rows.length === 0) {
        text = "✅ No accounts are past the 90-day hypercare window.";
      } else {
        text = buildHypercareGroupSummary(rows);
      }
      break;
    }
    case "myaccounts":
      text = buildMyAccountsReport(summary, args.rmUserId);
      break;
    case "redaccounts":
      text = buildRedAccountsReport(summary, args.rmUserId);
      break;
    case "overdue":
      text = buildOverdueReport(summary, args.rmUserId);
      break;
    default:
      return { posted: false, errorReason: `Unknown command: ${args.command}` };
  }

  try {
    await tgSendMessage(args.botToken, args.chatId, truncateForTelegram(text), {
      parseMode: "Markdown",
      replyToMessageId: args.replyToMessageId,
    });
    return { posted: true };
  } catch (e: any) {
    return { posted: false, errorReason: e?.message || String(e) };
  }
}

function scopeLine(rmUserId: string | null, total: number): string {
  return rmUserId
    ? `_Scope: ${total} account${total === 1 ? "" : "s"} assigned to you._`
    : `_Scope: portfolio-wide (${total} account${total === 1 ? "" : "s"})._`;
}

function buildMyAccountsReport(summary: ExecutiveSummary, rmUserId: string | null): string {
  const lines: string[] = [];
  lines.push(rmUserId ? `📋 *My Accounts*` : `📋 *Portfolio Accounts*`);
  lines.push(scopeLine(rmUserId, summary.totalAccounts));
  lines.push(``);
  if (summary.accounts.length === 0) {
    lines.push("_No accounts in scope yet._");
    return lines.join("\n");
  }
  // Group by health color for at-a-glance scanning.
  const byColor: Record<string, AccountSnapshot[]> = { red: [], yellow: [], green: [], grey: [] };
  for (const a of summary.accounts) byColor[a.health.color]?.push(a);
  for (const color of ["red", "yellow", "green", "grey"]) {
    const accts = byColor[color];
    if (!accts || accts.length === 0) continue;
    lines.push(`${COLOR_EMOJI[color]} *${labelForColor(color)}* (${accts.length})`);
    for (const a of accts.slice(0, 15)) {
      const tier = a.tier ? `T${a.tier}` : "—";
      const ccBit = a.complianceStatus === "overdue" ? " · CC overdue" : "";
      lines.push(`  • ${a.companyName} · ${tier}${ccBit}`);
    }
    if (accts.length > 15) lines.push(`  …and ${accts.length - 15} more.`);
    lines.push(``);
  }
  return lines.join("\n");
}

function buildRedAccountsReport(summary: ExecutiveSummary, rmUserId: string | null): string {
  const reds = summary.accounts.filter(a => a.health.color === "red");
  const lines: string[] = [];
  lines.push(`🔴 *Critical Accounts*`);
  lines.push(scopeLine(rmUserId, summary.totalAccounts));
  lines.push(``);
  if (reds.length === 0) {
    lines.push("✅ None — nothing in the red right now.");
    return lines.join("\n");
  }
  lines.push(`*${reds.length}* account${reds.length === 1 ? "" : "s"} flagged red:`);
  for (const a of reds.slice(0, 20)) {
    const tier = a.tier ? `T${a.tier}` : "—";
    const reasons = (a.health.reasons || []).slice(0, 2).join("; ");
    lines.push(`• *${a.companyName}* (${tier}, score ${a.health.score})${reasons ? ` — ${reasons}` : ""}`);
  }
  if (reds.length > 20) lines.push(`_…and ${reds.length - 20} more._`);
  return lines.join("\n");
}

function buildOverdueReport(summary: ExecutiveSummary, rmUserId: string | null): string {
  const ccOverdue = summary.accounts.filter(a => a.complianceStatus === "overdue");
  const f2fOverdue = summary.accounts.filter(a => a.f2fComplianceStatus === "overdue");
  const lines: string[] = [];
  lines.push(`📞 *Overdue Touchpoints*`);
  lines.push(scopeLine(rmUserId, summary.totalAccounts));
  lines.push(``);
  if (ccOverdue.length === 0 && f2fOverdue.length === 0) {
    lines.push("✅ All current on CC + F2F cadence.");
    return lines.join("\n");
  }
  if (ccOverdue.length > 0) {
    lines.push(`📞 *CC overdue (${ccOverdue.length})*`);
    for (const a of ccOverdue.slice(0, 12)) {
      const days = a.daysSinceCall != null ? `${a.daysSinceCall}d` : "—";
      lines.push(`• ${a.companyName} (T${a.tier || "?"}, ${days} since CC)`);
    }
    if (ccOverdue.length > 12) lines.push(`_…and ${ccOverdue.length - 12} more._`);
    lines.push(``);
  }
  if (f2fOverdue.length > 0) {
    lines.push(`🤝 *F2F overdue (${f2fOverdue.length})*`);
    for (const a of f2fOverdue.slice(0, 8)) {
      const days = a.daysSinceF2F != null ? `${a.daysSinceF2F}d` : "—";
      lines.push(`• ${a.companyName} (${days} since F2F)`);
    }
    if (f2fOverdue.length > 8) lines.push(`_…and ${f2fOverdue.length - 8} more._`);
  }
  return lines.join("\n");
}

function labelForColor(c: string): string {
  if (c === "red") return "Critical";
  if (c === "yellow") return "Watch";
  if (c === "green") return "Healthy";
  return "Unassessed";
}
