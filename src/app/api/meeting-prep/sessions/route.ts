import { NextResponse } from "next/server";
import { db } from "@/db";
import { meetingPrepSessions as meetingPrepSessionsTable, clientProfiles as clientProfilesTable } from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, inArray, SQL } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/meeting-prep/sessions
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const clientProfileId = url.searchParams.get("clientProfileId");
    const meetingType = url.searchParams.get("meetingType");
    const meetingPrepSessionId = url.searchParams.get("meetingPrepSessionId");

    // Build dynamic WHERE clause with Drizzle
    const filter = url.searchParams.get("filter");
    const conditions: SQL[] = [];
    if (filter === 'mine') conditions.push(eq(meetingPrepSessionsTable.userId, userId));

    if (status) {
      conditions.push(eq(meetingPrepSessionsTable.status, status));
    }
    if (clientProfileId) {
      conditions.push(eq(meetingPrepSessionsTable.clientProfileId, clientProfileId));
    }
    if (meetingPrepSessionId) {
      conditions.push(eq(meetingPrepSessionsTable.id, meetingPrepSessionId));
    } else if (meetingType) {
      if (meetingType.includes(",")) {
        const types = meetingType.split(",").map(t => t.trim());
        conditions.push(inArray(meetingPrepSessionsTable.meetingType, types as any[]));
      } else {
        conditions.push(eq(meetingPrepSessionsTable.meetingType, meetingType));
      }
    }

    const sessions = await db.select()
      .from(meetingPrepSessionsTable)
      .where(and(...conditions))
      .orderBy(desc(meetingPrepSessionsTable.updatedAt));

    // Fetch related profiles separately
    const profileIds = Array.from(new Set(sessions.map((s: any) => s.clientProfileId)));
    let profiles: any[] = [];
    if (profileIds.length > 0) {
      profiles = await db.select({
        id: clientProfilesTable.id,
        companyName: clientProfilesTable.companyName,
        industry: clientProfilesTable.industry,
        engagementStatus: clientProfilesTable.engagementStatus,
        primaryContact: clientProfilesTable.primaryContact
      })
      .from(clientProfilesTable)
      .where(inArray(clientProfilesTable.id, profileIds));
    }
    const profileMap = Object.fromEntries(profiles.map((p: any) => [p.id, p]));

    const result = sessions.map((s: any) => ({ ...s, clientProfile: profileMap[s.clientProfileId] || null }));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Fetch prep sessions error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch preparatory sessions" },
      { status: 500 }
    );
  }
}
