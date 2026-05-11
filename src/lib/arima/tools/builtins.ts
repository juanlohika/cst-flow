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
