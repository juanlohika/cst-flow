import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { 
  clientProfiles as clientProfilesTable, 
  savedWorks as savedWorksTable, 
  tarkieMeetings as tarkieMeetingsTable, 
  meetingTranscripts as meetingTranscriptsTable 
} from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/brds
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

    // 1. Standalone BRDs saved via BRD Maker
    const standalone = await db.select()
      .from(savedWorksTable)
      .where(and(
        eq(savedWorksTable.appType, "brd"),
        eq(savedWorksTable.clientProfileId, accountId),
        eq(savedWorksTable.userId, userId)
      ))
      .orderBy(desc(savedWorksTable.updatedAt));

    // 2. BRDs generated from meetings
    const meetings = await db.select()
      .from(tarkieMeetingsTable)
      .where(and(
        eq(tarkieMeetingsTable.clientProfileId, accountId),
        eq(tarkieMeetingsTable.userId, userId)
      ))
      .orderBy(desc(tarkieMeetingsTable.scheduledAt));

    const meetingIds = meetings.map((m: any) => m.id);
    const transcripts = meetingIds.length > 0
      ? await db.select()
          .from(meetingTranscriptsTable)
          .where(and(
            inArray(meetingTranscriptsTable.meetingId, meetingIds),
            isNotNull(meetingTranscriptsTable.generatedBRD)
          ))
      : [];

    const meetingMap = Object.fromEntries(meetings.map((m: any) => [m.id, m]));

    const fromMeetings = transcripts
      .map((t: any) => ({
        id: t.id,
        source: "meeting" as const,
        meetingId: t.meetingId,
        meetingTitle: meetingMap[t.meetingId]?.title || "Untitled Meeting",
        meetingDate: meetingMap[t.meetingId]?.scheduledAt,
        content: t.generatedBRD,
        updatedAt: t.updatedAt,
      }));

    return NextResponse.json({
      standalone: standalone.map((w: any) => ({ ...w, source: "standalone" })),
      fromMeetings,
    });
  } catch (error: any) {
    console.error("Account BRDs error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch BRDs" }, { status: 500 });
  }
}
