/**
 * Phase E.6 — Super Admin context helpers.
 *
 * Hard rule: portfolio-wide CRM data may only be discussed in:
 *   (a) the currently-bound Super Admin Telegram group chat, where the
 *       sender must be on the SuperAdminUser allowlist AND the context
 *       must not be expired/revoked, OR
 *   (b) the private DM of a SuperAdminUser who has explicitly opted in
 *       (allowDmAccess=true).
 *
 * Every call to checkSuperAdminAccess() returns a strict allow/deny verdict
 * plus a reason. Tool handlers refuse on any non-allowed verdict and
 * the result is audit-logged.
 */
import { db } from "@/db";
import {
  superAdminContext,
  superAdminUsers,
  superAdminAccessLog,
  telegramAccountLinks,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type AccessVerdict =
  | { allowed: true; contextId: string; chatId: string; reason: "in-sa-gc" | "allowed-dm" }
  | { allowed: false; status: "refused-not-in-context" | "refused-not-allowlisted" | "refused-expired" | "refused-revoked" | "refused-dm-not-allowed"; reason: string };

export interface SuperAdminAccessInput {
  /** Telegram chat id of the conversation. Null for web/portal channels. */
  telegramChatId: string | null;
  /** Telegram user id of the sender. Null for web/portal channels. */
  telegramUserId: string | null;
  /** CST OS user id (resolved from telegram link if possible). */
  cstUserId: string | null;
  /** "telegram" | "web" | "portal" — affects DM-allowance check. */
  channel: string;
  /** True if this is a private (1:1) Telegram chat with the bot. */
  isPrivateChat: boolean;
}

export async function checkSuperAdminAccess(args: SuperAdminAccessInput): Promise<AccessVerdict> {
  // 1) Lookup the active SA context (single row at a time per org)
  const ctxRows = await db
    .select()
    .from(superAdminContext)
    .where(eq(superAdminContext.status, "active"))
    .orderBy(desc(superAdminContext.createdAt))
    .limit(1);
  const ctx = ctxRows[0];
  if (!ctx) {
    return { allowed: false, status: "refused-not-in-context", reason: "No Super Admin context is currently bound. Ask an admin to bind one at /admin/super-admin-context." };
  }

  // 2) Check expiration (soft-expire by flagging status as 'expired')
  const expired = new Date(ctx.expiresAt).getTime() < Date.now();
  if (expired) {
    // Best-effort: mark as expired so future calls see the correct status
    try {
      await db.update(superAdminContext)
        .set({ status: "expired" })
        .where(eq(superAdminContext.id, ctx.id));
    } catch {}
    return { allowed: false, status: "refused-expired", reason: `Super Admin context expired on ${ctx.expiresAt}. Re-bind to re-enable.` };
  }

  // 3) Resolve allowlist entry
  let allowEntry: { id: string; cstUserId: string; telegramUserId: string | null; allowDmAccess: boolean } | null = null;
  if (args.cstUserId) {
    const rows = await db
      .select()
      .from(superAdminUsers)
      .where(eq(superAdminUsers.cstUserId, args.cstUserId))
      .limit(1);
    allowEntry = (rows[0] as any) || null;
  }
  if (!allowEntry && args.telegramUserId) {
    const rows = await db
      .select()
      .from(superAdminUsers)
      .where(eq(superAdminUsers.telegramUserId, args.telegramUserId))
      .limit(1);
    allowEntry = (rows[0] as any) || null;
  }

  if (!allowEntry) {
    return { allowed: false, status: "refused-not-allowlisted", reason: "You are not on the Super Admin allowlist." };
  }

  // 4) Determine context type — bound GC vs private DM vs other
  const isSaChat = args.channel === "telegram" && args.telegramChatId === ctx.telegramChatId;

  if (isSaChat) {
    return { allowed: true, contextId: ctx.id, chatId: ctx.telegramChatId, reason: "in-sa-gc" };
  }

  // Not in the SA GC. Check DM allowance.
  if (args.channel === "telegram" && args.isPrivateChat && allowEntry.allowDmAccess) {
    return { allowed: true, contextId: ctx.id, chatId: args.telegramChatId || "dm", reason: "allowed-dm" };
  }

  if (args.channel === "telegram" && args.isPrivateChat && !allowEntry.allowDmAccess) {
    return { allowed: false, status: "refused-dm-not-allowed", reason: "Portfolio data is not available in DMs by default. Ask an admin to enable DM access for your account, or move this conversation to the Super Admin group chat." };
  }

  // Web / portal / other group chats
  return { allowed: false, status: "refused-not-in-context", reason: "Portfolio data is only available in the Super Admin group chat." };
}

export async function logSuperAdminAccess(args: {
  contextId?: string | null;
  telegramChatId?: string | null;
  telegramUserId?: string | null;
  cstUserId?: string | null;
  toolName: string;
  question?: string | null;
  status: string;
  reason?: string | null;
  responseSummary?: string | null;
  responseBytes?: number | null;
}): Promise<void> {
  try {
    await db.insert(superAdminAccessLog).values({
      id: `salog_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      contextId: args.contextId || null,
      telegramChatId: args.telegramChatId || null,
      telegramUserId: args.telegramUserId || null,
      cstUserId: args.cstUserId || null,
      toolName: args.toolName,
      question: args.question ? args.question.slice(0, 2000) : null,
      status: args.status,
      reason: args.reason ? args.reason.slice(0, 500) : null,
      responseSummary: args.responseSummary ? args.responseSummary.slice(0, 1000) : null,
      responseBytes: args.responseBytes ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[super-admin/context] failed to write audit log:", e);
  }
}

/**
 * Resolve a CST OS user id from a Telegram user id via telegramAccountLinks.
 * Returns null when no active link exists.
 */
export async function resolveCstUserFromTelegram(telegramUserId: string): Promise<string | null> {
  try {
    const rows = await db
      .select({ cstUserId: telegramAccountLinks.cstUserId })
      .from(telegramAccountLinks)
      .where(and(
        eq(telegramAccountLinks.telegramUserId, telegramUserId),
        eq(telegramAccountLinks.status, "active"),
      ))
      .limit(1);
    return rows[0]?.cstUserId || null;
  } catch {
    return null;
  }
}

/**
 * Quick read of the current active context — used by webhook routing to
 * decide whether a given message lands in the SA path.
 */
export async function loadActiveSuperAdminContext(): Promise<{
  id: string;
  telegramChatId: string;
  expiresAt: string;
  status: string;
} | null> {
  const rows = await db
    .select({
      id: superAdminContext.id,
      telegramChatId: superAdminContext.telegramChatId,
      expiresAt: superAdminContext.expiresAt,
      status: superAdminContext.status,
    })
    .from(superAdminContext)
    .where(eq(superAdminContext.status, "active"))
    .orderBy(desc(superAdminContext.createdAt))
    .limit(1);
  return rows[0] || null;
}

/**
 * Used by /extend command and admin extend endpoint. Pushes the
 * expiration N hours into the future from "now". Returns the new
 * expiresAt or null if no active context.
 */
export async function extendSuperAdminContext(args: {
  hours: number;
  byUserId: string;
}): Promise<string | null> {
  const ctx = await loadActiveSuperAdminContext();
  if (!ctx) return null;
  const newExpiry = new Date(Date.now() + args.hours * 60 * 60 * 1000).toISOString();
  await db.update(superAdminContext)
    .set({ expiresAt: newExpiry })
    .where(eq(superAdminContext.id, ctx.id));
  return newExpiry;
}
