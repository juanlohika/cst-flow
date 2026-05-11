import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  arimaConversations,
  arimaMessages,
  arimaRequests,
  arimaCheckIns,
  arimaToolInvocations,
  arimaChannelBindings,
  clientContacts,
  clientProfiles as clientProfilesTable,
  notificationLogs,
} from "@/db/schema";
import { and, eq, gte, desc, sql } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/arima-analytics
 *
 * Returns an aggregated snapshot of ARIMA activity:
 *  - Conversation + message volume (last 30 / 7 / 1 day)
 *  - Top clients by message count
 *  - Channel breakdown
 *  - Request stats (open, by category, by priority)
 *  - Check-in stats (sent, responded, response rate)
 *  - Tool usage (top tools, failure rate)
 *  - Notification log summary
 *  - Coverage stats (clients with portal contacts, telegram bindings, etc.)
 *
 * All computed in pure SQL — no new tables, no event tracking.
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const url = new URL(req.url);
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days") || "30", 10)));

    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const cutoff7 = new Date(Date.now() - 7 * 86400_000).toISOString();
    const cutoff1 = new Date(Date.now() - 1 * 86400_000).toISOString();

    // ─── Conversations + messages totals ────────────────────────────
    async function countOf(builder: any, sinceField: any, since: string) {
      const result = await db
        .select({ c: sql<number>`count(*)` })
        .from(builder)
        .where(gte(sinceField, since));
      return Number(result[0]?.c || 0);
    }

    const [
      convsTotal,
      convs30,
      convs7,
      convs1,
      msgs30,
      msgs7,
      msgs1,
      requestsTotal,
      requests30,
      checkInsTotal,
      checkIns30,
      toolCalls30,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(arimaConversations).then(r => Number(r[0]?.c || 0)),
      countOf(arimaConversations, arimaConversations.createdAt, cutoff),
      countOf(arimaConversations, arimaConversations.createdAt, cutoff7),
      countOf(arimaConversations, arimaConversations.createdAt, cutoff1),
      countOf(arimaMessages, arimaMessages.createdAt, cutoff),
      countOf(arimaMessages, arimaMessages.createdAt, cutoff7),
      countOf(arimaMessages, arimaMessages.createdAt, cutoff1),
      db.select({ c: sql<number>`count(*)` }).from(arimaRequests).then(r => Number(r[0]?.c || 0)),
      countOf(arimaRequests, arimaRequests.createdAt, cutoff),
      db.select({ c: sql<number>`count(*)` }).from(arimaCheckIns).then(r => Number(r[0]?.c || 0)),
      countOf(arimaCheckIns, arimaCheckIns.createdAt, cutoff),
      countOf(arimaToolInvocations, arimaToolInvocations.createdAt, cutoff),
    ]);

    // ─── Channel breakdown (last N days) ────────────────────────────
    const channelRows = await db
      .select({
        channel: arimaConversations.channel,
        c: sql<number>`count(*)`,
      })
      .from(arimaConversations)
      .where(gte(arimaConversations.createdAt, cutoff))
      .groupBy(arimaConversations.channel);
    const channelBreakdown = channelRows.map(r => ({ channel: r.channel, count: Number(r.c) }));

    // ─── Top 10 clients by message count ─────────────────────────────
    const topClientsRows = await db
      .select({
        clientProfileId: arimaConversations.clientProfileId,
        companyName: clientProfilesTable.companyName,
        clientCode: clientProfilesTable.clientCode,
        messageCount: sql<number>`sum(${arimaConversations.messageCount})`,
      })
      .from(arimaConversations)
      .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaConversations.clientProfileId))
      .where(gte(arimaConversations.lastMessageAt, cutoff))
      .groupBy(arimaConversations.clientProfileId)
      .orderBy(sql`sum(${arimaConversations.messageCount}) desc`)
      .limit(10);
    const topClients = topClientsRows
      .filter(r => r.clientProfileId)
      .map(r => ({
        clientProfileId: r.clientProfileId,
        companyName: r.companyName || "(unknown)",
        clientCode: r.clientCode,
        messageCount: Number(r.messageCount || 0),
      }));

    // ─── Request breakdown ──────────────────────────────────────────
    const requestStatusRows = await db
      .select({ status: arimaRequests.status, c: sql<number>`count(*)` })
      .from(arimaRequests)
      .groupBy(arimaRequests.status);
    const requestByStatus = Object.fromEntries(requestStatusRows.map(r => [r.status, Number(r.c)]));

    const requestCategoryRows = await db
      .select({ category: arimaRequests.category, c: sql<number>`count(*)` })
      .from(arimaRequests)
      .where(gte(arimaRequests.createdAt, cutoff))
      .groupBy(arimaRequests.category)
      .orderBy(sql`count(*) desc`);
    const requestByCategory = requestCategoryRows.map(r => ({ category: r.category, count: Number(r.c) }));

    const requestPriorityRows = await db
      .select({ priority: arimaRequests.priority, c: sql<number>`count(*)` })
      .from(arimaRequests)
      .where(and(
        gte(arimaRequests.createdAt, cutoff),
        eq(arimaRequests.status, "new")
      ))
      .groupBy(arimaRequests.priority);
    const openByPriority = Object.fromEntries(requestPriorityRows.map(r => [r.priority, Number(r.c)]));

    // ─── Check-in response rate (last N days) ───────────────────────
    const respondedRows = await db
      .select({ c: sql<number>`count(*)` })
      .from(arimaCheckIns)
      .where(and(
        gte(arimaCheckIns.createdAt, cutoff),
        eq(arimaCheckIns.status, "responded")
      ));
    const checkInsResponded = Number(respondedRows[0]?.c || 0);
    const responseRate = checkIns30 > 0 ? Math.round((checkInsResponded / checkIns30) * 100) : 0;

    const escalatedRows = await db
      .select({ c: sql<number>`count(*)` })
      .from(arimaCheckIns)
      .where(and(
        gte(arimaCheckIns.createdAt, cutoff),
        eq(arimaCheckIns.status, "escalated")
      ));
    const checkInsEscalated = Number(escalatedRows[0]?.c || 0);

    // ─── Tool usage top 5 + failure rate ────────────────────────────
    const toolUsageRows = await db
      .select({
        toolName: arimaToolInvocations.toolName,
        c: sql<number>`count(*)`,
        fails: sql<number>`sum(case when status = 'failed' then 1 else 0 end)`,
      })
      .from(arimaToolInvocations)
      .where(gte(arimaToolInvocations.createdAt, cutoff))
      .groupBy(arimaToolInvocations.toolName)
      .orderBy(sql`count(*) desc`)
      .limit(8);
    const topTools = toolUsageRows.map(r => ({
      name: r.toolName,
      count: Number(r.c),
      failures: Number(r.fails || 0),
    }));
    const totalToolCalls = topTools.reduce((s, t) => s + t.count, 0);
    const totalToolFailures = topTools.reduce((s, t) => s + t.failures, 0);
    const toolFailureRate = totalToolCalls > 0 ? Math.round((totalToolFailures / totalToolCalls) * 100) : 0;

    // ─── Coverage stats (overall, not time-windowed) ────────────────
    const totalClients = await db
      .select({ c: sql<number>`count(*)` })
      .from(clientProfilesTable)
      .then(r => Number(r[0]?.c || 0));

    const clientsWithBinding = await db
      .select({ c: sql<number>`count(distinct ${arimaChannelBindings.clientProfileId})` })
      .from(arimaChannelBindings)
      .where(eq(arimaChannelBindings.status, "active"))
      .then(r => Number(r[0]?.c || 0));

    const clientsWithContact = await db
      .select({ c: sql<number>`count(distinct ${clientContacts.clientProfileId})` })
      .from(clientContacts)
      .then(r => Number(r[0]?.c || 0));

    // ─── Notification log summary (last N days) ─────────────────────
    const notifRows = await db
      .select({
        channel: notificationLogs.channel,
        status: notificationLogs.status,
        c: sql<number>`count(*)`,
      })
      .from(notificationLogs)
      .where(gte(notificationLogs.createdAt, cutoff))
      .groupBy(notificationLogs.channel, notificationLogs.status);
    const notificationSummary = notifRows.map(r => ({
      channel: r.channel,
      status: r.status,
      count: Number(r.c),
    }));

    // ─── Daily message volume series (last 14 days for sparkline) ───
    const dailySince = new Date(Date.now() - 14 * 86400_000).toISOString();
    const dailyRows = await db
      .select({
        day: sql<string>`substr(${arimaMessages.createdAt}, 1, 10)`,
        c: sql<number>`count(*)`,
      })
      .from(arimaMessages)
      .where(gte(arimaMessages.createdAt, dailySince))
      .groupBy(sql`substr(${arimaMessages.createdAt}, 1, 10)`)
      .orderBy(sql`substr(${arimaMessages.createdAt}, 1, 10)`);
    const dailyMessages = dailyRows.map(r => ({ day: r.day, count: Number(r.c) }));

    return NextResponse.json({
      windowDays: days,
      generatedAt: new Date().toISOString(),
      conversations: {
        total: convsTotal,
        last30: convs30,
        last7: convs7,
        last1: convs1,
      },
      messages: {
        last30: msgs30,
        last7: msgs7,
        last1: msgs1,
      },
      channelBreakdown,
      topClients,
      requests: {
        total: requestsTotal,
        windowed: requests30,
        byStatus: requestByStatus,
        byCategory: requestByCategory,
        openByPriority,
      },
      checkIns: {
        total: checkInsTotal,
        windowed: checkIns30,
        responded: checkInsResponded,
        responseRatePct: responseRate,
        escalated: checkInsEscalated,
      },
      tools: {
        callsInWindow: toolCalls30,
        topTools,
        failureRatePct: toolFailureRate,
      },
      coverage: {
        totalClients,
        clientsWithTelegramBinding: clientsWithBinding,
        clientsWithPortalContact: clientsWithContact,
        clientsWithBindingPct: totalClients > 0 ? Math.round((clientsWithBinding / totalClients) * 100) : 0,
        clientsWithContactPct: totalClients > 0 ? Math.round((clientsWithContact / totalClients) * 100) : 0,
      },
      notifications: {
        summary: notificationSummary,
      },
      dailyMessages,
    });
  } catch (error: any) {
    console.error("[arima-analytics]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
