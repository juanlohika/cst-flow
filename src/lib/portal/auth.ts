import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  clientContacts,
  subscriberMagicLinks,
  subscriberSessions,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Portal authentication helpers — totally separate from CST OS NextAuth.
 *
 * Flow:
 * 1. Admin creates a ClientContact + a SubscriberMagicLink (one-time token)
 * 2. Subscriber clicks the magic link → /api/portal/auth/magic?token=...
 * 3. We mark the link used, create a SubscriberSession, set a signed HTTP-only cookie
 * 4. Future requests carry the cookie; we look up the session, refresh lastUsedAt
 * 5. After 30 days the cookie expires and they need a new magic link
 */

const SESSION_COOKIE_NAME = "arima_portal_session";
const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_DAYS = 7;

export interface PortalSession {
  contactId: string;
  contactName: string;
  contactEmail: string;
  clientProfileId: string;
  clientName: string;
  clientCode: string | null;
}

export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Create a magic link token + DB row. Returns the URL fragment to email out.
 */
export async function createMagicLink(args: {
  contactId: string;
  contactEmail: string;
  createdByUserId?: string;
}): Promise<{ token: string; expiresAt: string }> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_DAYS * 86400_000).toISOString();
  const id = `slk_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

  await db.insert(subscriberMagicLinks).values({
    id,
    contactId: args.contactId,
    token,
    expiresAt,
    sentToEmail: args.contactEmail,
    createdAt: new Date().toISOString(),
    createdByUserId: args.createdByUserId || null,
  });

  return { token, expiresAt };
}

/**
 * Validate a magic-link token and (on success) create a SubscriberSession.
 * Returns the new sessionId to set as a cookie, or an error.
 */
export async function consumeMagicLink(
  token: string,
  context: { userAgent?: string; ipAddress?: string }
): Promise<{ ok: true; sessionId: string; session: PortalSession } | { ok: false; reason: string }> {
  const rows = await db
    .select({
      id: subscriberMagicLinks.id,
      contactId: subscriberMagicLinks.contactId,
      expiresAt: subscriberMagicLinks.expiresAt,
      usedAt: subscriberMagicLinks.usedAt,
    })
    .from(subscriberMagicLinks)
    .where(eq(subscriberMagicLinks.token, token))
    .limit(1);

  const link = rows[0];
  if (!link) return { ok: false, reason: "Invalid or expired link." };
  if (link.usedAt) return { ok: false, reason: "This link has already been used. Ask your account manager for a new one." };
  if (new Date(link.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "This link has expired. Ask your account manager for a new one." };
  }

  // Mark link used
  const now = new Date().toISOString();
  await db.update(subscriberMagicLinks)
    .set({ usedAt: now })
    .where(eq(subscriberMagicLinks.id, link.id));

  // Activate the contact if first use
  await db.update(clientContacts)
    .set({ status: "active", activatedAt: now, lastSeenAt: now, updatedAt: now })
    .where(eq(clientContacts.id, link.contactId));

  // Create a session
  const sessionId = generateToken(32);
  const sessionRowId = `ss_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
  await db.insert(subscriberSessions).values({
    id: sessionRowId,
    sessionId,
    contactId: link.contactId,
    userAgent: context.userAgent || null,
    ipAddress: context.ipAddress || null,
    expiresAt,
    lastUsedAt: now,
    status: "active",
    createdAt: now,
  });

  const session = await loadSessionByContactId(link.contactId);
  if (!session) return { ok: false, reason: "Subscriber data not found." };
  return { ok: true, sessionId, session };
}

async function loadSessionByContactId(contactId: string): Promise<PortalSession | null> {
  const rows = await db
    .select({
      contactId: clientContacts.id,
      contactName: clientContacts.name,
      contactEmail: clientContacts.email,
      clientProfileId: clientContacts.clientProfileId,
      clientName: clientProfilesTable.companyName,
      clientCode: clientProfilesTable.clientCode,
    })
    .from(clientContacts)
    .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, clientContacts.clientProfileId))
    .where(eq(clientContacts.id, contactId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    contactId: r.contactId,
    contactName: r.contactName,
    contactEmail: r.contactEmail,
    clientProfileId: r.clientProfileId,
    clientName: r.clientName || "Unknown",
    clientCode: r.clientCode,
  };
}

/**
 * Validate a session cookie and return the portal session if valid.
 * Returns null if no session, expired, or revoked.
 */
export async function getPortalSession(sessionIdOverride?: string): Promise<PortalSession | null> {
  let sessionId = sessionIdOverride;
  if (!sessionId) {
    const cookieStore = await cookies();
    sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  }
  if (!sessionId) return null;

  const rows = await db
    .select({
      id: subscriberSessions.id,
      contactId: subscriberSessions.contactId,
      expiresAt: subscriberSessions.expiresAt,
      status: subscriberSessions.status,
    })
    .from(subscriberSessions)
    .where(eq(subscriberSessions.sessionId, sessionId))
    .limit(1);

  const s = rows[0];
  if (!s) return null;
  if (s.status !== "active") return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) return null;

  // Refresh lastUsedAt (fire-and-forget)
  db.update(subscriberSessions)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(subscriberSessions.id, s.id))
    .catch(() => {});

  return loadSessionByContactId(s.contactId);
}

/** Set the session cookie (HTTP-only, secure in prod) */
export async function setSessionCookie(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.update(subscriberSessions)
    .set({ status: "revoked" })
    .where(eq(subscriberSessions.sessionId, sessionId));
}

/** Build the public URL for a magic link (used in onboarding emails) */
export function buildMagicLinkUrl(token: string, baseUrl?: string): string {
  const base = baseUrl || process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || "";
  return `${base.replace(/\/$/, "")}/portal/welcome?token=${token}`;
}
