import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  clientContacts,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/portal-contacts — admin-only.
 * Returns every ClientContact across all accounts (with parent client info).
 * Powers the /admin/portal-contacts overview page so admins can find contacts
 * quickly across all clients.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    await ensureAccessSchema();

    const rows = await db
      .select({
        id: clientContacts.id,
        clientProfileId: clientContacts.clientProfileId,
        name: clientContacts.name,
        email: clientContacts.email,
        role: clientContacts.role,
        phone: clientContacts.phone,
        status: clientContacts.status,
        invitedAt: clientContacts.invitedAt,
        activatedAt: clientContacts.activatedAt,
        lastSeenAt: clientContacts.lastSeenAt,
        createdAt: clientContacts.createdAt,
        companyName: clientProfilesTable.companyName,
        clientCode: clientProfilesTable.clientCode,
      })
      .from(clientContacts)
      .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, clientContacts.clientProfileId))
      .orderBy(asc(clientProfilesTable.companyName), asc(clientContacts.name));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[admin/portal-contacts] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
