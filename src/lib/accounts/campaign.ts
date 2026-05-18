/**
 * Phase C — Account Assessment Campaign helpers.
 *
 * Two responsibilities:
 *   1. computeCampaignQueue(): given a target scope, return the (Primary RM,
 *      account) pairs that should receive an assessment invite.
 *   2. sendCampaignInvites(): for a published campaign, persist one
 *      AssessmentCampaignTarget per pair and email each RM with a digest
 *      of their accounts.
 */
import { db } from "@/db";
import {
  clientProfiles,
  accountMemberships,
  users,
  assessmentCampaigns,
  assessmentCampaignTargets,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getSmtpTransport } from "@/lib/email";

export interface TargetScope {
  accountStatuses?: string[];     // e.g. ['confirmed', 'pilot']
  industries?: string[];          // exact match on ClientProfile.industry
  modulesAnyOf?: string[];        // any of these in the JSON modulesAvailed
  specificAccountIds?: string[];  // overrides everything else when set
}

export interface QueueEntry {
  rmUserId: string;
  rmName: string | null;
  rmEmail: string | null;
  accountId: string;
  companyName: string;
}

/**
 * Compute the (Primary RM, account) pairs that match the scope.
 * Only accounts with a Primary RM (accountMemberships.isPrimary=true) are
 * included — accounts with no primary tagged get a separate report from the
 * admin UI so they can backfill before publishing.
 */
export async function computeCampaignQueue(scope: TargetScope): Promise<QueueEntry[]> {
  // 1. Load every account, filtered by scope
  const allAccounts = await db.select({
    id: clientProfiles.id,
    companyName: clientProfiles.companyName,
    industry: clientProfiles.industry,
    engagementStatus: clientProfiles.engagementStatus,
    modulesAvailed: clientProfiles.modulesAvailed,
  }).from(clientProfiles);

  const filtered = allAccounts.filter(a => {
    if (scope.specificAccountIds && scope.specificAccountIds.length > 0) {
      return scope.specificAccountIds.includes(a.id);
    }
    if (scope.accountStatuses && scope.accountStatuses.length > 0) {
      if (!scope.accountStatuses.includes(a.engagementStatus)) return false;
    }
    if (scope.industries && scope.industries.length > 0) {
      if (!scope.industries.includes(a.industry)) return false;
    }
    if (scope.modulesAnyOf && scope.modulesAnyOf.length > 0) {
      const mods = parseModules(a.modulesAvailed);
      if (!scope.modulesAnyOf.some(m => mods.includes(m))) return false;
    }
    return true;
  });

  if (filtered.length === 0) return [];

  // 2. Load Primary RM for each filtered account
  const accountIds = filtered.map(a => a.id);
  const primaries = await db.select({
    rmUserId: accountMemberships.userId,
    clientProfileId: accountMemberships.clientProfileId,
  })
  .from(accountMemberships)
  .where(and(
    inArray(accountMemberships.clientProfileId, accountIds),
    eq(accountMemberships.isPrimary, true),
  ));

  if (primaries.length === 0) return [];

  // 3. Enrich with user info
  const rmIds = Array.from(new Set(primaries.map(p => p.rmUserId)));
  const rmRows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
  })
  .from(users)
  .where(inArray(users.id, rmIds));
  const rmById = new Map(rmRows.map(u => [u.id, u]));

  // 4. Build the queue
  const accountById = new Map(filtered.map(a => [a.id, a]));
  const queue: QueueEntry[] = [];
  for (const p of primaries) {
    const rm = rmById.get(p.rmUserId);
    const account = accountById.get(p.clientProfileId);
    if (!rm || !account) continue;
    queue.push({
      rmUserId: p.rmUserId,
      rmName: rm.name || null,
      rmEmail: rm.email || null,
      accountId: p.clientProfileId,
      companyName: account.companyName,
    });
  }
  return queue;
}

/**
 * Returns accounts that match the scope but have no Primary RM tagged.
 * Used to show admins what they need to backfill before publishing.
 */
export async function findAccountsMissingPrimaryRm(scope: TargetScope): Promise<Array<{ id: string; companyName: string; industry: string }>> {
  const allAccounts = await db.select({
    id: clientProfiles.id,
    companyName: clientProfiles.companyName,
    industry: clientProfiles.industry,
    engagementStatus: clientProfiles.engagementStatus,
    modulesAvailed: clientProfiles.modulesAvailed,
  }).from(clientProfiles);

  const filtered = allAccounts.filter(a => {
    if (scope.specificAccountIds && scope.specificAccountIds.length > 0) {
      return scope.specificAccountIds.includes(a.id);
    }
    if (scope.accountStatuses?.length && !scope.accountStatuses.includes(a.engagementStatus)) return false;
    if (scope.industries?.length && !scope.industries.includes(a.industry)) return false;
    if (scope.modulesAnyOf?.length) {
      const mods = parseModules(a.modulesAvailed);
      if (!scope.modulesAnyOf.some(m => mods.includes(m))) return false;
    }
    return true;
  });
  if (filtered.length === 0) return [];

  const accountIds = filtered.map(a => a.id);
  const primaries = await db.select({ clientProfileId: accountMemberships.clientProfileId })
    .from(accountMemberships)
    .where(and(
      inArray(accountMemberships.clientProfileId, accountIds),
      eq(accountMemberships.isPrimary, true),
    ));
  const haveRm = new Set(primaries.map(p => p.clientProfileId));
  return filtered.filter(a => !haveRm.has(a.id)).map(a => ({ id: a.id, companyName: a.companyName, industry: a.industry }));
}

/**
 * Publish a campaign: compute the queue, create AssessmentCampaignTarget rows,
 * send one email per RM (digesting all their accounts), update campaign status.
 *
 * Returns per-RM stats so the admin UI can show "Sent to N RMs / X accounts".
 */
export async function publishCampaign(args: {
  campaignId: string;
  appUrl: string;        // for the email links
}): Promise<{
  ok: boolean;
  rmCount: number;
  accountCount: number;
  emailsSent: number;
  emailsFailed: number;
  errors: string[];
}> {
  const cRows = await db.select().from(assessmentCampaigns).where(eq(assessmentCampaigns.id, args.campaignId)).limit(1);
  const campaign = cRows[0];
  if (!campaign) return { ok: false, rmCount: 0, accountCount: 0, emailsSent: 0, emailsFailed: 0, errors: ["Campaign not found"] };
  if (campaign.status !== "draft") {
    return { ok: false, rmCount: 0, accountCount: 0, emailsSent: 0, emailsFailed: 0, errors: [`Campaign is already ${campaign.status}`] };
  }

  const scope = campaign.targetScope ? safeParseJson(campaign.targetScope, {}) : {};
  const queue = await computeCampaignQueue(scope);
  if (queue.length === 0) {
    return { ok: false, rmCount: 0, accountCount: 0, emailsSent: 0, emailsFailed: 0, errors: ["No (RM, account) pairs match the target scope. Make sure Primary RM is set on each account."] };
  }

  // Group by RM so we send one email each
  const byRm = new Map<string, QueueEntry[]>();
  for (const q of queue) {
    if (!byRm.has(q.rmUserId)) byRm.set(q.rmUserId, []);
    byRm.get(q.rmUserId)!.push(q);
  }

  // Persist targets
  const now = new Date().toISOString();
  const targetRowsToInsert: any[] = [];
  for (const q of queue) {
    targetRowsToInsert.push({
      campaignId: args.campaignId,
      rmUserId: q.rmUserId,
      clientProfileId: q.accountId,
      createdAt: now,
    });
  }
  if (targetRowsToInsert.length > 0) {
    await db.insert(assessmentCampaignTargets).values(targetRowsToInsert);
  }

  // Send one email per RM
  let emailsSent = 0;
  let emailsFailed = 0;
  const errors: string[] = [];

  let transport: any = null;
  let fromAddr = "";
  try {
    const smtp = await getSmtpTransport();
    if (smtp) {
      transport = smtp.transport;
      fromAddr = smtp.from;
    }
  } catch (e: any) {
    errors.push(`SMTP config error: ${e?.message}`);
  }

  if (!transport) {
    errors.push("SMTP is not configured — campaign targets created but no emails sent. Admin can configure SMTP under /admin Credentials.");
  }

  // Iterate over each RM
  const rmEntries = Array.from(byRm.entries());
  for (const [rmUserId, accounts] of rmEntries) {
    const first = accounts[0];
    if (!first.rmEmail) {
      // No email on file — mark all this RM's targets as errored
      await markRmEmailError(args.campaignId, rmUserId, "RM has no email on file");
      emailsFailed += accounts.length;
      continue;
    }
    if (!transport) {
      await markRmEmailError(args.campaignId, rmUserId, "SMTP not configured");
      emailsFailed += accounts.length;
      continue;
    }

    try {
      const { subject, html, text } = composeCampaignEmail({
        rmName: first.rmName || first.rmEmail!,
        campaignTitle: campaign.title,
        campaignDescription: campaign.description || undefined,
        closesAt: campaign.closesAt || undefined,
        accounts: accounts.map(a => ({ id: a.accountId, name: a.companyName })),
        appUrl: args.appUrl,
      });

      await transport.sendMail({
        from: `"CST OS Account Health" <${fromAddr}>`,
        to: first.rmEmail,
        subject,
        html,
        text,
      });

      // Mark all this RM's targets as sent
      await db.update(assessmentCampaignTargets)
        .set({ emailSentAt: new Date().toISOString(), emailError: null })
        .where(and(
          eq(assessmentCampaignTargets.campaignId, args.campaignId),
          eq(assessmentCampaignTargets.rmUserId, rmUserId),
        ));
      emailsSent += accounts.length;
    } catch (e: any) {
      const msg = e?.message || String(e);
      errors.push(`Email to ${first.rmEmail}: ${msg}`);
      await markRmEmailError(args.campaignId, rmUserId, msg);
      emailsFailed += accounts.length;
    }
  }

  // Update campaign status
  await db.update(assessmentCampaigns)
    .set({
      status: "published",
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(assessmentCampaigns.id, args.campaignId));

  return {
    ok: true,
    rmCount: byRm.size,
    accountCount: queue.length,
    emailsSent,
    emailsFailed,
    errors,
  };
}

async function markRmEmailError(campaignId: string, rmUserId: string, error: string) {
  await db.update(assessmentCampaignTargets)
    .set({ emailError: error.slice(0, 800) })
    .where(and(
      eq(assessmentCampaignTargets.campaignId, campaignId),
      eq(assessmentCampaignTargets.rmUserId, rmUserId),
    ));
}

function composeCampaignEmail(args: {
  rmName: string;
  campaignTitle: string;
  campaignDescription?: string;
  closesAt?: string;
  accounts: Array<{ id: string; name: string }>;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const queueLink = `${args.appUrl}/assessments`;
  const deadline = args.closesAt ? new Date(args.closesAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : null;
  const subject = `Action needed: assess ${args.accounts.length} account${args.accounts.length === 1 ? "" : "s"} — ${args.campaignTitle}`;

  // Link each account directly to its dedicated assessment page so the RM
  // lands on the focused form, not the cluttered account detail view.
  const accountListHtml = args.accounts.map(a =>
    `<li style="margin: 4px 0;"><a href="${args.appUrl}/assessments/${a.id}" style="color:#4f46e5;text-decoration:none;font-weight:600;">${escapeHtml(a.name)}</a></li>`
  ).join("");

  const accountListText = args.accounts.map(a => `  • ${a.name} — ${args.appUrl}/assessments/${a.id}`).join("\n");

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="border-left: 4px solid #4f46e5; padding-left: 16px; margin-bottom: 24px;">
    <h2 style="margin: 0; font-size: 18px; color: #111827;">CST OS · Account Health Assessment</h2>
    <p style="margin: 4px 0 0; color: #6b7280; font-size: 13px;">${escapeHtml(args.campaignTitle)}</p>
  </div>

  <p>Hi ${escapeHtml(args.rmName.split(" ")[0] || args.rmName)},</p>
  <p>You're the Primary RM on <strong>${args.accounts.length}</strong> account${args.accounts.length === 1 ? "" : "s"} that need${args.accounts.length === 1 ? "s" : ""} a quick Health Assessment from you for the current campaign.</p>

  ${args.campaignDescription ? `<div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin:16px 0;color:#374151;font-size:14px;">${escapeHtml(args.campaignDescription)}</div>` : ""}

  ${deadline ? `<p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:8px 12px;border-radius:4px;color:#78350f;"><strong>Deadline:</strong> ${escapeHtml(deadline)}</p>` : ""}

  <p><strong>Your accounts:</strong></p>
  <ul style="padding-left: 20px;">${accountListHtml}</ul>

  <div style="margin: 24px 0;">
    <a href="${queueLink}" style="display:inline-block;background:#4f46e5;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open My Assessment Queue →</a>
  </div>

  <p style="color:#6b7280;font-size:13px;">Each assessment takes about 5 minutes. You can save a draft and come back — your answers feed into the CEO's executive view, so the more honest, the better.</p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="color:#9ca3af;font-size:11px;">You received this because you're the Primary RM on these accounts. Manage your assignments at <a href="${args.appUrl}/accounts" style="color:#6b7280;">${args.appUrl}/accounts</a>.</p>
</body>
</html>`;

  const text = `CST OS · Account Health Assessment
${args.campaignTitle}

Hi ${args.rmName.split(" ")[0] || args.rmName},

You're the Primary RM on ${args.accounts.length} account${args.accounts.length === 1 ? "" : "s"} that need a quick Health Assessment for the current campaign.
${args.campaignDescription ? "\n" + args.campaignDescription + "\n" : ""}
${deadline ? "\nDeadline: " + deadline + "\n" : ""}
Your accounts:
${accountListText}

Open your assessment queue: ${queueLink}

Each assessment takes ~5 minutes. Save drafts as you go.
`;

  return { subject, html, text };
}

function parseModules(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map(String);
  } catch {}
  return String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

function safeParseJson(raw: string, fb: any): any {
  try { return JSON.parse(raw); } catch { return fb; }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  } as any)[c]);
}
