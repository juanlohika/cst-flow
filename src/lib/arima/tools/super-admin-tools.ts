/**
 * Phase E.6 — Super Admin tools. Only registered/usable when the
 * conversation is in the bound Super Admin context.
 *
 * Every handler:
 *   1. Calls checkSuperAdminAccess() to verify the sender is allowlisted
 *      and the context is active.
 *   2. Refuses with a strict message if not allowed (audit-logged).
 *   3. On allow, runs the data lookup, logs the question + summary, and
 *      returns the data.
 *
 * Tools are listed BUT NOT ENABLED in the registry by default. The
 * runtime's tool resolution layer also filters them out unless the
 * checkSuperAdminAccess() verdict is "allowed" for the current invocation
 * context. This is belt + suspenders — even if a developer mistakenly
 * enables them globally, the handler still refuses.
 */
import { registerTool, type ToolContext } from "./registry";
import {
  checkSuperAdminAccess,
  logSuperAdminAccess,
  resolveCstUserFromTelegram,
} from "@/lib/super-admin/context";

async function buildAccessInput(ctx: ToolContext, originalQuestion?: string) {
  const isPrivateChat = ctx.channel === "telegram" && !ctx.sourceTelegramChatId;
  const telegramChatId = ctx.sourceTelegramChatId ? String(ctx.sourceTelegramChatId) : null;
  const telegramUserId = ctx.speakerTelegramUserId || null;
  let cstUserId = ctx.userId || null;
  if (!cstUserId && telegramUserId) {
    cstUserId = await resolveCstUserFromTelegram(telegramUserId);
  }
  return {
    accessInput: {
      telegramChatId,
      telegramUserId,
      cstUserId,
      channel: ctx.channel,
      isPrivateChat,
    },
    cstUserId,
    telegramUserId,
    telegramChatId,
    originalQuestion: originalQuestion || null,
  };
}

async function refuseAndLog(args: {
  toolName: string;
  question?: string | null;
  verdict: { status: string; reason: string };
  cstUserId: string | null;
  telegramUserId: string | null;
  telegramChatId: string | null;
}) {
  await logSuperAdminAccess({
    toolName: args.toolName,
    question: args.question || null,
    status: args.verdict.status,
    reason: args.verdict.reason,
    cstUserId: args.cstUserId,
    telegramUserId: args.telegramUserId,
    telegramChatId: args.telegramChatId,
  });
  return {
    ok: false as const,
    error: args.verdict.reason,
    summary: "Refused — outside Super Admin context.",
  };
}

// ─── portfolio_health_summary ──────────────────────────────────────────
registerTool({
  name: "portfolio_health_summary",
  category: "external",
  description: "Returns the cross-portfolio CRM health summary: color counts (critical/watch/healthy/unassessed), EBA distributions, SSOT status, CC and F2F compliance counts, top requested modules, AI-clustered top risks and opportunities, and a portfolio-wide AI summary. ONLY callable in the bound Super Admin group chat (or in DM if the user is on the allowlist AND has DM access enabled). Refuses everywhere else.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The original user question (for audit log only)" },
    },
  },
  defaultEnabled: false,   // disabled by default; admin must enable via /admin/arima-tools
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    const { accessInput, cstUserId, telegramUserId, telegramChatId, originalQuestion } = await buildAccessInput(ctx, input?.question);
    const verdict = await checkSuperAdminAccess(accessInput);
    if (!verdict.allowed) {
      return refuseAndLog({ toolName: "portfolio_health_summary", question: originalQuestion, verdict, cstUserId, telegramUserId, telegramChatId });
    }

    try {
      const { buildExecutiveSummary, clusterThemes } = await import("@/lib/accounts/executive-summary");
      const summary = await buildExecutiveSummary();
      try { await clusterThemes(summary); } catch { /* non-fatal */ }

      // Trim down for the AI context — full snapshots blow the token budget
      const compactSummary = {
        generatedAt: summary.generatedAt,
        totalAccounts: summary.totalAccounts,
        assessed: summary.assessed,
        unassessed: summary.unassessed,
        healthCounts: {
          critical: summary.redCount,
          watch: summary.yellowCount,
          healthy: summary.greenCount,
          unassessed: summary.greyCount,
          criticallyFlagged: summary.criticalCount,
        },
        ccCompliance: summary.complianceCounts,
        f2fCompliance: summary.f2fComplianceCounts,
        topRequestedModules: summary.topRequestedModules.slice(0, 8),
        thirdPartyTools: summary.thirdPartyTools.slice(0, 5),
        aiPortfolioSummary: summary.aiPortfolioSummary || null,
        aiTopRisks: summary.aiTopRisks || [],
        aiTopOpportunities: summary.aiTopOpportunities || [],
        // Top-level breakdowns: tier and RM, not full account list
        byTier: summary.byTier,
        byRm: summary.byRm,
        criticalAccounts: summary.accounts
          .filter(a => a.health.color === "red")
          .slice(0, 12)
          .map(a => ({
            name: a.companyName,
            industry: a.industry,
            tier: a.tier || null,
            rm: a.primaryRmName || null,
            reasons: a.health.reasons,
            aiSummary: a.aiSummary,
          })),
      };

      const summaryStr = `${summary.totalAccounts} accounts · ${summary.redCount} critical · ${summary.complianceCounts?.overdue ?? 0} CC overdue · ${summary.f2fComplianceCounts?.overdue ?? 0} F2F overdue`;

      await logSuperAdminAccess({
        toolName: "portfolio_health_summary",
        question: originalQuestion,
        status: "allowed",
        reason: verdict.reason,
        cstUserId,
        telegramUserId,
        telegramChatId,
        responseSummary: summaryStr,
        responseBytes: JSON.stringify(compactSummary).length,
        contextId: verdict.contextId,
      });

      return { ok: true, data: compactSummary, summary: summaryStr };
    } catch (e: any) {
      return { ok: false, error: `Portfolio summary failed: ${e?.message || e}` };
    }
  },
});

// ─── find_accounts_by_criteria ─────────────────────────────────────────
registerTool({
  name: "find_accounts_by_criteria",
  category: "external",
  description: "Find accounts matching CRM criteria from the portfolio. Filters: nameContains (partial company / short / long name match — use this for 'what's the tier of MX?'), tier (VIP|1-5), groupName, rmEmail or rmName partial match, healthColor (red|yellow|green|grey), ccCompliance/f2fCompliance status, ssot (tarkie|displaced|unknown). Returns a list of matching accounts with their key fields. ONLY callable in the Super Admin context. Use this tool for any single-account lookup by name when you don't have a clientProfileId.",
  inputSchema: {
    type: "object",
    properties: {
      nameContains: { type: "string", description: "Partial match against companyName / clientShortName / clientLongName. Case-insensitive." },
      tier: { type: "string" },
      groupName: { type: "string" },
      rmEmailContains: { type: "string", description: "Partial email match for the Primary RM" },
      rmNameContains: { type: "string", description: "Partial name match for the Primary RM" },
      healthColor: { type: "string", enum: ["red", "yellow", "green", "grey"] },
      ccCompliance: { type: "string", enum: ["compliant", "warning", "overdue", "unknown"] },
      f2fCompliance: { type: "string", enum: ["compliant", "warning", "overdue", "unknown"] },
      ssot: { type: "string", enum: ["tarkie", "displaced", "unknown"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      question: { type: "string", description: "The original user question (for audit log only)" },
    },
  },
  defaultEnabled: false,
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    const { accessInput, cstUserId, telegramUserId, telegramChatId, originalQuestion } = await buildAccessInput(ctx, input?.question);
    const verdict = await checkSuperAdminAccess(accessInput);
    if (!verdict.allowed) {
      return refuseAndLog({ toolName: "find_accounts_by_criteria", question: originalQuestion, verdict, cstUserId, telegramUserId, telegramChatId });
    }

    try {
      const { buildExecutiveSummary } = await import("@/lib/accounts/executive-summary");
      const summary = await buildExecutiveSummary();
      let results = summary.accounts;

      if (input?.nameContains) {
        const needle = String(input.nameContains).toLowerCase();
        results = results.filter(a =>
          (a.companyName || "").toLowerCase().includes(needle) ||
          (a.clientShortName || "").toLowerCase().includes(needle) ||
          (a.clientLongName || "").toLowerCase().includes(needle)
        );
      }
      if (input?.tier) results = results.filter(a => a.tier === input.tier);
      if (input?.groupName) results = results.filter(a => (a.groupName || "").toLowerCase().includes(String(input.groupName).toLowerCase()));
      if (input?.rmEmailContains) results = results.filter(a => (a.primaryRmEmail || a.rmEmail || "").toLowerCase().includes(String(input.rmEmailContains).toLowerCase()));
      if (input?.rmNameContains) results = results.filter(a => (a.primaryRmName || "").toLowerCase().includes(String(input.rmNameContains).toLowerCase()));
      if (input?.healthColor) results = results.filter(a => a.health.color === input.healthColor);
      if (input?.ccCompliance) results = results.filter(a => a.complianceStatus === input.ccCompliance);
      if (input?.f2fCompliance) results = results.filter(a => a.f2fComplianceStatus === input.f2fCompliance);
      if (input?.ssot) {
        if (input.ssot === "tarkie") results = results.filter(a => a.isTarkieSsot === true);
        else if (input.ssot === "displaced") results = results.filter(a => a.isTarkieSsot === false);
        else results = results.filter(a => a.isTarkieSsot === null);
      }

      const limit = Math.max(1, Math.min(50, Number(input?.limit) || 25));
      const trimmed = results.slice(0, limit);

      const compactData = {
        matchedCount: results.length,
        returnedCount: trimmed.length,
        accounts: trimmed.map(a => ({
          name: a.companyName,
          shortName: a.clientShortName || null,
          longName: a.clientLongName || null,
          tier: a.tier || null,
          group: a.groupName || null,
          rm: a.primaryRmName || a.rmEmail || null,
          pm: a.pmEmail || null,
          ba: a.baEmail || null,
          lifecycle: a.lifecycleStatus,
          goLiveDate: a.goLiveDate || null,
          hypercare: a.hypercareStatus,
          packageModules: a.packageModules || [],   // modules currently availed (the "package")
          health: a.health.color,
          healthScore: a.health.score,
          ccCompliance: a.complianceStatus,
          f2fCompliance: a.f2fComplianceStatus,
          lastCC: a.lastCourtesyCall || null,
          lastF2F: a.lastF2FVisit || null,
          ssot: a.isTarkieSsot === true ? "Tarkie" : a.isTarkieSsot === false ? (a.thirdPartySsot || "Other") : "Unknown",
          aiSummary: a.aiSummary,
        })),
      };

      const summaryStr = `${results.length} match(es) — returning ${trimmed.length}`;
      await logSuperAdminAccess({
        toolName: "find_accounts_by_criteria",
        question: originalQuestion,
        status: "allowed",
        reason: verdict.reason,
        cstUserId,
        telegramUserId,
        telegramChatId,
        responseSummary: summaryStr,
        responseBytes: JSON.stringify(compactData).length,
        contextId: verdict.contextId,
      });

      return { ok: true, data: compactData, summary: summaryStr };
    } catch (e: any) {
      return { ok: false, error: `Account search failed: ${e?.message || e}` };
    }
  },
});

// ─── compare_accounts ─────────────────────────────────────────────────
registerTool({
  name: "compare_accounts",
  category: "external",
  description: "Compare 2-5 accounts side-by-side: their tier, EBA scores, V5 readiness, SSOT, CC/F2F compliance, and AI summaries. Accepts a list of account names (partial match accepted). ONLY callable in the Super Admin context.",
  inputSchema: {
    type: "object",
    properties: {
      accountNames: {
        type: "array",
        items: { type: "string" },
        description: "2-5 partial or full account names to compare",
      },
      question: { type: "string", description: "The original user question (for audit log only)" },
    },
    required: ["accountNames"],
  },
  defaultEnabled: false,
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    const { accessInput, cstUserId, telegramUserId, telegramChatId, originalQuestion } = await buildAccessInput(ctx, input?.question);
    const verdict = await checkSuperAdminAccess(accessInput);
    if (!verdict.allowed) {
      return refuseAndLog({ toolName: "compare_accounts", question: originalQuestion, verdict, cstUserId, telegramUserId, telegramChatId });
    }

    const names: string[] = Array.isArray(input?.accountNames) ? input.accountNames : [];
    if (names.length < 2 || names.length > 5) {
      return { ok: false, error: "Provide 2-5 account names to compare." };
    }

    try {
      const { buildExecutiveSummary } = await import("@/lib/accounts/executive-summary");
      const summary = await buildExecutiveSummary();

      const matched: any[] = [];
      const notFound: string[] = [];
      for (const name of names) {
        const lower = String(name).toLowerCase().trim();
        const hit = summary.accounts.find(a => a.companyName.toLowerCase().includes(lower));
        if (hit) matched.push(hit);
        else notFound.push(name);
      }

      if (matched.length === 0) {
        return { ok: false, error: `None of these accounts matched: ${notFound.join(", ")}` };
      }

      const compactData = {
        notFound,
        accounts: matched.map(a => ({
          name: a.companyName,
          tier: a.tier || null,
          group: a.groupName || null,
          rm: a.primaryRmName || a.rmEmail || null,
          health: a.health.color,
          healthScore: a.health.score,
          healthReasons: a.health.reasons,
          satisfaction: a.satisfaction,
          ebaDecisionMaker: a.ebaDecisionMaker,
          ebaAdmin: a.ebaAdmin,
          v5Readiness: a.v5Readiness,
          ssot: a.isTarkieSsot === true ? "Tarkie" : a.isTarkieSsot === false ? (a.thirdPartySsot || "Other") : "Unknown",
          ccCompliance: a.complianceStatus,
          f2fCompliance: a.f2fComplianceStatus,
          lastCC: a.lastCourtesyCall || null,
          lastF2F: a.lastF2FVisit || null,
          aiSummary: a.aiSummary,
        })),
      };

      const summaryStr = `Compared ${matched.length} accounts${notFound.length > 0 ? `, ${notFound.length} not found` : ""}`;
      await logSuperAdminAccess({
        toolName: "compare_accounts",
        question: originalQuestion,
        status: "allowed",
        reason: verdict.reason,
        cstUserId,
        telegramUserId,
        telegramChatId,
        responseSummary: summaryStr,
        responseBytes: JSON.stringify(compactData).length,
        contextId: verdict.contextId,
      });

      return { ok: true, data: compactData, summary: summaryStr };
    } catch (e: any) {
      return { ok: false, error: `Compare failed: ${e?.message || e}` };
    }
  },
});
