import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  accountMemberships,
  users as usersTable,
  clientContacts,
  telegramAccountLinks,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { getPortalSession } from "@/lib/portal/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/mentions
 * Returns the list of people the current portal contact can @-mention:
 *   - @arima (always)
 *   - Internal team members of this account
 *   - Other external contacts of this account
 *
 * The portal composer fetches this once and filters client-side as the user
 * types after `@`. Each entry includes the token format the API expects when
 * the user is later submitted.
 */
export async function GET() {
  try {
    await ensureAccessSchema();
    const portal = await getPortalSession();
    if (!portal) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Internal team for this account
    const members = await db
      .select({
        userId: accountMemberships.userId,
        internalRole: accountMemberships.internalRole,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(accountMemberships)
      .leftJoin(usersTable, eq(usersTable.id, accountMemberships.userId))
      .where(eq(accountMemberships.clientProfileId, portal.clientProfileId));

    // Telegram link status (so we can render a small badge in the dropdown)
    const links = members.length === 0 ? [] : await db
      .select({
        cstUserId: telegramAccountLinks.cstUserId,
        telegramUsername: telegramAccountLinks.telegramUsername,
      })
      .from(telegramAccountLinks)
      .where(and(
        inArray(telegramAccountLinks.cstUserId, members.map(m => m.userId)),
        eq(telegramAccountLinks.status, "active"),
      ));
    const linkByUserId = new Map(links.map(l => [l.cstUserId, l]));

    // Other external contacts on the same account (so two clients can ping each other)
    const peers = await db
      .select({ id: clientContacts.id, name: clientContacts.name, email: clientContacts.email })
      .from(clientContacts)
      .where(eq(clientContacts.clientProfileId, portal.clientProfileId));

    const out = [
      {
        type: "arima",
        id: "arima",
        name: "ARIMA",
        subtitle: "AI assistant",
        token: "@arima",
      },
      ...members
        .filter(m => m.name || m.email)
        .map(m => ({
          type: "internal",
          id: m.userId,
          name: m.name || m.email || "Team member",
          subtitle: [m.internalRole, linkByUserId.get(m.userId)?.telegramUsername ? `@${linkByUserId.get(m.userId)!.telegramUsername}` : null].filter(Boolean).join(" · "),
          token: `@[${m.name || m.email}](user:${m.userId})`,
        })),
      ...peers
        .filter(p => p.id !== portal.contactId)
        .map(p => ({
          type: "external",
          id: p.id,
          name: p.name,
          subtitle: p.email,
          token: `@[${p.name}](contact:${p.id})`,
        })),
    ];

    return NextResponse.json({ mentions: out });
  } catch (error: any) {
    console.error("[portal/mentions GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
