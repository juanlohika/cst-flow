/**
 * Authority model for agent-driven actions (Phase 21).
 *
 * Decides whether a given speaker is allowed to direct ARIMA / Eliana to take
 * write actions like DMing another person. Three tiers:
 *
 *   Owner   — Linked CST OS admin. Can direct any write tool, including
 *             DMing clients.
 *   Member  — Linked CST OS user (non-admin). Can direct DM-to-internal but
 *             NOT DM-to-client. Prevents accidental over-reach.
 *   Guest   — Anyone unlinked (clients in GC, unlinked Telegram users).
 *             Can ask questions and request things on their own behalf, but
 *             cannot direct the agent to message other people.
 *
 * The classifier reads from:
 *   - telegramAccountLinks (telegram → CST user mapping)
 *   - users.role (admin vs user)
 *   - accountMemberships (membership in the bound client's team)
 */
import { db } from "@/db";
import {
  telegramAccountLinks,
  users as usersTable,
  accountMemberships,
  clientContacts,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type AuthorityTier = "owner" | "member" | "guest";

export interface SpeakerAuthority {
  tier: AuthorityTier;
  cstUserId: string | null;
  cstUserName: string | null;
  cstUserRole: string | null;
  reason: string; // human-readable explanation for logs/debugging
}

/**
 * Classify a Telegram speaker by their authority tier within the context of
 * the bound client account.
 */
export async function classifyTelegramSpeaker(args: {
  telegramUserId: string;
  clientProfileId: string | null;
}): Promise<SpeakerAuthority> {
  if (!args.telegramUserId) {
    return { tier: "guest", cstUserId: null, cstUserName: null, cstUserRole: null, reason: "no telegram user id" };
  }

  // 1. Resolve to a CST OS user via link (Phase 6)
  let linkedUserId: string | null = null;
  try {
    const links = await db
      .select({ cstUserId: telegramAccountLinks.cstUserId })
      .from(telegramAccountLinks)
      .where(and(
        eq(telegramAccountLinks.telegramUserId, args.telegramUserId),
        eq(telegramAccountLinks.status, "active"),
      ))
      .limit(1);
    linkedUserId = links[0]?.cstUserId || null;
  } catch {}

  if (!linkedUserId) {
    return { tier: "guest", cstUserId: null, cstUserName: null, cstUserRole: null, reason: "telegram not linked to CST OS" };
  }

  // 2. Pull the CST user's role
  const userRows = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, linkedUserId))
    .limit(1);
  const user = userRows[0];
  if (!user) {
    return { tier: "guest", cstUserId: null, cstUserName: null, cstUserRole: null, reason: "linked CST user not found" };
  }

  // 3. Admin role → always owner-tier
  if (user.role === "admin") {
    return {
      tier: "owner",
      cstUserId: user.id,
      cstUserName: user.name,
      cstUserRole: user.role,
      reason: "linked CST OS admin",
    };
  }

  // 4. Non-admin: check if they're a member of the bound client account
  if (args.clientProfileId) {
    const memberships = await db
      .select({ id: accountMemberships.id })
      .from(accountMemberships)
      .where(and(
        eq(accountMemberships.userId, user.id),
        eq(accountMemberships.clientProfileId, args.clientProfileId),
      ))
      .limit(1);
    if (memberships.length > 0) {
      return {
        tier: "member",
        cstUserId: user.id,
        cstUserName: user.name,
        cstUserRole: user.role,
        reason: "CST OS member of this client account",
      };
    }
  }

  // Linked but not a member of THIS account → still treated as member-tier
  // (they're an internal employee, just not on this account's team)
  return {
    tier: "member",
    cstUserId: user.id,
    cstUserName: user.name,
    cstUserRole: user.role,
    reason: "linked CST OS user (not on this account's team)",
  };
}

/**
 * Classify a target by whether they are internal (CST OS user) or external
 * (a client portal contact). Used by the authority check to reject member-tier
 * speakers trying to DM clients.
 */
export async function classifyTarget(args: {
  cstUserId?: string | null;
  clientContactId?: string | null;
  telegramUserId?: string | null;
}): Promise<{ kind: "internal" | "external" | "unknown"; displayName: string | null }> {
  // Internal by direct CST user id
  if (args.cstUserId) {
    const rows = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, args.cstUserId))
      .limit(1);
    return { kind: "internal", displayName: rows[0]?.name || null };
  }
  // External by ClientContact id
  if (args.clientContactId) {
    const rows = await db
      .select({ name: clientContacts.name })
      .from(clientContacts)
      .where(eq(clientContacts.id, args.clientContactId))
      .limit(1);
    return { kind: "external", displayName: rows[0]?.name || null };
  }
  // Telegram user id → look up via link table
  if (args.telegramUserId) {
    const links = await db
      .select({
        cstUserId: telegramAccountLinks.cstUserId,
        name: telegramAccountLinks.telegramName,
      })
      .from(telegramAccountLinks)
      .where(eq(telegramAccountLinks.telegramUserId, args.telegramUserId))
      .limit(1);
    if (links[0]) {
      const linkedName = links[0].name;
      const userRows = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, links[0].cstUserId))
        .limit(1);
      return { kind: "internal", displayName: userRows[0]?.name || linkedName || null };
    }
  }
  return { kind: "unknown", displayName: null };
}
