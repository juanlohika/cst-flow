/**
 * Phase E.8 — ClientBindKey helpers.
 *
 * Each account can have N labeled bind keys. A key's accessToken is the secret
 * used in `/bind <token>` and the t.me deep-link payload. Bindings record
 * which key they were created from so contact access can be scoped per-binding.
 */
import { db } from "@/db";
import {
  clientBindKeys,
  arimaChannelBindings,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import crypto from "crypto";

export interface BindKey {
  id: string;
  clientProfileId: string;
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

export async function listKeysForAccount(clientProfileId: string): Promise<BindKeyWithBinding[]> {
  const keys = await db
    .select()
    .from(clientBindKeys)
    .where(eq(clientBindKeys.clientProfileId, clientProfileId))
    .orderBy(desc(clientBindKeys.createdAt));

  const keyIds = keys.map(k => k.id);
  let bindingByKey = new Map<string, { bindingId: string; chatId: string; chatTitle: string | null; boundAt: string }>();
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

  return keys.map(k => ({
    id: k.id,
    clientProfileId: k.clientProfileId,
    label: k.label,
    accessToken: k.accessToken,
    status: (k.status === "revoked" ? "revoked" : "active") as "active" | "revoked",
    createdBy: k.createdBy,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
    activeBinding: bindingByKey.get(k.id) || null,
  }));
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
    label,
    accessToken,
    status: "active",
    createdBy: args.createdBy || null,
    createdAt: now,
  });
  return {
    id,
    clientProfileId: args.clientProfileId,
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
 * Look up a key by its accessToken. Returns the key + the parent account
 * (companyName, code) for use in the bind handlers.
 *
 * NOTE: also matches the legacy clientProfiles.accessToken (the pre-Phase-E.8
 * single-token-per-account secret) so `/bind <legacyToken>` keeps working
 * forever. In that case we resolve to the account's "Primary" key.
 */
export async function lookupKeyByToken(accessToken: string): Promise<{
  key: BindKey;
  account: { id: string; companyName: string; clientCode: string | null };
} | null> {
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
    const k = directRows[0];
    const acct = await db
      .select({ id: clientProfilesTable.id, companyName: clientProfilesTable.companyName, clientCode: clientProfilesTable.clientCode })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, k.clientProfileId))
      .limit(1);
    if (!acct[0]) return null;
    return {
      key: {
        id: k.id,
        clientProfileId: k.clientProfileId,
        label: k.label,
        accessToken: k.accessToken,
        status: (k.status === "revoked" ? "revoked" : "active") as "active" | "revoked",
        createdBy: k.createdBy,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
      },
      account: { id: acct[0].id, companyName: acct[0].companyName, clientCode: acct[0].clientCode },
    };
  }

  // 2) Legacy fallback — match on clientProfiles.accessToken and route through Primary key.
  const legacy = await db
    .select({ id: clientProfilesTable.id, companyName: clientProfilesTable.companyName, clientCode: clientProfilesTable.clientCode })
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

  const k = primaryRows[0];
  return {
    key: {
      id: k.id,
      clientProfileId: k.clientProfileId,
      label: k.label,
      accessToken: k.accessToken,
      status: (k.status === "revoked" ? "revoked" : "active") as "active" | "revoked",
      createdBy: k.createdBy,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
    },
    account: { id: legacy[0].id, companyName: legacy[0].companyName, clientCode: legacy[0].clientCode },
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
