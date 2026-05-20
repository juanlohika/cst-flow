/**
 * Phase E.8 / E.9 — ClientBindKey helpers.
 *
 * A bind key is a labeled, scoped secret. Three scope shapes exist today:
 *
 *   scopeType="client"     scopeRef=clientProfileId   — bound to ONE account
 *   scopeType="rm-team"    scopeRef=userId            — bound to ALL accounts the RM is primary on
 *   (future: tier / group / portfolio)
 *
 * accessToken is the 64-char hex secret used in /bind <token> and the t.me
 * deep-link payload. Bindings record which key authorized them (bindKeyId)
 * and inherit the scope.
 */
import { db } from "@/db";
import {
  clientBindKeys,
  arimaChannelBindings,
  clientProfiles as clientProfilesTable,
  users as usersTable,
} from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import crypto from "crypto";

export type BindScopeType = "client" | "rm-team";

export interface BindKey {
  id: string;
  clientProfileId: string | null;   // null for team-room keys
  scopeType: BindScopeType;
  scopeRef: string | null;          // clientProfileId for client, userId for rm-team
  label: string;
  accessToken: string;
  status: "active" | "revoked";
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface BindKeyWithBinding extends BindKey {
  activeBinding: null | {
    bindingId: string;
    chatId: string;
    chatTitle: string | null;
    boundAt: string;
  };
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function rowToBindKey(k: any): BindKey {
  return {
    id: k.id,
    clientProfileId: k.clientProfileId ?? null,
    scopeType: (k.scopeType === "rm-team" ? "rm-team" : "client"),
    scopeRef: k.scopeRef ?? null,
    label: k.label,
    accessToken: k.accessToken,
    status: (k.status === "revoked" ? "revoked" : "active"),
    createdBy: k.createdBy ?? null,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt ?? null,
  };
}

async function attachActiveBinding(keys: BindKey[]): Promise<BindKeyWithBinding[]> {
  const keyIds = keys.map(k => k.id);
  const bindingByKey = new Map<string, { bindingId: string; chatId: string; chatTitle: string | null; boundAt: string }>();
  if (keyIds.length > 0) {
    const bindings = await db
      .select({
        id: arimaChannelBindings.id,
        bindKeyId: arimaChannelBindings.bindKeyId,
        chatId: arimaChannelBindings.chatId,
        chatTitle: arimaChannelBindings.chatTitle,
        boundAt: arimaChannelBindings.boundAt,
      })
      .from(arimaChannelBindings)
      .where(and(
        eq(arimaChannelBindings.channel, "telegram"),
        eq(arimaChannelBindings.status, "active"),
      ));
    for (const b of bindings) {
      if (b.bindKeyId && keyIds.includes(b.bindKeyId)) {
        bindingByKey.set(b.bindKeyId, {
          bindingId: b.id,
          chatId: b.chatId,
          chatTitle: b.chatTitle,
          boundAt: b.boundAt,
        });
      }
    }
  }
  return keys.map(k => ({ ...k, activeBinding: bindingByKey.get(k.id) || null }));
}

export async function listKeysForAccount(clientProfileId: string): Promise<BindKeyWithBinding[]> {
  const rows = await db
    .select()
    .from(clientBindKeys)
    .where(eq(clientBindKeys.clientProfileId, clientProfileId))
    .orderBy(desc(clientBindKeys.createdAt));
  return attachActiveBinding(rows.map(rowToBindKey));
}

/**
 * List all rm-team keys (across all RMs). Used by the admin Team Rooms tab.
 */
export async function listTeamRoomKeys(): Promise<Array<BindKeyWithBinding & { rmName: string | null; rmEmail: string | null; accountCount: number }>> {
  const rows = await db
    .select()
    .from(clientBindKeys)
    .where(eq(clientBindKeys.scopeType, "rm-team"))
    .orderBy(desc(clientBindKeys.createdAt));
  const keys = rows.map(rowToBindKey);
  const withBindings = await attachActiveBinding(keys);

  // Enrich with the RM's name + email + their primary account count.
  const userIds = Array.from(new Set(keys.map(k => k.scopeRef).filter(Boolean) as string[]));
  if (userIds.length === 0) return withBindings.map(k => ({ ...k, rmName: null, rmEmail: null, accountCount: 0 }));

  const userRows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(inArrayShim(usersTable.id, userIds));
  const userMap = new Map(userRows.map(u => [u.id, u]));

  // accountCount per user — via primary memberships. Simple per-key lookup
  // beats a single mega-join here because there are typically few team rooms.
  const { accountMemberships } = await import("@/db/schema");
  const counts = new Map<string, number>();
  for (const uid of userIds) {
    const rows = await db
      .select({ id: accountMemberships.id })
      .from(accountMemberships)
      .where(and(
        eq(accountMemberships.userId, uid),
        eq(accountMemberships.isPrimary, true),
      ));
    counts.set(uid, rows.length);
  }

  return withBindings.map(k => {
    const u = k.scopeRef ? userMap.get(k.scopeRef) : null;
    return {
      ...k,
      rmName: u?.name ?? null,
      rmEmail: u?.email ?? null,
      accountCount: k.scopeRef ? (counts.get(k.scopeRef) || 0) : 0,
    };
  });
}

// drizzle's inArray requires a non-empty list; guard here so callers don't need to.
import { inArray as dzInArray } from "drizzle-orm";
function inArrayShim(col: any, vals: string[]) {
  if (vals.length === 0) return eq(col, "__never_match__");
  return dzInArray(col, vals);
}

export async function createBindKey(args: {
  clientProfileId: string;
  label: string;
  createdBy?: string;
}): Promise<BindKey> {
  const label = (args.label || "").trim();
  if (!label) throw new Error("Label is required");
  const id = `bk_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const accessToken = generateToken();
  const now = new Date().toISOString();
  await db.insert(clientBindKeys).values({
    id,
    clientProfileId: args.clientProfileId,
    scopeType: "client",
    scopeRef: args.clientProfileId,
    label,
    accessToken,
    status: "active",
    createdBy: args.createdBy || null,
    createdAt: now,
  });
  return {
    id,
    clientProfileId: args.clientProfileId,
    scopeType: "client",
    scopeRef: args.clientProfileId,
    label,
    accessToken,
    status: "active",
    createdBy: args.createdBy || null,
    createdAt: now,
    revokedAt: null,
  };
}

/**
 * Phase E.9 — Create a team-room bind key for an RM. ARIMA in the resulting
 * Telegram GC will be scoped to the RM's primary-membership accounts at
 * runtime (live scope — reassignments flow through automatically).
 */
export async function createTeamRoomBindKey(args: {
  rmUserId: string;
  label?: string;
  createdBy?: string;
}): Promise<BindKey> {
  // Validate the user exists and resolve their name for the default label.
  const u = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, args.rmUserId))
    .limit(1);
  if (!u[0]) throw new Error(`User ${args.rmUserId} not found`);

  const firstName = (u[0].name || u[0].email || "Team").split(/\s+/)[0];
  const label = (args.label || "").trim() || `${firstName}'s Team Room`;

  const id = `bk_team_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const accessToken = generateToken();
  const now = new Date().toISOString();
  await db.insert(clientBindKeys).values({
    id,
    clientProfileId: null,
    scopeType: "rm-team",
    scopeRef: args.rmUserId,
    label,
    accessToken,
    status: "active",
    createdBy: args.createdBy || null,
    createdAt: now,
  });
  return {
    id,
    clientProfileId: null,
    scopeType: "rm-team",
    scopeRef: args.rmUserId,
    label,
    accessToken,
    status: "active",
    createdBy: args.createdBy || null,
    createdAt: now,
    revokedAt: null,
  };
}

export async function revokeBindKey(keyId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.update(clientBindKeys)
    .set({ status: "revoked", revokedAt: now })
    .where(eq(clientBindKeys.id, keyId));
  // Also revoke any active binding still using this key.
  await db.update(arimaChannelBindings)
    .set({ status: "revoked", revokedAt: now })
    .where(and(
      eq(arimaChannelBindings.bindKeyId, keyId),
      eq(arimaChannelBindings.status, "active"),
    ));
}

export async function regenerateBindKey(keyId: string): Promise<string> {
  const accessToken = generateToken();
  await db.update(clientBindKeys)
    .set({ accessToken })
    .where(eq(clientBindKeys.id, keyId));
  return accessToken;
}

/**
 * Look up a key by its accessToken. Returns the key + a display object for
 * the bind handler ("Account: MX" for client keys, "RM: Jillian (10 accounts)"
 * for team-room keys). Also matches the legacy clientProfiles.accessToken
 * (the pre-Phase-E.8 single-token-per-account secret) so /bind <legacyToken>
 * keeps working forever.
 */
export interface ResolvedBindKey {
  key: BindKey;
  display: {
    primaryLine: string;   // e.g. "MX (MX-001)" or "Jillian's Team Room — 10 accounts"
    secondaryLine: string; // e.g. "Tier 2 · RM: Jillian" or "RM: Jillian Mercado"
  };
  /** Client keys: the account id. Team-room keys: null. */
  clientProfileId: string | null;
}

export async function lookupKeyByToken(accessToken: string): Promise<ResolvedBindKey | null> {
  const token = (accessToken || "").trim();
  if (!token || token.length < 16) return null;

  // 1) Direct match on a ClientBindKey row.
  const directRows = await db
    .select()
    .from(clientBindKeys)
    .where(and(
      eq(clientBindKeys.accessToken, token),
      eq(clientBindKeys.status, "active"),
    ))
    .limit(1);
  if (directRows[0]) {
    return resolveKeyDisplay(rowToBindKey(directRows[0]));
  }

  // 2) Legacy fallback — match on clientProfiles.accessToken and route through Primary key.
  const legacy = await db
    .select({ id: clientProfilesTable.id })
    .from(clientProfilesTable)
    .where(eq(clientProfilesTable.accessToken, token))
    .limit(1);
  if (!legacy[0]) return null;

  const primaryRows = await db
    .select()
    .from(clientBindKeys)
    .where(and(
      eq(clientBindKeys.clientProfileId, legacy[0].id),
      eq(clientBindKeys.status, "active"),
    ))
    .orderBy(clientBindKeys.createdAt)
    .limit(1);
  if (!primaryRows[0]) return null;
  return resolveKeyDisplay(rowToBindKey(primaryRows[0]));
}

async function resolveKeyDisplay(key: BindKey): Promise<ResolvedBindKey> {
  if (key.scopeType === "client") {
    const acct = key.scopeRef
      ? await db
          .select({ id: clientProfilesTable.id, companyName: clientProfilesTable.companyName, clientCode: clientProfilesTable.clientCode, tier: clientProfilesTable.tier })
          .from(clientProfilesTable)
          .where(eq(clientProfilesTable.id, key.scopeRef))
          .limit(1)
      : [];
    if (!acct[0]) {
      return {
        key,
        display: { primaryLine: "Unknown account", secondaryLine: "" },
        clientProfileId: key.scopeRef,
      };
    }
    return {
      key,
      display: {
        primaryLine: `${acct[0].companyName}${acct[0].clientCode ? ` (${acct[0].clientCode})` : ""}`,
        secondaryLine: acct[0].tier ? `Tier ${acct[0].tier}` : "",
      },
      clientProfileId: acct[0].id,
    };
  }

  // rm-team
  const rmId = key.scopeRef!;
  const u = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, rmId))
    .limit(1);
  const { accountMemberships } = await import("@/db/schema");
  const memberships = await db
    .select({ id: accountMemberships.id })
    .from(accountMemberships)
    .where(and(
      eq(accountMemberships.userId, rmId),
      eq(accountMemberships.isPrimary, true),
    ));
  const rmName = u[0]?.name || u[0]?.email || "Unknown RM";
  return {
    key,
    display: {
      primaryLine: `${key.label} — ${memberships.length} account${memberships.length === 1 ? "" : "s"}`,
      secondaryLine: `RM: ${rmName}`,
    },
    clientProfileId: null,
  };
}

/**
 * Find any currently-active binding for the given key (so we can refuse
 * re-binding the same key to a second chat).
 */
export async function findActiveBindingForKey(keyId: string): Promise<{ chatId: string; chatTitle: string | null } | null> {
  const rows = await db
    .select({ chatId: arimaChannelBindings.chatId, chatTitle: arimaChannelBindings.chatTitle })
    .from(arimaChannelBindings)
    .where(and(
      eq(arimaChannelBindings.bindKeyId, keyId),
      eq(arimaChannelBindings.status, "active"),
    ))
    .limit(1);
  return rows[0] || null;
}

/**
 * Resolve the current account list for a team-room scope. Live — re-evaluated
 * every time. Returns the userId's primary-membership clientProfileIds.
 */
export async function listAccountsForRmTeam(rmUserId: string): Promise<string[]> {
  const { accountMemberships } = await import("@/db/schema");
  const rows = await db
    .select({ clientProfileId: accountMemberships.clientProfileId })
    .from(accountMemberships)
    .where(and(
      eq(accountMemberships.userId, rmUserId),
      eq(accountMemberships.isPrimary, true),
    ));
  return rows.map(r => r.clientProfileId);
}
