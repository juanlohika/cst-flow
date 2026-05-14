/**
 * Coordinator helpers (Phase 21).
 *
 * Resolves a freeform target name ("Lester", "@maria", "Jillian Ang") to a
 * concrete recipient: a Telegram user (preferred — direct DM possible) OR a
 * client contact (portal contact — DM via Telegram not applicable, fallback
 * is email/portal notification).
 *
 * Also generates / validates consent tokens for the permission-grant deep-link.
 */
import crypto from "crypto";
import { db } from "@/db";
import {
  telegramAccountLinks,
  users as usersTable,
  accountMemberships,
  clientContacts,
  botDmConsent,
  coordinatorRelays,
} from "@/db/schema";
import { and, eq, inArray, or, like } from "drizzle-orm";

export interface ResolvedTarget {
  kind: "internal-telegram" | "internal-no-telegram" | "external-portal";
  cstUserId?: string;
  clientContactId?: string;
  telegramUserId?: string;
  telegramUsername?: string | null;
  displayName: string;
  hasDmConsent: boolean;
}

const DM_CONSENT_TTL_DAYS = 7;

/**
 * Try to resolve a name string to a target the agent can message. Returns
 * null if no match.
 *
 * Resolution priority within an account scope:
 *   1. Internal team member of THIS account, matched by name/email
 *   2. ClientContact of THIS account, matched by name/email
 *   3. Internal team member of ANY account (broader CST search)
 */
export async function resolveCoordinationTarget(args: {
  rawName: string;
  clientProfileId: string | null;
}): Promise<ResolvedTarget | null> {
  const query = (args.rawName || "").trim().replace(/^@/, "").toLowerCase();
  if (!query || query.length < 2) return null;

  // Step 1: Internal team members of THIS account
  if (args.clientProfileId) {
    const teamRows = await db
      .select({
        userId: accountMemberships.userId,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(accountMemberships)
      .leftJoin(usersTable, eq(usersTable.id, accountMemberships.userId))
      .where(eq(accountMemberships.clientProfileId, args.clientProfileId));

    const matched = pickBestMatch(teamRows, query, t => [t.name, t.email]);
    if (matched) {
      return await hydrateInternalTarget(matched.userId, matched.name || matched.email || query);
    }

    // Step 2: ClientContacts of THIS account
    const contacts = await db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clientProfileId, args.clientProfileId));
    const matchedContact = pickBestMatch(contacts, query, c => [c.name, c.email]);
    if (matchedContact) {
      return {
        kind: "external-portal",
        clientContactId: matchedContact.id,
        displayName: matchedContact.name,
        hasDmConsent: false, // External contacts aren't on Telegram
      };
    }
  }

  // Step 3: Broader internal search (any CST OS user)
  const broaderRows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable);
  const matched = pickBestMatch(broaderRows, query, u => [u.name, u.email]);
  if (matched) {
    return await hydrateInternalTarget(matched.id, matched.name || matched.email || query);
  }

  return null;
}

async function hydrateInternalTarget(cstUserId: string, displayName: string): Promise<ResolvedTarget> {
  const linkRows = await db
    .select({
      telegramUserId: telegramAccountLinks.telegramUserId,
      telegramUsername: telegramAccountLinks.telegramUsername,
    })
    .from(telegramAccountLinks)
    .where(and(
      eq(telegramAccountLinks.cstUserId, cstUserId),
      eq(telegramAccountLinks.status, "active"),
    ))
    .limit(1);
  const link = linkRows[0];
  if (!link) {
    return {
      kind: "internal-no-telegram",
      cstUserId,
      displayName,
      hasDmConsent: false,
    };
  }
  // Linked Telegram → check if they've given DM consent OR have ever DM'd
  // the bot before (handled by webhook auto-recording consent on first DM)
  const consent = await db
    .select({ id: botDmConsent.id })
    .from(botDmConsent)
    .where(and(
      eq(botDmConsent.telegramUserId, link.telegramUserId),
      eq(botDmConsent.status, "active"),
    ))
    .limit(1);
  return {
    kind: "internal-telegram",
    cstUserId,
    telegramUserId: link.telegramUserId,
    telegramUsername: link.telegramUsername,
    displayName,
    hasDmConsent: consent.length > 0,
  };
}

function pickBestMatch<T>(rows: T[], query: string, extract: (r: T) => Array<string | null | undefined>): T | null {
  // Score each row: 3 = exact match on first word; 2 = startsWith; 1 = contains
  let best: { row: T; score: number } | null = null;
  for (const row of rows) {
    const candidates = extract(row)
      .filter((s): s is string => !!s)
      .map(s => s.toLowerCase());
    let score = 0;
    for (const c of candidates) {
      const firstWord = c.split(/\s+/)[0];
      const emailLocal = c.split("@")[0];
      if (firstWord === query || emailLocal === query) { score = Math.max(score, 3); continue; }
      if (c.startsWith(query) || firstWord.startsWith(query)) { score = Math.max(score, 2); continue; }
      if (c.includes(query)) { score = Math.max(score, 1); continue; }
    }
    if (score === 0) continue;
    if (!best || score > best.score) best = { row, score };
  }
  return best?.row || null;
}

/**
 * Build a consent token used in the permission-grant deep-link.
 * Random + DB-stored. We don't need to encode anything in the token itself
 * because we look up the relay row by token.
 */
export function generateConsentToken(): string {
  return "c_" + crypto.randomBytes(18).toString("base64url");
}

export function consentExpiresAt(): string {
  return new Date(Date.now() + DM_CONSENT_TTL_DAYS * 86_400_000).toISOString();
}

/**
 * Build a Telegram deep-link button payload that opens the bot in DM and
 * auto-sends /start <token>.
 */
export function consentDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`;
}

/**
 * Record that a Telegram user has consented to DMs (idempotent — uniques on
 * telegramUserId).
 */
export async function recordDmConsent(args: {
  telegramUserId: string;
  telegramUsername?: string | null;
  telegramName?: string | null;
  grantedVia: "button" | "link_command" | "bind_command" | "auto_first_dm";
}): Promise<void> {
  const existing = await db
    .select({ id: botDmConsent.id })
    .from(botDmConsent)
    .where(eq(botDmConsent.telegramUserId, args.telegramUserId))
    .limit(1);
  if (existing[0]) {
    // Refresh status + cached display fields, leave grantedAt as the original
    await db.update(botDmConsent)
      .set({
        telegramUsername: args.telegramUsername || null,
        telegramName: args.telegramName || null,
        status: "active",
      })
      .where(eq(botDmConsent.id, existing[0].id));
    return;
  }
  await db.insert(botDmConsent).values({
    id: `dmc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    telegramUserId: args.telegramUserId,
    telegramUsername: args.telegramUsername || null,
    telegramName: args.telegramName || null,
    grantedAt: new Date().toISOString(),
    grantedVia: args.grantedVia,
    status: "active",
  });
}

export async function hasDmConsent(telegramUserId: string): Promise<boolean> {
  const rows = await db
    .select({ id: botDmConsent.id })
    .from(botDmConsent)
    .where(and(
      eq(botDmConsent.telegramUserId, telegramUserId),
      eq(botDmConsent.status, "active"),
    ))
    .limit(1);
  return rows.length > 0;
}
