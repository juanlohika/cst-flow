import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable, tarkieMeetings as tarkieMeetingsTable, meetingAttendees as meetingAttendeesTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/meetings
 * MIGRATED TO DRIZZLE
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = params.id;

    // Verify account belongs to this user
    const accountRows = await db.select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, accountId))
      .limit(1);
      
    if (accountRows.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const meetings = await db.select()
      .from(tarkieMeetingsTable)
      .where(and(
        eq(tarkieMeetingsTable.clientProfileId, accountId),
        eq(tarkieMeetingsTable.userId, userId)
      ))
      .orderBy(desc(tarkieMeetingsTable.scheduledAt));

    // Fetch attendee counts
    const meetingIds = meetings.map((m: any) => m.id);
    const attendees = meetingIds.length > 0
      ? await db.select({ meetingId: meetingAttendeesTable.meetingId })
          .from(meetingAttendeesTable)
          .where(inArray(meetingAttendeesTable.meetingId, meetingIds))
      : [];

    const countByMeeting: Record<string, number> = {};
    for (const a of attendees) {
      countByMeeting[a.meetingId] = (countByMeeting[a.meetingId] || 0) + 1;
    }

    const result = meetings.map((m: any) => ({
      ...m,
      attendeeCount: countByMeeting[m.id] || 0,
    }));

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Account meetings error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch meetings" }, { status: 500 });
  }
}
