import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  arimaCheckInSchedules,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { backfillSchedules } from "@/lib/arima/checkins/cadence";

export const dynamic = "force-dynamic";

/** GET — list every schedule joined with client info. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    // Make sure every client has a schedule row (lazy backfill)
    await backfillSchedules();

    const rows = await db
      .select({
        id: arimaCheckInSchedules.id,
        clientProfileId: arimaCheckInSchedules.clientProfileId,
        companyName: clientProfilesTable.companyName,
        clientCode: clientProfilesTable.clientCode,
        cadence: arimaCheckInSchedules.cadence,
        customIntervalDays: arimaCheckInSchedules.customIntervalDays,
        preferredChannel: arimaCheckInSchedules.preferredChannel,
        nextDueAt: arimaCheckInSchedules.nextDueAt,
        lastSentAt: arimaCheckInSchedules.lastSentAt,
        lastResponseAt: arimaCheckInSchedules.lastResponseAt,
        consecutiveNoResponse: arimaCheckInSchedules.consecutiveNoResponse,
        status: arimaCheckInSchedules.status,
      })
      .from(arimaCheckInSchedules)
      .innerJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaCheckInSchedules.clientProfileId))
      .orderBy(asc(arimaCheckInSchedules.nextDueAt));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[schedules GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
