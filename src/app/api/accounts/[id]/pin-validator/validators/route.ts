/**
 * GET /api/accounts/[id]/pin-validator/validators
 *
 * List ClientContacts under this account that have pinValidatorEnabled=true,
 * plus their most-recent pin-validator magic link (so the UI can show
 * "active for X more days" or "expired — resend").
 *
 * Used by the PinValidatorTab to display the validators list with a
 * resend button.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  clientContacts,
  subscriberMagicLinks,
  pinValidatorProjects,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  await ensureAccessSchema();
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Find the active Pin Validator project for this account.
    const project = await db
      .select({ id: pinValidatorProjects.id })
      .from(pinValidatorProjects)
      .where(
        and(
          eq(pinValidatorProjects.clientProfileId, id),
          eq(pinValidatorProjects.status, "active"),
        ),
      )
      .limit(1);
    if (project.length === 0) {
      return NextResponse.json({ validators: [] });
    }
    const projectId = project[0].id;

    // Load every contact under this account flagged as pinValidatorEnabled.
    const contacts = await db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
        role: clientContacts.role,
        status: clientContacts.status,
        invitedAt: clientContacts.invitedAt,
        activatedAt: clientContacts.activatedAt,
        lastSeenAt: clientContacts.lastSeenAt,
      })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientProfileId, id),
          eq(clientContacts.pinValidatorEnabled, true),
        ),
      );

    // Then attach the most-recent pin-validator magic link per contact so
    // the UI can show "expires in X days" or "needs new invite".
    const validators = await Promise.all(
      contacts.map(async (c) => {
        const links = await db
          .select({
            token: subscriberMagicLinks.token,
            expiresAt: subscriberMagicLinks.expiresAt,
            usedAt: subscriberMagicLinks.usedAt,
            sentToEmail: subscriberMagicLinks.sentToEmail,
            createdAt: subscriberMagicLinks.createdAt,
          })
          .from(subscriberMagicLinks)
          .where(
            and(
              eq(subscriberMagicLinks.contactId, c.id),
              eq(subscriberMagicLinks.purpose, "pin_validator"),
              eq(subscriberMagicLinks.pinValidatorProjectId, projectId),
            ),
          )
          .orderBy(desc(subscriberMagicLinks.createdAt))
          .limit(1);
        const latest = links[0];
        const now = Date.now();
        const linkActive = latest
          ? new Date(latest.expiresAt).getTime() > now
          : false;
        return {
          contactId: c.id,
          name: c.name,
          email: c.email,
          role: c.role,
          status: c.status,
          invitedAt: c.invitedAt,
          activatedAt: c.activatedAt,
          lastSeenAt: c.lastSeenAt,
          linkActive,
          linkExpiresAt: latest?.expiresAt || null,
          linkSentToEmail: latest?.sentToEmail || null,
          linkUsedAt: latest?.usedAt || null,
          linkCreatedAt: latest?.createdAt || null,
        };
      }),
    );

    return NextResponse.json({ validators });
  } catch (e: any) {
    console.error("[pin-validator/validators] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to load validators" },
      { status: 500 },
    );
  }
}
