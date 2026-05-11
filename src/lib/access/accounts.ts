import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  accountMemberships as membershipsTable,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import crypto from "crypto";

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
