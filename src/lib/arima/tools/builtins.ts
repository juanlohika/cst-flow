/**
 * Built-in tools for ARIMA. Imported once on app boot via /lib/arima/tools/index.ts
 * to register them with the in-memory registry.
 *
 * Each tool is scoped to ctx.clientProfileId — they CANNOT cross client
 * boundaries by design, even if the AI is somehow tricked into providing a
 * different client_id (we ignore that field and use ctx.clientProfileId).
 */
import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  arimaRequests,
  tarkieMeetings,
  meetingAssignments,
  accountMemberships,
  users as usersTable,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { registerTool, type ToolContext } from "./registry";
import { dispatchNotification } from "@/lib/notifications/dispatcher";

// ─── Helpers ───────────────────────────────────────────────────────────

async function loadCurrentClient(ctx: ToolContext) {
  if (!ctx.clientProfileId) return null;
  const rows = await db.select().from(clientProfilesTable).where(eq(clientProfilesTable.id, ctx.clientProfileId)).limit(1);
  return rows[0] || null;
}

function noClientResult() {
  return { ok: false as const, error: "This conversation isn't linked to a specific client account, so I can't access account data." };
}

// ─── get_client_profile ────────────────────────────────────────────────
registerTool({
  name: "get_client_profile",
  category: "read",
  description: "Returns the full CRM profile of the current client account: company names (short + long), industry, modules contracted, engagement status, primary contact, plus Phase E CRM fields — tier (VIP|1-5), group name (parent group for sibling accounts), group tier, internal team (Relationship Manager / Project Manager / Business Analyst by email), assigned-on month, last courtesy call date, courtesy-call cadence and compliance status (compliant | warning | overdue based on tier-derived frequency vs days since last call). Use this to answer ANY factual question about the client: who their RM is, what tier they're on, how long they've been with us, when we last called them, are they due for a check-in, what group they belong to, what they're contracted on, etc.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (_input, ctx) => {
    const c = await loadCurrentClient(ctx);
    if (!c) return noClientResult();
    let modules: string[] = [];
    try { modules = JSON.parse(c.modulesAvailed || "[]"); } catch {}

    // Resolve module slugs → labels (so "trade-check-form" comes back as "Trade Check Form")
    let moduleLabels: string[] = modules;
    try {
      const { accountModules } = await import("@/db/schema");
      const { inArray } = await import("drizzle-orm");
      if (modules.length > 0) {
        const rows = await db
          .select({ slug: accountModules.slug, label: accountModules.label })
          .from(accountModules)
          .where(inArray(accountModules.slug, modules));
        const labelBySlug = new Map(rows.map(r => [r.slug, r.label]));
        moduleLabels = modules.map(s => labelBySlug.get(s) || s);
      }
    } catch { /* if master modules table doesn't exist, fall back to raw slugs */ }

    // Compute courtesy-call compliance
    let compliance: any = null;
    try {
      const { loadTierFrequencyMap, resolveAccountFrequency, callCompliance } = await import("@/lib/accounts/tier-frequency");
      const tierMap = await loadTierFrequencyMap();
      const freq = resolveAccountFrequency({
        tier: (c as any).tier || null,
        frequencyOverride: (c as any).frequencyOverride || null,
        tierMap,
      });
      const cc = callCompliance({
        lastCourtesyCall: (c as any).lastCourtesyCall || null,
        frequencyDays: freq.days,
      });
      compliance = {
        callFrequency: freq.label,
        callFrequencyDays: freq.days,
        callFrequencySource: freq.source,         // 'override' | 'tier' | 'unknown'
        complianceStatus: cc.status,              // 'compliant' | 'warning' | 'overdue' | 'unknown'
        daysSinceLastCall: cc.daysSince,
      };
    } catch { /* non-fatal */ }

    const data: any = {
      // Identity
      companyName: c.companyName,
      clientShortName: (c as any).clientShortName || null,
      clientLongName: (c as any).clientLongName || null,
      industry: c.industry,
      companySize: c.companySize || null,
      engagementStatus: c.engagementStatus,
      // Modules
      modulesAvailed: moduleLabels,
      modulesAvailedSlugs: modules,
      // Contact
      primaryContact: c.primaryContact || null,
      primaryContactEmail: c.primaryContactEmail || null,
      specialConsiderations: c.specialConsiderations || null,
      // CRM
      tier: (c as any).tier || null,
      groupTier: (c as any).groupTier || null,
      groupName: (c as any).groupName || null,
      relationshipManagerEmail: (c as any).rmEmail || null,
      projectManagerEmail: (c as any).pmEmail || null,
      businessAnalystEmail: (c as any).baEmail || null,
      assignedOnMonth: (c as any).assignedOnMonth || null,   // YYYY-MM
      lastCourtesyCall: (c as any).lastCourtesyCall || null, // YYYY-MM-DD
      // Compliance
      courtesyCall: compliance,
    };

    const summaryParts = [c.companyName];
    if ((c as any).tier) summaryParts.push((c as any).tier === "VIP" ? "VIP tier" : `Tier ${(c as any).tier}`);
    if ((c as any).groupName) summaryParts.push(`Group: ${(c as any).groupName}`);
    summaryParts.push(c.industry);
    summaryParts.push(`${moduleLabels.length} module(s)`);

    return {
      ok: true,
      data,
      summary: summaryParts.join(" · "),
    };
  },
});

// ─── get_contract_scope ────────────────────────────────────────────────
registerTool({
  name: "get_contract_scope",
  category: "read",
  description: "Returns the account's intelligence/scope content — the markdown notes the CST team has written about what's in scope, special rules, pain points, and decision-makers for this client. Use this when answering anything about what the client has contracted, their context, or how to work with them.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (_input, ctx) => {
    const c = await loadCurrentClient(ctx);
    if (!c) return noClientResult();
    const content = (c.intelligenceContent || "").trim();
    if (!content) {
      return {
        ok: true,
        data: { scope: null },
        summary: "No intelligence content has been written for this account yet.",
      };
    }
    return {
      ok: true,
      data: { scope: content.length > 4000 ? content.slice(0, 4000) + "\n[…truncated]" : content },
      summary: `Loaded ${content.length} chars of scope notes.`,
    };
  },
});

// ─── get_account_health ──────────────────────────────────────────────
registerTool({
  name: "get_account_health",
  category: "read",
  description: "Returns the latest Health Assessment for the current client account, including the computed health color (green | yellow | red | grey), score (0-100), the structured scores (EBA Decision Maker, EBA Admin, satisfaction, V5 readiness, SSOT status), the AI-generated CEO summary, top risks, top opportunities, notable client requests, and requested modules. Use this when the user asks 'how is this account doing?', 'what's their EBA?', 'are they at risk?', 'are they V5-ready?', 'what do they want?', or anything about the strategic state of the relationship. Returns null assessment if no health check has been submitted yet.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (_input, ctx) => {
    if (!ctx.clientProfileId) return noClientResult();
    try {
      const { accountAssessments } = await import("@/db/schema");
      const { desc, eq } = await import("drizzle-orm");
      const { computeHealth } = await import("@/lib/accounts/health-score");

      const rows = await db
        .select()
        .from(accountAssessments)
        .where(eq(accountAssessments.clientProfileId, ctx.clientProfileId))
        .orderBy(desc(accountAssessments.submittedAt))
        .limit(1);

      if (rows.length === 0) {
        return {
          ok: true,
          data: { hasAssessment: false },
          summary: "No health assessment has been submitted for this account yet.",
        };
      }

      const a: any = rows[0];
      const health = computeHealth({
        satisfaction: a.satisfaction,
        ebaDecisionMaker: a.ebaDecisionMaker,
        ebaAdmin: a.ebaAdmin,
        v5Readiness: a.v5Readiness,
        isTarkieSsot: a.isTarkieSsot,
        thirdPartySsot: a.thirdPartySsot,
        contactChangeRecent: a.contactChangeRecent,
      });

      const parseArr = (s: string | null) => {
        if (!s) return [];
        try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
      };

      const data = {
        hasAssessment: true,
        submittedAt: a.submittedAt,
        // Computed color + score
        healthColor: health.color,            // 'green' | 'yellow' | 'red' | 'grey'
        healthScore: health.score,            // 0-100
        isCritical: health.isCritical,
        healthReasons: health.reasons,        // Human-readable bullets explaining the color
        // Structured scores
        satisfaction: a.satisfaction,         // 1-5
        ebaDecisionMaker: a.ebaDecisionMaker, // 1-5
        ebaDecisionMakerNote: a.ebaDecisionMakerNote || null,
        ebaAdmin: a.ebaAdmin,                 // 1-5
        ebaAdminNote: a.ebaAdminNote || null,
        v5Readiness: a.v5Readiness,           // 1-5
        // SSOT
        isTarkieSsot: a.isTarkieSsot,
        thirdPartySsot: a.thirdPartySsot || null,
        // Contact churn
        contactChangeRecent: !!a.contactChangeRecent,
        contactChangeNote: a.contactChangeNote || null,
        // AI rollup
        aiSummary: a.aiSummary || null,
        aiRisks: parseArr(a.aiRisks),
        aiOpportunities: parseArr(a.aiOpportunities),
        notableRequests: parseArr(a.notableRequests),
        requestedModules: parseArr(a.requestedModules),
        aiRollupStatus: a.aiRollupStatus,
      };

      const colorLabel = health.color === "grey" ? "unassessed" : health.color.toUpperCase();
      const summary = `Health: ${colorLabel} (${health.score}/100)${health.isCritical ? " · CRITICAL" : ""}${a.aiSummary ? ` — ${String(a.aiSummary).slice(0, 120)}…` : ""}`;
      return { ok: true, data, summary };
    } catch (e: any) {
      return { ok: false, error: `Failed to load health assessment: ${e?.message || e}` };
    }
  },
});

// ─── list_my_requests ──────────────────────────────────────────────────
registerTool({
  name: "list_my_requests",
  category: "read",
  description: "Lists open requests/asks that have been captured for the current client. Use this when the user asks 'what have we asked about?', 'what's pending?', or wants to know the status of a previous request.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["new", "in-progress", "done", "any"], description: "Filter by status (default: any)" },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "How many to return (default 10)" },
    },
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    if (!ctx.clientProfileId) return noClientResult();
    const limit = Math.min(20, Math.max(1, input?.limit || 10));
    const conditions: any[] = [eq(arimaRequests.clientProfileId, ctx.clientProfileId)];
    if (input?.status && input.status !== "any") {
      conditions.push(eq(arimaRequests.status, input.status));
    }
    const rows = await db
      .select({
        id: arimaRequests.id,
        title: arimaRequests.title,
        category: arimaRequests.category,
        priority: arimaRequests.priority,
        status: arimaRequests.status,
        createdAt: arimaRequests.createdAt,
      })
      .from(arimaRequests)
      .where(and(...conditions))
      .orderBy(desc(arimaRequests.createdAt))
      .limit(limit);

    return {
      ok: true,
      data: { requests: rows, count: rows.length },
      summary: rows.length === 0 ? "No requests on file." : `Found ${rows.length} request(s).`,
    };
  },
});

// ─── get_recent_meetings ───────────────────────────────────────────────
registerTool({
  name: "get_recent_meetings",
  category: "read",
  description: "Returns the most recent meetings linked to the current client. Use this when the user asks 'when did we last meet?', 'what was discussed?', or wants meeting context.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 10, description: "How many meetings (default 5)" },
    },
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    if (!ctx.clientProfileId) return noClientResult();
    const limit = Math.min(10, Math.max(1, input?.limit || 5));
    const rows = await db
      .select({
        id: tarkieMeetings.id,
        title: tarkieMeetings.title,
        meetingType: tarkieMeetings.meetingType,
        scheduledAt: tarkieMeetings.scheduledAt,
        status: tarkieMeetings.status,
      })
      .from(tarkieMeetings)
      .where(eq(tarkieMeetings.clientProfileId, ctx.clientProfileId))
      .orderBy(desc(tarkieMeetings.scheduledAt))
      .limit(limit);
    return {
      ok: true,
      data: { meetings: rows, count: rows.length },
      summary: rows.length === 0 ? "No meetings on record." : `Found ${rows.length} meeting(s).`,
    };
  },
});

// ─── create_request (proper tool version) ──────────────────────────────
registerTool({
  name: "create_request",
  category: "write",
  description: "Captures a new client request as a structured row in the CST team's request inbox. Use this when the user is making a concrete ask (new feature, bug, config change, etc.) and you want to log it for human follow-up. Do NOT use for casual chat or escalation topics.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title, max 100 chars" },
      description: { type: "string", description: "2-4 sentence summary" },
      category: { type: "string", enum: ["feature", "bug", "question", "config", "meeting", "other"] },
      priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
    },
    required: ["title", "category", "priority"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    if (!input?.title) return { ok: false, error: "Title required" };
    const id = `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(arimaRequests).values({
      id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      clientProfileId: ctx.clientProfileId || null,
      title: String(input.title).slice(0, 200),
      description: input.description || null,
      category: input.category || "other",
      priority: input.priority || "medium",
      status: "new",
      createdAt: now,
      updatedAt: now,
    });

    // Notify everyone with access to this client
    if (ctx.clientProfileId) {
      try {
        const members = await db
          .select({ userId: accountMemberships.userId })
          .from(accountMemberships)
          .where(eq(accountMemberships.clientProfileId, ctx.clientProfileId));
        const recipientIds = members.map(m => m.userId);
        const c = await loadCurrentClient(ctx);
        const priorityEmoji = input.priority === "urgent" ? "🚨" : input.priority === "high" ? "⚡" : input.priority === "low" ? "📌" : "📬";
        await dispatchNotification({
          userIds: recipientIds,
          type: "request_captured",
          title: `${priorityEmoji} New ${input.category} request from ${c?.companyName || "client"}`,
          body: input.title,
          link: `/arima?view=requests&id=${id}`,
        });
      } catch {}
    }

    return {
      ok: true,
      data: { requestId: id, title: input.title, status: "new" },
      summary: `Captured: "${input.title}" (${input.priority} priority, ${input.category})`,
    };
  },
});

// ─── schedule_meeting (WRITE — disabled by default) ───────────────────
registerTool({
  name: "schedule_meeting",
  category: "write",
  description: "Schedules a meeting for the current client by creating a TarkieMeeting row. The meeting starts as 'scheduled' with no Zoom link (link can be added later). Use this when the user asks to set up a call.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Meeting title, e.g. 'Quarterly review with Acme'" },
      scheduledAt: { type: "string", description: "ISO 8601 datetime, e.g. '2026-05-20T10:00:00Z'" },
      durationMinutes: { type: "integer", description: "Length in minutes, default 60", minimum: 15, maximum: 240 },
      meetingType: { type: "string", enum: ["kickoff", "review", "follow-up", "discovery", "other"], description: "Default 'other'" },
    },
    required: ["title", "scheduledAt"],
  },
  defaultEnabled: false,                  // ship disabled — admin opts in
  defaultAutonomy: "approval",            // even when enabled, default to human approval
  handler: async (input, ctx) => {
    if (!ctx.clientProfileId) return noClientResult();
    if (!input?.title || !input?.scheduledAt) {
      return { ok: false, error: "title and scheduledAt are required" };
    }
    const scheduledDate = new Date(input.scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return { ok: false, error: "scheduledAt is not a valid ISO datetime" };
    }
    const id = `mtg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db.insert(tarkieMeetings).values({
      id,
      userId: ctx.userId,                              // capturer
      clientProfileId: ctx.clientProfileId,
      title: input.title,
      meetingType: input.meetingType || "other",
      scheduledAt: scheduledDate.toISOString(),
      durationMinutes: input.durationMinutes || 60,
      status: "scheduled",
      activeApps: "[]",
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      data: { meetingId: id, scheduledAt: scheduledDate.toISOString() },
      summary: `Scheduled "${input.title}" for ${scheduledDate.toLocaleString()}.`,
    };
  },
});

// ─── notify_internal_team (WRITE — disabled by default) ───────────────
registerTool({
  name: "notify_internal_team",
  category: "write",
  description: "Sends an urgent ping to every CST OS user who has access to the current client. Use only when the user has something time-sensitive that the team should see right now.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "What to tell the team" },
      urgency: { type: "string", enum: ["normal", "high", "urgent"], description: "Default 'normal'" },
    },
    required: ["summary"],
  },
  defaultEnabled: false,
  defaultAutonomy: "approval",
  handler: async (input, ctx) => {
    if (!ctx.clientProfileId) return noClientResult();
    const members = await db
      .select({ userId: accountMemberships.userId })
      .from(accountMemberships)
      .where(eq(accountMemberships.clientProfileId, ctx.clientProfileId));
    const recipientIds = members.map(m => m.userId);
    if (recipientIds.length === 0) {
      return { ok: false, error: "No team members are assigned to this account." };
    }
    const c = await loadCurrentClient(ctx);
    const icon = input.urgency === "urgent" ? "🚨" : input.urgency === "high" ? "⚡" : "ℹ️";
    await dispatchNotification({
      userIds: recipientIds,
      type: "mention",
      title: `${icon} Internal alert from ${c?.companyName || "client"}`,
      body: input.summary,
      link: `/arima?clientId=${ctx.clientProfileId}`,
    });
    return {
      ok: true,
      data: { notified: recipientIds.length },
      summary: `Notified ${recipientIds.length} team member(s).`,
    };
  },
});

// ─── send_telegram_dm (Phase 21 — Coordinator) ─────────────────────────
// The big one: agent reaches out privately to a specific person, with the
// permission-grant flow handling first-time targets.
//
// Authority gates (enforced in handler):
//   - Speaker MUST be owner-tier (linked CST OS admin) OR member-tier to
//     direct this tool. Guests cannot.
//   - Member-tier can DM other internal teammates but NOT clients.
//   - Owner-tier can DM anyone.
//
// Three possible outcomes:
//   - ok: true, sent immediately (target has DM consent, message delivered)
//   - ok: true, awaitingConsent: true (target found but no DM consent yet;
//     a permission-grant button was posted in the GC instead)
//   - ok: false (unknown target, or speaker lacks authority, or target is
//     external — clients aren't reachable via Telegram DM)
registerTool({
  name: "send_telegram_dm",
  category: "write",
  description: "Privately message a specific person via Telegram on the user's behalf. The speaker (the person asking) must be a linked CST OS user; clients in a group chat cannot direct this tool. If the target hasn't given DM consent yet, the system posts an inline permission-grant button in the group chat — the target taps it to allow DMs from the bot, then the queued message is sent automatically.",
  inputSchema: {
    type: "object",
    properties: {
      targetName: {
        type: "string",
        description: "Name (or @username) of the person to DM. Resolved against the CST OS team and the bound client's contacts.",
      },
      messageBody: {
        type: "string",
        description: "The message to send. Speak as if the requesting human asked you to relay it — be concise, professional, and explain who's sending the message and why.",
      },
      topic: {
        type: "string",
        description: "Short label describing the subject of the DM, e.g. 'pricing breakdown', 'meeting schedule', 'SSO requirements'. Used in the permission-grant button text.",
      },
    },
    required: ["targetName", "messageBody"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    // Lazy imports so registry boot doesn't pull telegram deps until needed
    const { classifyTelegramSpeaker, classifyTarget } = await import("@/lib/arima/authority");
    const {
      resolveCoordinationTarget,
      generateConsentToken,
      consentExpiresAt,
      consentDeepLink,
      hasDmConsent,
    } = await import("@/lib/arima/coordinator");
    const { getTelegramConfig } = await import("@/lib/telegram/config");
    const { tgSendMessage, truncateForTelegram, tgGetMe } = await import("@/lib/telegram/api");
    const { coordinatorRelays } = await import("@/db/schema");

    if (ctx.channel !== "telegram") {
      return { ok: false, error: "This tool only works from a Telegram group chat. Use a different channel for portal/web messages." };
    }
    if (!ctx.speakerTelegramUserId) {
      return { ok: false, error: "Couldn't identify who's asking — speaker Telegram id missing from context." };
    }

    // Authority check
    const auth = await classifyTelegramSpeaker({
      telegramUserId: ctx.speakerTelegramUserId,
      clientProfileId: ctx.clientProfileId,
    });
    if (auth.tier === "guest") {
      return {
        ok: false,
        error: `Sorry — only linked CST OS team members can direct the agent to send private messages. ${auth.cstUserId ? "" : "You'll need to link your Telegram first via /link in DM with the bot."}`,
      };
    }

    // Resolve the target
    const target = await resolveCoordinationTarget({
      rawName: input.targetName,
      clientProfileId: ctx.clientProfileId,
    });
    if (!target) {
      return { ok: false, error: `Couldn't find anyone matching "${input.targetName}". Try the full name or @telegram-handle.` };
    }

    // Member-tier may NOT DM external (client) targets
    if (auth.tier === "member" && target.kind === "external-portal") {
      return {
        ok: false,
        error: "Only admins can direct the agent to message clients privately. Please ask an admin, or send the message yourself.",
      };
    }

    const cfg = await getTelegramConfig();
    if (!cfg.botToken) {
      return { ok: false, error: "Telegram bot isn't configured. Admin should set it up under /admin/telegram." };
    }

    // External (client) target → we can't reach them via Telegram. Suggest
    // alternative channels.
    if (target.kind === "external-portal") {
      return {
        ok: false,
        error: `${target.displayName} is a client portal contact — Telegram DMs don't reach them. They'll see messages posted in this group (their portal mirrors it). To send something privately, use email or invite them to a separate discovery group.`,
      };
    }

    // Internal target with no linked Telegram → can't DM at all
    if (target.kind === "internal-no-telegram") {
      return {
        ok: false,
        error: `${target.displayName} hasn't linked their Telegram account to CST OS yet, so I can't DM them. Ask them to run /link in DM with the bot first. (For now, the request was NOT delivered.)`,
      };
    }

    // From here on: internal target WITH linked Telegram
    const messageBody = truncateForTelegram(String(input.messageBody || "").trim());
    const topic = String(input.topic || "").trim();
    const dmPreamble = `📨 *${auth.cstUserName || ctx.speakerName || "A teammate"}* asked me to relay this to you${topic ? ` about *${topic.replace(/[*_]/g, "")}*` : ""}:`;
    const fullDmText = `${dmPreamble}\n\n${messageBody}`;

    // Direct DM path — target has already consented
    if (target.hasDmConsent && target.telegramUserId) {
      try {
        const sent = await tgSendMessage(cfg.botToken, target.telegramUserId, fullDmText, {
          parseMode: "Markdown",
          disablePreview: true,
        });
        // Record relay for response correlation
        const relayId = `crly_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
        await db.insert(coordinatorRelays).values({
          id: relayId,
          conversationId: ctx.conversationId,
          sourceTelegramChatId: ctx.sourceTelegramChatId || null,
          targetTelegramUserId: target.telegramUserId,
          targetTelegramUsername: target.telegramUsername || null,
          targetDisplayName: target.displayName,
          requestedByUserId: auth.cstUserId || ctx.userId,
          requestedByName: auth.cstUserName || ctx.speakerName || null,
          agentMode: ctx.agentMode || "arima",
          topic: topic || null,
          pendingMessage: messageBody,
          status: "awaiting-reply",
          sentMessageId: String(sent?.message_id || ""),
          createdAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
        });
        return {
          ok: true,
          data: {
            relayId,
            target: target.displayName,
            telegramUsername: target.telegramUsername,
            status: "sent",
          },
          summary: `Sent DM to ${target.displayName}. I'll relay their reply back here when they respond.`,
        };
      } catch (e: any) {
        return { ok: false, error: `Couldn't deliver the DM — ${e?.message || "unknown error"}. The team will need to reach them another way.` };
      }
    }

    // Otherwise: target hasn't consented to DMs yet → post permission-grant button
    if (!ctx.sourceTelegramChatId) {
      return { ok: false, error: "Permission-grant flow needs a source group chat to post the consent button into, but it wasn't provided in context. Try asking from inside the group chat." };
    }
    if (!target.telegramUserId) {
      return { ok: false, error: `${target.displayName} can't be DM'd yet — Telegram account info missing.` };
    }

    // Get our bot's username (for the deep-link)
    let botUsername = "";
    try {
      const me = await tgGetMe(cfg.botToken);
      botUsername = me?.username || "";
    } catch {}
    if (!botUsername) {
      return { ok: false, error: "Couldn't determine the bot username. Admin should verify /admin/telegram is configured." };
    }

    // Persist a pending relay row + consent token
    const consentToken = generateConsentToken();
    const relayId = `crly_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(coordinatorRelays).values({
      id: relayId,
      conversationId: ctx.conversationId,
      sourceTelegramChatId: ctx.sourceTelegramChatId,
      targetTelegramUserId: target.telegramUserId,
      targetTelegramUsername: target.telegramUsername || null,
      targetDisplayName: target.displayName,
      requestedByUserId: auth.cstUserId || ctx.userId,
      requestedByName: auth.cstUserName || ctx.speakerName || null,
      agentMode: ctx.agentMode || "arima",
      topic: topic || null,
      pendingMessage: messageBody,
      status: "awaiting-consent",
      consentToken,
      createdAt: new Date().toISOString(),
      expiresAt: consentExpiresAt(),
    });

    // Post the inline-keyboard button in the source group
    const deepLink = consentDeepLink(botUsername, consentToken);
    const escape = (s: string) => s.replace(/([_*`\[\]()])/g, "\\$1");
    const promptText = [
      `👋 Hi *${escape(target.displayName)}*${target.telegramUsername ? ` (@${escape(target.telegramUsername)})` : ""} —`,
      `*${escape(auth.cstUserName || ctx.speakerName || "A teammate")}* asked me to send you a private message${topic ? ` about *${escape(topic)}*` : ""}.`,
      "",
      "I can't DM you yet because we haven't been introduced in private. Tap the button below once — it takes 2 seconds — and I'll relay the message immediately.",
      "",
      "_(One-time setup. After this, I can reach you anytime your teammates ask.)_",
    ].join("\n");

    await tgSendMessage(cfg.botToken, ctx.sourceTelegramChatId, truncateForTelegram(promptText), {
      parseMode: "Markdown",
      disablePreview: true,
      inlineKeyboard: [
        [{ text: `✓ Allow ${target.displayName.split(/\s+/)[0]} to receive DMs`, url: deepLink }],
      ],
    });

    return {
      ok: true,
      data: {
        relayId,
        target: target.displayName,
        status: "awaiting-consent",
      },
      summary: `Posted a permission-grant button for ${target.displayName}. The DM will be sent once they tap it.`,
    };
  },
});

// ─── share_brd_pdf (Phase 22.3 — Eliana/ARIMA BRD share) ────────────────────
// Returns the read-only PDF link for a BRD so the agent can share it with
// stakeholders for review.
//
// Security model: the *link* is freely shareable, but the *file* is gated by
// Google Drive's native permissions. If the recipient doesn't have access to
// the Drive folder, clicking the link triggers Drive's "Request access" flow
// — a human teammate then approves the access grant from within Drive itself.
// This is simpler than building a parallel approval queue inside CST OS, and
// keeps the audit trail in Drive's "Shared with" history where teams already
// expect it.
registerTool({
  name: "share_brd_pdf",
  category: "external",
  description: "Share the read-only PDF link of a BRD with stakeholders for review. The agent picks the most recent exported BRD for the current client (or matches by titleHint if provided). Returns the Drive PDF link to include in the reply. The link itself is shareable, but recipients without Drive folder access will see Google's 'Request access' prompt — a human teammate then grants access from Drive directly.",
  inputSchema: {
    type: "object",
    properties: {
      titleHint: {
        type: "string",
        description: "Optional: a phrase from the BRD title to disambiguate when the client has multiple BRDs. Omit to pick the most recent exported BRD.",
      },
      recipientNote: {
        type: "string",
        description: "Short context to attach when relaying the link (e.g. 'for your review by Friday'). Keep under 200 chars.",
      },
    },
    required: [],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input, ctx) => {
    if (!ctx.clientProfileId) return noClientResult();

    // Find the most recent BRD for this client that has a PDF URL.
    const candidates = await db
      .select({
        id: arimaRequests.id,
        title: arimaRequests.title,
        brdPdfUrl: arimaRequests.brdPdfUrl,
        brdDocxUrl: arimaRequests.brdDocxUrl,
        brdStatus: arimaRequests.brdStatus,
        createdAt: arimaRequests.createdAt,
      })
      .from(arimaRequests)
      .where(and(
        eq(arimaRequests.clientProfileId, ctx.clientProfileId),
        eq(arimaRequests.category, "brd"),
      ))
      .orderBy(desc(arimaRequests.createdAt))
      .limit(20);

    const exported = candidates.filter(c => c.brdPdfUrl);
    if (exported.length === 0) {
      return {
        ok: false,
        error: "No BRD has been exported to Drive yet for this client. Generate and export a BRD first (the PDF gets created automatically alongside the Word file).",
      };
    }

    const hint = String(input?.titleHint || "").trim().toLowerCase();
    let chosen = exported[0];
    if (hint) {
      const match = exported.find(c => c.title.toLowerCase().includes(hint));
      if (match) chosen = match;
    }

    const note = String(input?.recipientNote || "").trim().slice(0, 200);

    return {
      ok: true,
      data: {
        brdId: chosen.id,
        title: chosen.title,
        pdfUrl: chosen.brdPdfUrl,
        docxUrl: chosen.brdDocxUrl || null,
        note: note || null,
      },
      summary: `BRD ready to share: "${chosen.title}" — PDF link: ${chosen.brdPdfUrl}${note ? `. Note: ${note}` : ""}`,
    };
  },
});

// ─── Courtesy calls & timeline (Phase 1 write tools) ───────────────────
//
// These let an RM tell ARIMA "done — we called them today" in chat instead of
// opening the console. They are deliberately narrow: each one writes a single
// record scoped to ctx.clientProfileId, and none can reach another account.
//
// Date handling: the AI resolves natural language ("today", "last Tuesday") to
// an absolute YYYY-MM-DD before calling. We validate the format and refuse a
// future date rather than silently recording something impossible.

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

/** Validates a YYYY-MM-DD date that must not be in the future. */
function checkPastDate(value: unknown, label: string): { date: string } | { error: string } {
  const d = String(value ?? "").trim();
  if (!YMD.test(d)) return { error: `${label} must be a date in YYYY-MM-DD format.` };
  if (d > todayYMD()) return { error: `${label} (${d}) is in the future — record it once it has happened.` };
  return { date: d };
}

registerTool({
  name: "log_courtesy_call",
  category: "write",
  description:
    "Records that a courtesy call HAPPENED for the current client account. Use when the RM says the call is done — e.g. 'we did the courtesy call today', 'called them last Tuesday'. Resolve relative dates to an absolute YYYY-MM-DD yourself before calling. Optionally records the date the minutes of meeting (MOM) were sent; if the RM has not mentioned the MOM, leave it out and ask them separately rather than guessing. This also refreshes the account's last-courtesy-call date used for compliance.",
  inputSchema: {
    type: "object",
    properties: {
      call_date: { type: "string", description: "Date the call took place, YYYY-MM-DD. Never a future date." },
      mom_sent_date: { type: "string", description: "Optional. Date the minutes of meeting were sent, YYYY-MM-DD." },
      notes: { type: "string", description: "Optional one-line note about what was discussed." },
    },
    required: ["call_date"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input: any, ctx: ToolContext) => {
    const c = await loadCurrentClient(ctx);
    if (!c) return noClientResult();

    const call = checkPastDate(input?.call_date, "call_date");
    if ("error" in call) return { ok: false as const, error: call.error };

    let mom: string | null = null;
    if (input?.mom_sent_date) {
      const m = checkPastDate(input.mom_sent_date, "mom_sent_date");
      if ("error" in m) return { ok: false as const, error: m.error };
      if (m.date < call.date) {
        return { ok: false as const, error: `The MOM date (${m.date}) is before the call itself (${call.date}). Please confirm both dates.` };
      }
      mom = m.date;
    }

    const now = new Date().toISOString();
    const id = `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const { courtesyCallHistory } = await import("@/db/schema");

    await db.insert(courtesyCallHistory).values({
      id,
      clientProfileId: c.id,
      callDate: call.date,
      momSentDate: mom,
      complianceStatus: mom ? "compliant" : "incomplete",
      // The live column is NOT NULL, so it always gets a value. ctx.userId is a
      // ClientContact id on portal calls, so we mark those explicitly rather
      // than passing a contact id off as a CST OS user.
      loggedByUserId: ctx.channel === "portal" ? "portal-contact" : ctx.userId,
      // rmUserId IS nullable — left null when we cannot attribute to a real RM.
      rmUserId: ctx.channel === "portal" ? null : ctx.userId,
      notes: typeof input?.notes === "string" ? input.notes.trim() || null : null,
      createdAt: now,
      updatedAt: now,
    } as any);

    // ClientProfile.lastCourtesyCall is a read cache that existing screens and
    // get_client_profile already read. CourtesyCallHistory stays the source of
    // truth — MAX(callDate) — so we only ever move the cache FORWARD. An RM
    // back-filling an older call must not overwrite a more recent one.
    if (!c.lastCourtesyCall || call.date > c.lastCourtesyCall) {
      await db.update(clientProfilesTable)
        .set({ lastCourtesyCall: call.date, updatedAt: now } as any)
        .where(eq(clientProfilesTable.id, c.id));
    }

    const label = c.clientShortName || c.companyName;
    return {
      ok: true as const,
      call_date: call.date,
      mom_sent_date: mom,
      summary: mom
        ? `Logged — courtesy call for ${label} on ${call.date}, MOM sent ${mom}. This period is compliant.`
        : `Logged — courtesy call for ${label} on ${call.date}. The MOM is not recorded yet, so this period is not compliant until it is sent.`,
    };
  },
});

registerTool({
  name: "log_mom_sent",
  category: "write",
  description:
    "Records the date the minutes of meeting (MOM) were sent for a courtesy call that is ALREADY logged. Use when the RM says the MOM has gone out but the call was recorded earlier. Updates the most recent courtesy call for this account that has no MOM date yet.",
  inputSchema: {
    type: "object",
    properties: {
      mom_sent_date: { type: "string", description: "Date the MOM was sent, YYYY-MM-DD." },
    },
    required: ["mom_sent_date"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input: any, ctx: ToolContext) => {
    const c = await loadCurrentClient(ctx);
    if (!c) return noClientResult();

    const m = checkPastDate(input?.mom_sent_date, "mom_sent_date");
    if ("error" in m) return { ok: false as const, error: m.error };

    const { courtesyCallHistory } = await import("@/db/schema");
    const { isNull } = await import("drizzle-orm");

    const open = await db.select()
      .from(courtesyCallHistory)
      .where(and(
        eq(courtesyCallHistory.clientProfileId, c.id),
        isNull(courtesyCallHistory.momSentDate),
      ))
      .orderBy(desc(courtesyCallHistory.callDate))
      .limit(1);

    const row = open[0];
    if (!row) {
      return {
        ok: false as const,
        error: "There is no logged courtesy call for this account that is still waiting on a MOM. If the call itself has not been recorded, log the call first.",
      };
    }
    if (m.date < row.callDate!) {
      return { ok: false as const, error: `The MOM date (${m.date}) is before the call it belongs to (${row.callDate}). Please confirm both dates.` };
    }

    await db.update(courtesyCallHistory)
      .set({ momSentDate: m.date, complianceStatus: "compliant", updatedAt: new Date().toISOString() } as any)
      .where(eq(courtesyCallHistory.id, row.id));

    return {
      ok: true as const,
      call_date: row.callDate,
      mom_sent_date: m.date,
      summary: `Recorded — MOM for the ${row.callDate} courtesy call was sent on ${m.date}. That period is now compliant.`,
    };
  },
});

registerTool({
  name: "list_due_timeline_tasks",
  category: "read",
  description:
    "Lists the current client account's implementation timeline tasks that are due or overdue and not yet completed. Use before asking an RM for a status update, so you name specific tasks rather than asking vaguely. Returns each task's code, subject, planned dates, owner and how many days overdue it is.",
  inputSchema: {
    type: "object",
    properties: {
      include_upcoming_days: {
        type: "number",
        description: "Optional. Also include tasks due within this many days ahead (default 0 = only due/overdue).",
      },
    },
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input: any, ctx: ToolContext) => {
    const c = await loadCurrentClient(ctx);
    if (!c) return noClientResult();

    const { timelineItems } = await import("@/db/schema");
    const { ne, or, isNull: dIsNull } = await import("drizzle-orm");

    const ahead = Math.max(0, Math.min(90, Number(input?.include_upcoming_days) || 0));
    const cutoff = new Date(Date.now() + ahead * 86400000).toISOString().slice(0, 10);
    const today = todayYMD();

    const rows = await db.select({
      id: timelineItems.id,
      taskCode: timelineItems.taskCode,
      subject: timelineItems.subject,
      plannedStart: timelineItems.plannedStart,
      plannedEnd: timelineItems.plannedEnd,
      owner: timelineItems.owner,
      status: timelineItems.status,
      actualEnd: timelineItems.actualEnd,
    })
      .from(timelineItems)
      .where(and(
        eq(timelineItems.clientProfileId, c.id),
        ne(timelineItems.status, "completed"),
        or(dIsNull(timelineItems.actualEnd), eq(timelineItems.actualEnd, "")),
      ))
      .orderBy(timelineItems.plannedEnd);

    const due = rows
      .filter(r => (r.plannedEnd || "") <= cutoff)
      .map(r => {
        const end = r.plannedEnd || "";
        const overdueDays = end && end < today
          ? Math.round((Date.parse(today) - Date.parse(end)) / 86400000)
          : 0;
        return { ...r, overdue_days: overdueDays };
      });

    if (due.length === 0) {
      return { ok: true as const, tasks: [], summary: `Nothing is due or overdue on ${c.clientShortName || c.companyName}'s timeline right now.` };
    }

    const worst = due[0];
    return {
      ok: true as const,
      tasks: due,
      summary: `${due.length} task${due.length === 1 ? "" : "s"} due or overdue on ${c.clientShortName || c.companyName}. Oldest: ${worst.taskCode} — ${worst.subject}${worst.overdue_days ? ` (${worst.overdue_days} day${worst.overdue_days === 1 ? "" : "s"} overdue)` : ""}.`,
    };
  },
});

registerTool({
  name: "mark_timeline_task_done",
  category: "write",
  description:
    "Marks one implementation timeline task as completed for the current client account. Use when the RM or PM confirms a specific task is finished. Identify the task by its task code (preferred) or an exact subject. Resolve relative dates to YYYY-MM-DD yourself; if the completion date is not stated, ask rather than assuming today.",
  inputSchema: {
    type: "object",
    properties: {
      task_code: { type: "string", description: "The task's code, e.g. 'T-12'. Preferred identifier." },
      subject: { type: "string", description: "Alternative to task_code — the task's exact subject line." },
      completed_date: { type: "string", description: "Date the task was actually finished, YYYY-MM-DD. Never a future date." },
    },
    required: ["completed_date"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input: any, ctx: ToolContext) => {
    const c = await loadCurrentClient(ctx);
    if (!c) return noClientResult();

    const done = checkPastDate(input?.completed_date, "completed_date");
    if ("error" in done) return { ok: false as const, error: done.error };

    const code = String(input?.task_code ?? "").trim();
    const subject = String(input?.subject ?? "").trim();
    if (!code && !subject) {
      return { ok: false as const, error: "Tell me which task — give its task code, or its exact subject." };
    }

    const { timelineItems } = await import("@/db/schema");
    const rows = await db.select()
      .from(timelineItems)
      .where(and(
        eq(timelineItems.clientProfileId, c.id),
        code ? eq(timelineItems.taskCode, code) : eq(timelineItems.subject, subject),
      ))
      .limit(2);

    if (rows.length === 0) {
      return { ok: false as const, error: `No timeline task on this account matches ${code ? `code "${code}"` : `subject "${subject}"`}. Use list_due_timeline_tasks to see what exists.` };
    }
    if (rows.length > 1) {
      return { ok: false as const, error: `More than one task matches that. Use the task code to be specific.` };
    }

    const t = rows[0];
    if (t.status === "completed" && t.actualEnd) {
      return { ok: true as const, already: true, summary: `${t.taskCode} — ${t.subject} was already marked complete on ${t.actualEnd}. Nothing changed.` };
    }

    await db.update(timelineItems)
      .set({
        status: "completed",
        actualEnd: done.date,
        // only set a start if none was recorded, so real effort data is kept
        actualStart: t.actualStart || done.date,
        updatedAt: new Date().toISOString(),
      } as any)
      .where(eq(timelineItems.id, t.id));

    const late = t.plannedEnd && done.date > t.plannedEnd
      ? Math.round((Date.parse(done.date) - Date.parse(t.plannedEnd)) / 86400000)
      : 0;

    return {
      ok: true as const,
      task_code: t.taskCode,
      completed_date: done.date,
      days_late: late,
      summary: `Marked done — ${t.taskCode} "${t.subject}" completed ${done.date}${late ? `, ${late} day${late === 1 ? "" : "s"} after the planned ${t.plannedEnd}` : " (on or before plan)"}.`,
    };
  },
});

registerTool({
  name: "file_courtesy_call_evidence",
  category: "write",
  description:
    "Files a screenshot the user has just SENT IN THIS CHAT as evidence against a courtesy call — the RM's invitation (email/chat) or the minutes-of-meeting. Use only when the most recent message actually carried an image; if the user asks to file evidence but sent no image, ask them to send it rather than calling this. State which kind it is: 'invitation' or 'mom'. The image is filed into the account's Drive folder (created automatically on first use) and only the resulting link is stored — never the image itself.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["invitation", "mom", "other"],
        description: "What the screenshot shows. 'invitation' = the RM's meeting invite; 'mom' = the minutes that were sent.",
      },
      call_date: {
        type: "string",
        description: "Optional. The YYYY-MM-DD courtesy call this belongs to. Defaults to the most recent logged call for the account.",
      },
    },
    required: ["kind"],
  },
  defaultEnabled: true,
  defaultAutonomy: "auto",
  handler: async (input: any, ctx: ToolContext) => {
    const c = await loadCurrentClient(ctx);
    if (!c) return noClientResult();

    const kind = ["invitation", "mom", "other"].includes(input?.kind) ? input.kind : "invitation";
    const { courtesyCallHistory, courtesyCallEvidence, arimaMessages } = await import("@/db/schema");
    const { isNotNull } = await import("drizzle-orm");

    // Pick the call: the stated date, else the latest logged one.
    const wanted = String(input?.call_date ?? "").trim();
    const calls = await db.select()
      .from(courtesyCallHistory)
      .where(eq(courtesyCallHistory.clientProfileId, c.id))
      .orderBy(desc(courtesyCallHistory.callDate))
      .limit(25);
    const call = wanted ? calls.find(x => x.callDate === wanted) : calls[0];
    if (!call) {
      return {
        ok: false as const,
        error: wanted
          ? `No courtesy call logged on ${wanted} for this account. Log the call first, then send the screenshot.`
          : "No courtesy call is logged for this account yet. Log the call first, then send the screenshot.",
      };
    }

    // The webhook already downloaded the Telegram photo and persisted it on the
    // message as base64, so we read it from there rather than calling Telegram
    // again. Newest message first — the image the user just sent.
    const msgs = await db.select({ attachments: arimaMessages.attachments, createdAt: arimaMessages.createdAt })
      .from(arimaMessages)
      .where(and(
        eq(arimaMessages.conversationId, ctx.conversationId),
        isNotNull(arimaMessages.attachments),
      ))
      .orderBy(desc(arimaMessages.createdAt))
      .limit(5);

    let img: { base64: string; mime: string } | null = null;
    for (const m of msgs) {
      try {
        const arr = JSON.parse(m.attachments || "[]");
        const hit = (Array.isArray(arr) ? arr : []).find(
          (a: any) => a?.type === "image" && typeof a?.base64 === "string" && a.base64.length > 0);
        if (hit) { img = { base64: hit.base64, mime: hit.mime || "image/png" }; break; }
      } catch { /* skip malformed */ }
    }
    if (!img) {
      return {
        ok: false as const,
        error: "I can't see an image in the recent messages. Send the screenshot in this chat, then ask me to file it.",
      };
    }

    try {
      const { ensureAccountEvidenceFolder, uploadEvidence, evidenceFileName } =
        await import("@/lib/courtesy/drive");
      const accountName = c.clientShortName || c.companyName || "Account";
      const folder = await ensureAccountEvidenceFolder({ accountName, accountId: c.id });
      const filename = evidenceFileName({
        date: call.callDate || new Date().toISOString().slice(0, 10),
        kind, accountName, mimeType: img.mime,
      });
      const up = await uploadEvidence({
        folderId: folder.folderId,
        buffer: Buffer.from(img.base64, "base64"),
        filename,
        mimeType: img.mime,
      });

      await db.insert(courtesyCallEvidence).values({
        id: `cce_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        courtesyCallId: call.id,
        kind,
        driveFileId: up.fileId,
        driveWebViewLink: up.webViewLink,
        fileName: filename,
        uploadedVia: "telegram",
        uploadedByUserId: ctx.channel === "portal" ? null : ctx.userId,
        createdAt: new Date().toISOString(),
      } as any);

      const label = kind === "mom" ? "MOM" : kind === "other" ? "file" : "invitation";
      return {
        ok: true as const,
        link: up.webViewLink,
        file_name: filename,
        summary: `Filed the ${label} for the ${call.callDate} courtesy call as "${filename}"${folder.created ? " (created the account's Drive folder)" : ""}. Link: ${up.webViewLink}`,
      };
    } catch (e: any) {
      return { ok: false as const, error: `Could not file it to Drive: ${e?.message || e}` };
    }
  },
});
