/**
 * Pin Validator session helpers — mirrors src/lib/portal/auth.ts but scoped
 * to the Pin Validator portal so:
 *
 *   • Sessions only unlock the Pin Validator UI, never ARIMA chat
 *   • Cookie is independent (`cst_pin_validator_session`)
 *   • Each session is tied to ONE project — opening a different account's
 *     validator URL requires a fresh magic link
 */
import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  clientContacts,
  subscriberMagicLinks,
  subscriberSessions,
  pinValidatorProjects,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

const SESSION_COOKIE_NAME = "cst_pin_validator_session";
const SESSION_TTL_DAYS = 30;
export const PIN_VALIDATOR_PURPOSE = "pin_validator" as const;

export interface PinValidatorSessionData {
  contactId: string;
  contactName: string;
  contactEmail: string;
  clientProfileId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  googleSheetId: string;
}

function generateSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export type ConsumeResult =
  | { ok: true; sessionId: string; session: PinValidatorSessionData }
  | { ok: false; reason: string; code: "already_used" | "expired" | "invalid" | "purpose_mismatch" | "disabled" | "missing_project" };

export async function consumePinValidatorMagicLink(
  token: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<ConsumeResult> {
  const rows = await db
    .select({
      id: subscriberMagicLinks.id,
      contactId: subscriberMagicLinks.contactId,
      expiresAt: subscriberMagicLinks.expiresAt,
      usedAt: subscriberMagicLinks.usedAt,
      purpose: subscriberMagicLinks.purpose,
      projectId: subscriberMagicLinks.pinValidatorProjectId,
    })
    .from(subscriberMagicLinks)
    .where(eq(subscriberMagicLinks.token, token))
    .limit(1);
  const link = rows[0];
  if (!link) {
    return { ok: false, reason: "Invalid or expired link.", code: "invalid" };
  }
  if (link.purpose !== PIN_VALIDATOR_PURPOSE) {
    return { ok: false, reason: "This link can't be used here.", code: "purpose_mismatch" };
  }
  if (!link.projectId) {
    return { ok: false, reason: "Link is missing its target project.", code: "missing_project" };
  }
  if (link.usedAt) {
    return { ok: false, reason: "This link has already been used.", code: "already_used" };
  }
  if (new Date(link.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "This link has expired.", code: "expired" };
  }

  // Verify the contact still has the capability enabled.
  const contactRows = await db
    .select({
      id: clientContacts.id,
      pinValidatorEnabled: clientContacts.pinValidatorEnabled,
    })
    .from(clientContacts)
    .where(eq(clientContacts.id, link.contactId))
    .limit(1);
  if (contactRows.length === 0 || !contactRows[0].pinValidatorEnabled) {
    return { ok: false, reason: "Validator access is disabled for this contact.", code: "disabled" };
  }

  // Mark link used, activate the contact, create the session.
  const now = new Date().toISOString();
  await db
    .update(subscriberMagicLinks)
    .set({ usedAt: now })
    .where(eq(subscriberMagicLinks.id, link.id));
  await db
    .update(clientContacts)
    .set({ status: "active", activatedAt: now, lastSeenAt: now, updatedAt: now })
    .where(eq(clientContacts.id, link.contactId));

  const sessionId = generateSessionId();
  const sessionRowId = `ss_pv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
  await db.insert(subscriberSessions).values({
    id: sessionRowId,
    sessionId,
    contactId: link.contactId,
    purpose: PIN_VALIDATOR_PURPOSE,
    pinValidatorProjectId: link.projectId,
    userAgent: context.userAgent || null,
    ipAddress: context.ipAddress || null,
    expiresAt,
    lastUsedAt: now,
    status: "active",
    createdAt: now,
  });

  const session = await loadSession(sessionId);
  if (!session) {
    return { ok: false, reason: "Session lookup failed.", code: "invalid" };
  }
  return { ok: true, sessionId, session };
}

async function loadSession(sessionId: string): Promise<PinValidatorSessionData | null> {
  const rows = await db
    .select({
      sessionId: subscriberSessions.sessionId,
      status: subscriberSessions.status,
      expiresAt: subscriberSessions.expiresAt,
      purpose: subscriberSessions.purpose,
      projectId: subscriberSessions.pinValidatorProjectId,
      contactId: clientContacts.id,
      contactName: clientContacts.name,
      contactEmail: clientContacts.email,
      pinValidatorEnabled: clientContacts.pinValidatorEnabled,
      clientProfileId: pinValidatorProjects.clientProfileId,
      projectName: pinValidatorProjects.name,
      googleSheetId: pinValidatorProjects.googleSheetId,
      projectStatus: pinValidatorProjects.status,
      clientName: clientProfilesTable.companyName,
    })
    .from(subscriberSessions)
    .innerJoin(clientContacts, eq(clientContacts.id, subscriberSessions.contactId))
    .leftJoin(
      pinValidatorProjects,
      eq(pinValidatorProjects.id, subscriberSessions.pinValidatorProjectId),
    )
    .leftJoin(
      clientProfilesTable,
      eq(clientProfilesTable.id, pinValidatorProjects.clientProfileId),
    )
    .where(eq(subscriberSessions.sessionId, sessionId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  if (r.status !== "active") return null;
  if (r.purpose !== PIN_VALIDATOR_PURPOSE) return null;
  if (new Date(r.expiresAt).getTime() < Date.now()) return null;
  if (!r.pinValidatorEnabled) return null;
  if (!r.projectId || r.projectStatus !== "active") return null;

  return {
    contactId: r.contactId,
    contactName: r.contactName,
    contactEmail: r.contactEmail,
    clientProfileId: r.clientProfileId || "",
    clientName: r.clientName || "Unknown",
    projectId: r.projectId,
    projectName: r.projectName || "Pin Validator",
    googleSheetId: r.googleSheetId || "",
  };
}

/**
 * Validate the cookie, refresh lastUsedAt, return the session or null.
 * The validator UI's API routes call this on every request.
 */
export async function getPinValidatorSession(): Promise<PinValidatorSessionData | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const session = await loadSession(sessionId);
  if (!session) return null;

  // Fire-and-forget lastUsedAt refresh.
  db.update(subscriberSessions)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(subscriberSessions.sessionId, sessionId))
    .catch(() => {});

  return session;
}

export async function setPinValidatorSessionCookie(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export async function clearPinValidatorSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
