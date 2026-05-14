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
  description: "Returns basic profile info about the current client account (company name, industry, modules contracted, engagement status, primary contact). Use this to answer factual questions about the client.",
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
    return {
      ok: true,
      data: {
        companyName: c.companyName,
        industry: c.industry,
        companySize: c.companySize || null,
        modulesAvailed: modules,
        engagementStatus: c.engagementStatus,
        primaryContact: c.primaryContact || null,
        primaryContactEmail: c.primaryContactEmail || null,
        specialConsiderations: c.specialConsiderations || null,
      },
      summary: `${c.companyName} · ${c.industry} · ${modules.length} module(s)`,
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
