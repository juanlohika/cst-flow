/**
 * Pin Validator invite helpers.
 *
 * Reuses subscriberMagicLinks + subscriberSessions (the same tables ARIMA uses)
 * but stamps `purpose = 'pin_validator'` and `pinValidatorProjectId` so the
 * link routes to the validator UI instead of the ARIMA chat.
 *
 * Auth shape (mirrors ARIMA's flow at src/lib/portal/auth.ts):
 *   1. Internal CST user clicks "Send invite" on the Pin Validator tab
 *   2. We create-or-update a ClientContact (pinValidatorEnabled = true) for
 *      that account+email
 *   3. We create a SubscriberMagicLink (purpose='pin_validator')
 *   4. We email the validator the link
 *   5. Validator clicks → /pin-validator/welcome?token=... → session cookie
 *   6. /ai-tools/pin-validator/[projectId] is gated by that session
 */
import crypto from "crypto";
import { db } from "@/db";
import {
  clientContacts,
  subscriberMagicLinks,
  pinValidatorProjects,
  clientProfiles,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSmtpTransport } from "@/lib/email";

export const MAGIC_LINK_TTL_DAYS = 7;
export const PIN_VALIDATOR_PURPOSE = "pin_validator" as const;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function buildInviteUrl(token: string, baseUrl?: string): string {
  const base =
    baseUrl ||
    process.env.PUBLIC_BASE_URL ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    "";
  return `${base.replace(/\/$/, "")}/pin-validator/welcome?token=${token}`;
}

/**
 * Ensure a ClientContact exists for the given email under this account
 * with pinValidatorEnabled = true. If one already exists, flip the flag on.
 * Returns the contact id.
 */
export async function ensureValidatorContact(opts: {
  clientProfileId: string;
  email: string;
  name?: string;
  role?: string;
  invitedByUserId?: string;
}): Promise<{ contactId: string; isNew: boolean }> {
  const normalized = opts.email.trim().toLowerCase();
  const now = new Date().toISOString();

  const existing = await db
    .select({
      id: clientContacts.id,
      pinValidatorEnabled: clientContacts.pinValidatorEnabled,
      name: clientContacts.name,
    })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clientProfileId, opts.clientProfileId),
        eq(clientContacts.email, normalized),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    if (!existing[0].pinValidatorEnabled) {
      await db
        .update(clientContacts)
        .set({ pinValidatorEnabled: true, updatedAt: now })
        .where(eq(clientContacts.id, existing[0].id));
    }
    return { contactId: existing[0].id, isNew: false };
  }

  // Create a new contact, ARIMA disabled by default for validator-only people.
  const id = crypto.randomUUID();
  await db.insert(clientContacts).values({
    id,
    clientProfileId: opts.clientProfileId,
    name: opts.name?.trim() || normalized.split("@")[0],
    email: normalized,
    role: opts.role || null,
    phone: null,
    status: "invited",
    invitedAt: now,
    activatedAt: null,
    lastSeenAt: null,
    arimaPortalEnabled: false,
    pinValidatorEnabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return { contactId: id, isNew: true };
}

/**
 * Create a magic link + DB row scoped to a specific Pin Validator project,
 * and return the token + URL the caller should send.
 */
export async function createPinValidatorMagicLink(opts: {
  contactId: string;
  contactEmail: string;
  projectId: string;
  createdByUserId?: string;
}): Promise<{ token: string; url: string; expiresAt: string }> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + MAGIC_LINK_TTL_DAYS * 86400_000,
  ).toISOString();
  const id = `slk_${now.getTime().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

  await db.insert(subscriberMagicLinks).values({
    id,
    contactId: opts.contactId,
    token,
    expiresAt,
    sentToEmail: opts.contactEmail.toLowerCase(),
    purpose: PIN_VALIDATOR_PURPOSE,
    pinValidatorProjectId: opts.projectId,
    createdAt: now.toISOString(),
    createdByUserId: opts.createdByUserId || null,
  });

  return { token, url: buildInviteUrl(token), expiresAt };
}

/**
 * Send the invite email. Returns whether SMTP succeeded; if SMTP is not
 * configured, the caller can still surface the link in the UI for manual
 * sharing. We don't throw on SMTP error because the link itself is the
 * source of truth — email is a convenience.
 */
export async function sendPinValidatorInviteEmail(opts: {
  to: string;
  validatorName: string;
  inviterName: string;
  accountName: string;
  inviteUrl: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const t = await getSmtpTransport();
  if (!t) {
    return { sent: false, reason: "SMTP is not configured." };
  }
  const subject = `${opts.inviterName} invited you to validate pins for ${opts.accountName}`;
  const html = renderInviteHtml(opts);
  const text = renderInviteText(opts);
  try {
    await t.transport.sendMail({
      from: t.from,
      to: opts.to,
      subject,
      html,
      text,
    });
    return { sent: true };
  } catch (e: any) {
    console.error("[pin-validator/invite] SMTP send failed:", e);
    return { sent: false, reason: e?.message || "SMTP send failed" };
  }
}

/** Lookup the project + parent account for context — used when crafting the email. */
export async function loadProjectContext(projectId: string): Promise<{
  projectName: string;
  accountName: string;
} | null> {
  const rows = await db
    .select({
      projectName: pinValidatorProjects.name,
      accountName: clientProfiles.companyName,
    })
    .from(pinValidatorProjects)
    .leftJoin(
      clientProfiles,
      eq(clientProfiles.id, pinValidatorProjects.clientProfileId),
    )
    .where(eq(pinValidatorProjects.id, projectId))
    .limit(1);
  if (rows.length === 0) return null;
  return {
    projectName: rows[0].projectName,
    accountName: rows[0].accountName || "your account",
  };
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] as string));
}

function renderInviteText(opts: {
  validatorName: string;
  inviterName: string;
  accountName: string;
  inviteUrl: string;
}): string {
  return [
    `Hi ${opts.validatorName},`,
    "",
    `${opts.inviterName} has invited you to validate pin locations for ${opts.accountName}.`,
    "",
    `Open the validator: ${opts.inviteUrl}`,
    "",
    "This link is single-use and expires in 7 days.",
  ].join("\n");
}

function renderInviteHtml(opts: {
  validatorName: string;
  inviterName: string;
  accountName: string;
  inviteUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<title>Validate pins for ${escape(opts.accountName)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f5;color:#252B37;padding:48px 16px}
.card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:12px;overflow:hidden}
.card-body{padding:32px 28px}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2162F9;margin-bottom:10px}
.heading{font-size:22px;font-weight:700;color:#252B37;margin-bottom:14px;line-height:1.3}
.text{font-size:14px;color:#535862;line-height:1.6;margin-bottom:10px}
.cta{display:inline-block;background:#2162F9;color:#ffffff !important;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;margin:20px 0;mso-padding-alt:0}
.cta:link,.cta:visited,.cta:hover,.cta:active{color:#ffffff !important;text-decoration:none}
.fine{font-size:11px;color:#9ca3af;margin-top:14px}
.card-footer{padding:18px 28px;background:#FAFAFA;border-top:1px solid #F5F5F5;font-size:11px;color:#717680;line-height:1.6}
</style></head><body>
<div class="card">
  <div class="card-body">
    <p class="eyebrow">Pin Validator</p>
    <h1 class="heading">Validate pin locations<br/>for ${escape(opts.accountName)}</h1>
    <p class="text">Hi ${escape(opts.validatorName)},</p>
    <p class="text"><strong>${escape(opts.inviterName)}</strong> has invited you to review and approve the store pin locations for <strong>${escape(opts.accountName)}</strong>.</p>
    <p class="text">Open the validator below to view the pins on a map. You can approve, flag, or note each one.</p>
    <a href="${opts.inviteUrl}" class="cta" style="display:inline-block;background:#2162F9;color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;margin:20px 0"><span style="color:#ffffff">Open Pin Validator →</span></a>
    <p class="fine">This link is single-use and expires in 7 days. If you weren't expecting this, you can safely ignore it.</p>
  </div>
  <div class="card-footer">CST OS · Pin Validator</div>
</div>
</body></html>`;
}
