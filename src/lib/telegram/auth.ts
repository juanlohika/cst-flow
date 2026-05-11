import { db } from "@/db";
import {
  telegramAccountLinks,
  telegramLinkCodes,
  users as usersTable,
} from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import crypto from "crypto";

/**
 * Generates a one-time, human-readable code that a CST OS admin can use to link
 * their Telegram account. Format: LK-XXXX-YYYY (8 chars from a no-confusing alphabet).
 * Expires in 30 minutes; consumed on first use.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/I/1 to avoid confusion

function randomChunk(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}

export function generateLinkCode(): string {
  return `LK-${randomChunk(4)}-${randomChunk(4)}`;
}

export async function createLinkCode(cstUserId: string): Promise<{ code: string; expiresAt: string }> {
  // Invalidate any unused pending codes for this user first
  await db
    .update(telegramLinkCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(telegramLinkCodes.cstUserId, cstUserId)));

  const code = generateLinkCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // +30 min

  await db.insert(telegramLinkCodes).values({
    id: `tlc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
    code,
    cstUserId,
    expiresAt,
    createdAt: now.toISOString(),
  });

  return { code, expiresAt };
}

/**
 * Consume a link code and create a TelegramAccountLink for the Telegram user.
 * Returns the CST user ID on success, or null on failure (with a reason).
 */
export async function consumeLinkCode(code: string, telegramUser: { id: number; username?: string; first_name?: string; last_name?: string }): Promise<{ ok: true; cstUserId: string } | { ok: false; reason: string }> {
  const trimmed = code.trim().toUpperCase();
  const rows = await db
    .select()
    .from(telegramLinkCodes)
    .where(eq(telegramLinkCodes.code, trimmed))
    .limit(1);
  const codeRow = rows[0];
  if (!codeRow) return { ok: false, reason: "Code not found." };
  if (codeRow.usedAt) return { ok: false, reason: "This code has already been used. Generate a new one in CST OS." };
  if (new Date(codeRow.expiresAt).getTime() < Date.now()) return { ok: false, reason: "This code has expired. Generate a new one in CST OS." };

  // Confirm the CST OS user still exists and is active
  const userRows = await db
    .select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, codeRow.cstUserId))
    .limit(1);
  if (userRows.length === 0) return { ok: false, reason: "Linked CST OS user not found." };

  const telegramId = String(telegramUser.id);
  const fullName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ").trim() || null;

  // Idempotent: if a link already exists for this telegram user, update it; else insert.
  const existing = await db
    .select({ id: telegramAccountLinks.id })
    .from(telegramAccountLinks)
    .where(eq(telegramAccountLinks.telegramUserId, telegramId))
    .limit(1);

  const now = new Date().toISOString();
  if (existing.length > 0) {
    await db
      .update(telegramAccountLinks)
      .set({
        telegramUsername: telegramUser.username || null,
        telegramName: fullName,
        cstUserId: codeRow.cstUserId,
        status: "active",
        linkedAt: now,
      })
      .where(eq(telegramAccountLinks.id, existing[0].id));
  } else {
    await db.insert(telegramAccountLinks).values({
      id: `tgl_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      telegramUserId: telegramId,
      telegramUsername: telegramUser.username || null,
      telegramName: fullName,
      cstUserId: codeRow.cstUserId,
      status: "active",
      linkedAt: now,
    });
  }

  await db
    .update(telegramLinkCodes)
    .set({ usedAt: now })
    .where(eq(telegramLinkCodes.id, codeRow.id));

  return { ok: true, cstUserId: codeRow.cstUserId };
}

/**
 * Look up the CST user (with role/status) for a Telegram user ID.
 * Returns null if not linked.
 */
export async function resolveCstUserFromTelegram(telegramUserId: number | string): Promise<{ cstUserId: string; role: string; status: string; name: string | null; email: string } | null> {
  const tid = String(telegramUserId);
  const rows = await db
    .select({
      cstUserId: telegramAccountLinks.cstUserId,
      status: telegramAccountLinks.status,
      role: usersTable.role,
      userStatus: usersTable.status,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(telegramAccountLinks)
    .leftJoin(usersTable, eq(usersTable.id, telegramAccountLinks.cstUserId))
    .where(eq(telegramAccountLinks.telegramUserId, tid))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  if (r.status !== "active") return null;
  return {
    cstUserId: r.cstUserId,
    role: r.role || "user",
    status: r.userStatus || "active",
    name: r.name || null,
    email: r.email || "",
  };
}
