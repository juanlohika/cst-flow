import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  arimaCheckIns,
  clientProfiles as clientProfilesTable,
  clientContacts,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/** GET — list of the last 100 check-ins joined with client info. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const rows = await db
      .select({
        id: arimaCheckIns.id,
        clientProfileId: arimaCheckIns.clientProfileId,
        companyName: clientProfilesTable.companyName,
        clientCode: clientProfilesTable.clientCode,
        contactId: arimaCheckIns.contactId,
        contactName: clientContacts.name,
        contactEmail: clientContacts.email,
        channel: arimaCheckIns.channel,
        status: arimaCheckIns.status,
        messageContent: arimaCheckIns.messageContent,
        sentAt: arimaCheckIns.sentAt,
        respondedAt: arimaCheckIns.respondedAt,
        escalatedAt: arimaCheckIns.escalatedAt,
        errorMessage: arimaCheckIns.errorMessage,
        triggeredByUserId: arimaCheckIns.triggeredByUserId,
        scheduledAt: arimaCheckIns.scheduledAt,
      })
      .from(arimaCheckIns)
      .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaCheckIns.clientProfileId))
      .leftJoin(clientContacts, eq(clientContacts.id, arimaCheckIns.contactId))
      .orderBy(desc(arimaCheckIns.scheduledAt))
      .limit(100);

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[history GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
