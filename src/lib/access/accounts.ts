import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  accountMemberships as membershipsTable,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import crypto from "crypto";

/**
 * Idempotent self-healing: makes sure the AccountMembership table and the
 * new ClientProfile columns (clientCode, accessToken) exist in the live DB.
 * Safe to call on every request — SQLite ignores re-adds of existing columns.
 *
 * This is the safety net so the access-control routes don't 500 when a fresh
 * deploy lands before the admin runs /api/auth/config.
 */
// In-memory flag so we only attempt the schema work once per process (per
// serverless instance). Each invocation does no-op ALTERs if columns exist.
let _schemaEnsuredAt = 0;
export async function ensureAccessSchema(): Promise<void> {
  // Re-attempt at most every 60s in case a previous attempt failed and we want to retry
  if (Date.now() - _schemaEnsuredAt < 60_000) return;
  try {
    // Create AccountMembership table if missing
    await db.run(sql`CREATE TABLE IF NOT EXISTS AccountMembership (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      clientProfileId TEXT NOT NULL,
      role TEXT DEFAULT 'member' NOT NULL,
      grantedBy TEXT,
      grantedAt TEXT DEFAULT (datetime('now')) NOT NULL,
      UNIQUE(userId, clientProfileId)
    )`);

    // Add clientCode + accessToken to ClientProfile if missing.
    // ALTER ... ADD COLUMN throws if the column already exists, so each is wrapped.
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN clientCode TEXT`); } catch {}
    try { await db.run(sql`ALTER TABLE ClientProfile ADD COLUMN accessToken TEXT`); } catch {}

    // Create ArimaRequest table if missing
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaRequest (
      id TEXT PRIMARY KEY,
      conversationId TEXT,
      sourceMessageId TEXT,
      userId TEXT NOT NULL,
      clientProfileId TEXT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'other' NOT NULL,
      priority TEXT DEFAULT 'medium' NOT NULL,
      status TEXT DEFAULT 'new' NOT NULL,
      assignedTo TEXT,
      dueDate TEXT,
      resolution TEXT,
      resolvedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // ARIMA channel bindings + Telegram linking
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaChannelBinding (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      chatId TEXT NOT NULL,
      chatTitle TEXT,
      clientProfileId TEXT NOT NULL,
      boundByUserId TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      boundAt TEXT DEFAULT (datetime('now')) NOT NULL,
      revokedAt TEXT,
      UNIQUE(channel, chatId)
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS TelegramAccountLink (
      id TEXT PRIMARY KEY,
      telegramUserId TEXT NOT NULL UNIQUE,
      telegramUsername TEXT,
      telegramName TEXT,
      cstUserId TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      linkedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS TelegramLinkCode (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      cstUserId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // Notification tables
    await db.run(sql`CREATE TABLE IF NOT EXISTS NotificationSubscription (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      authSecret TEXT NOT NULL,
      userAgent TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      lastUsedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS NotificationPreference (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL UNIQUE,
      webPushEnabled INTEGER DEFAULT 1 NOT NULL,
      emailEnabled INTEGER DEFAULT 1 NOT NULL,
      notifyOnRequest INTEGER DEFAULT 1 NOT NULL,
      notifyOnTelegram INTEGER DEFAULT 0 NOT NULL,
      notifyOnMention INTEGER DEFAULT 1 NOT NULL,
      quietStart TEXT,
      quietEnd TEXT,
      emailCadence TEXT DEFAULT 'instant' NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS NotificationLog (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link TEXT,
      payload TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      errorMessage TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      sentAt TEXT
    )`);

    // Portal (external subscriber) tables
    await db.run(sql`CREATE TABLE IF NOT EXISTS ClientContact (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT,
      phone TEXT,
      status TEXT DEFAULT 'invited' NOT NULL,
      invitedAt TEXT,
      activatedAt TEXT,
      lastSeenAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS SubscriberMagicLink (
      id TEXT PRIMARY KEY,
      contactId TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      sentToEmail TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      createdByUserId TEXT
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS SubscriberSession (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL UNIQUE,
      contactId TEXT NOT NULL,
      userAgent TEXT,
      ipAddress TEXT,
      expiresAt TEXT NOT NULL,
      lastUsedAt TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    // ARIMA tools registry
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaTool (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'read' NOT NULL,
      description TEXT NOT NULL,
      inputSchema TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      autonomy TEXT DEFAULT 'auto' NOT NULL,
      isBuiltIn INTEGER DEFAULT 1 NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaToolInvocation (
      id TEXT PRIMARY KEY,
      toolName TEXT NOT NULL,
      conversationId TEXT,
      userId TEXT,
      clientProfileId TEXT,
      input TEXT,
      output TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      approvalNeeded INTEGER DEFAULT 0 NOT NULL,
      approvedByUserId TEXT,
      approvedAt TEXT,
      errorMessage TEXT,
      durationMs INTEGER,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      executedAt TEXT
    )`);

    // Check-in scheduler tables
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaCheckInSchedule (
      id TEXT PRIMARY KEY,
      clientProfileId TEXT NOT NULL UNIQUE,
      cadence TEXT DEFAULT 'monthly' NOT NULL,
      customIntervalDays INTEGER,
      preferredChannel TEXT DEFAULT 'auto' NOT NULL,
      nextDueAt TEXT NOT NULL,
      lastSentAt TEXT,
      lastResponseAt TEXT,
      consecutiveNoResponse INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaCheckIn (
      id TEXT PRIMARY KEY,
      scheduleId TEXT,
      clientProfileId TEXT NOT NULL,
      contactId TEXT,
      channel TEXT NOT NULL,
      messageContent TEXT,
      conversationId TEXT,
      status TEXT DEFAULT 'scheduled' NOT NULL,
      scheduledAt TEXT DEFAULT (datetime('now')) NOT NULL,
      sentAt TEXT,
      respondedAt TEXT,
      escalatedAt TEXT,
      errorMessage TEXT,
      triggeredByUserId TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaScheduleRule (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cadence TEXT DEFAULT 'monthly' NOT NULL,
      customIntervalDays INTEGER,
      matchEngagementStatus TEXT,
      priority INTEGER DEFAULT 0 NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);

    _schemaEnsuredAt = Date.now();
  } catch (e) {
    console.warn("[access] ensureAccessSchema warning:", e);
  }
}

/**
 * Central access-control helpers for client accounts.
 *
 * Rules:
 *   - Admins (session.user.role === "admin") see every account.
 *   - Non-admin users see only accounts where a row exists in AccountMembership
 *     with their userId.
 *   - Every list query and every single-account lookup MUST go through these
 *     helpers so we don't accidentally leak data across clients.
 */

export interface AccessActor {
  userId: string;
  isAdmin: boolean;
}

/**
 * Resolve which clientProfile IDs the actor is allowed to see.
 * Admins → `null` (meaning "no restriction").
 * Non-admins → array of allowed IDs (may be empty).
 */
export async function listAccessibleClientIds(actor: AccessActor): Promise<string[] | null> {
  // ALWAYS attempt the schema heal first — even for admins, so downstream
  // SELECTs against ClientProfile don't 500 because of a missing column.
  await ensureAccessSchema();
  if (actor.isAdmin) return null;
  try {
    const rows = await db
      .select({ clientProfileId: membershipsTable.clientProfileId })
      .from(membershipsTable)
      .where(eq(membershipsTable.userId, actor.userId));
    return rows.map(r => r.clientProfileId);
  } catch (e) {
    // If the table doesn't exist yet (very fresh deploy), deny everything for non-admins
    console.warn("[access] listAccessibleClientIds failed; denying non-admin:", e);
    return [];
  }
}

/**
 * Returns true if the actor can access the given clientProfileId.
 * Admins always pass. Non-admins must have an AccountMembership row.
 */
export async function canAccessClient(actor: AccessActor, clientProfileId: string): Promise<boolean> {
  await ensureAccessSchema();
  if (actor.isAdmin) return true;
  try {
    const rows = await db
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.userId, actor.userId),
          eq(membershipsTable.clientProfileId, clientProfileId)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch (e) {
    console.warn("[access] canAccessClient failed; denying:", e);
    return false;
  }
}

/**
 * Apply membership filter to a Drizzle SELECT against ClientProfile.
 * Returns the appropriate WHERE clause to AND with other conditions.
 */
export function buildClientAccessWhere(actor: AccessActor, allowedIds: string[] | null) {
  if (allowedIds === null) return undefined; // admin → no filter
  if (allowedIds.length === 0) return sql`1 = 0`; // no access → empty result
  return inArray(clientProfilesTable.id, allowedIds);
}

// ─── Client code + access token generation ──────────────────────────────

function shortHash(seed: string, length = 4): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex").toUpperCase();
  // Strip vowels and similar-looking chars to avoid offensive accidents and confusion
  const cleaned = hash.replace(/[AEIOU01]/g, "");
  return cleaned.slice(0, length);
}

function companyPrefix(companyName: string): string {
  const cleaned = companyName.toUpperCase().replace(/[^A-Z]/g, "");
  if (cleaned.length >= 4) return cleaned.slice(0, 4);
  if (cleaned.length > 0) return cleaned.padEnd(4, "X");
  return "ACCT";
}

/**
 * Human-readable, short, mostly-unique client code.
 * Format: PREFIX-XXXX (e.g. MOPT-A3F2, TARK-9K4P)
 */
export function generateClientCode(companyName: string, idSeed?: string): string {
  const prefix = companyPrefix(companyName);
  const seed = `${prefix}-${idSeed || crypto.randomBytes(8).toString("hex")}-${Date.now()}`;
  return `${prefix}-${shortHash(seed, 4)}`;
}

/**
 * Random 64-char hex secret for channel binding (Telegram chats, magic links, etc.)
 */
export function generateAccessToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Make sure the given client profile has a clientCode AND an accessToken.
 * Generates and persists them if missing. Returns the (possibly updated) values.
 *
 * Safe to call repeatedly — only writes when fields are blank.
 */
export async function ensureClientCodeAndToken(clientProfileId: string): Promise<{ clientCode: string; accessToken: string }> {
  const rows = await db
    .select({
      id: clientProfilesTable.id,
      companyName: clientProfilesTable.companyName,
      clientCode: clientProfilesTable.clientCode,
      accessToken: clientProfilesTable.accessToken,
    })
    .from(clientProfilesTable)
    .where(eq(clientProfilesTable.id, clientProfileId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error("Client profile not found");

  let clientCode = row.clientCode || "";
  let accessToken = row.accessToken || "";
  const updates: Record<string, string> = {};

  if (!clientCode) {
    clientCode = await uniqueClientCode(row.companyName);
    updates.clientCode = clientCode;
  }
  if (!accessToken) {
    accessToken = generateAccessToken();
    updates.accessToken = accessToken;
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(clientProfilesTable)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(clientProfilesTable.id, clientProfileId));
  }

  return { clientCode, accessToken };
}

/**
 * Generate a clientCode that doesn't collide with any existing one.
 * Retries up to 5 times before giving up (uniqueness is enforced by the UNIQUE
 * constraint anyway, but pre-checking avoids noisy errors).
 */
export async function uniqueClientCode(companyName: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateClientCode(companyName, `${attempt}-${Math.random()}`);
    const collision = await db
      .select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.clientCode, candidate))
      .limit(1);
    if (collision.length === 0) return candidate;
  }
  // Final fallback: add a random suffix
  return `${generateClientCode(companyName)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}
