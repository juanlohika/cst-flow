import { NextResponse } from "next/server";
import { db } from "@/db";
import { 
  tarkieMeetings as tarkieMeetingsTable, 
  meetingAttendees as meetingAttendeesTable,
  meetingPrepSessions as meetingPrepSessionsTable,
  meetingAssignments as meetingAssignmentsTable,
  users as usersTable
} from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter");
    const status = searchParams.get("status");

    const conditions: any[] = [];
    if (filter === 'mine') conditions.push(eq(tarkieMeetingsTable.userId, userId));
    if (status) conditions.push(eq(tarkieMeetingsTable.status, status));

    const meetings = await db.select()
      .from(tarkieMeetingsTable)
      .where(and(...conditions))
      .orderBy(desc(tarkieMeetingsTable.scheduledAt));

    const meetingIds = meetings.map((m: any) => m.id);
    const allAttendees = meetingIds.length > 0
      ? await db.select().from(meetingAttendeesTable).where(inArray(meetingAttendeesTable.meetingId, meetingIds))
      : [];

    const attendeesByMeeting: Record<string, any[]> = {};
    for (const a of allAttendees) {
      if (!attendeesByMeeting[a.meetingId]) attendeesByMeeting[a.meetingId] = [];
      attendeesByMeeting[a.meetingId].push(a);
    }

    const result = meetings.map((m: any) => ({ ...m, attendees: attendeesByMeeting[m.id] || [] }));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Fetch meetings error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch meetings" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/meetings
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    let {
      meetingPrepSessionId,
      clientProfileId,
      projectId,
      title,
      companyName,
      meetingType,
      scheduledAt,
      durationMinutes,
      zoomLink,
      activeApps,
      customAgenda,
      preRegisteredAttendees,
      assignedIds,
      plannedStartTime,
    } = body;

    // Resolve meetingType + clientProfileId from prep session if not provided
    if (meetingPrepSessionId && (!meetingType || !clientProfileId)) {
      const prepRows = await db.select().from(meetingPrepSessionsTable).where(eq(meetingPrepSessionsTable.id, meetingPrepSessionId)).limit(1);
      const prep = prepRows[0];
      if (!meetingType) meetingType = prep?.meetingType;
      if (!clientProfileId) clientProfileId = prep?.clientProfileId;
    }

    if (!title || !scheduledAt || !meetingType) {
      return NextResponse.json(
        { error: "Title, scheduledAt, and meetingType are required" },
        { status: 400 }
      );
    }

    const meetingId = `meet_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    const qrCode = meetingId;
    const now = new Date().toISOString();
    
    // Formulate scheduled ISO from date + start time
    let scheduledISO = new Date(scheduledAt).toISOString();
    if (plannedStartTime) {
      try {
        const datePart = new Date(scheduledAt).toISOString().split('T')[0];
        scheduledISO = new Date(`${datePart}T${plannedStartTime.padStart(5, '0')}:00Z`).toISOString();
      } catch (e) {
        console.error("error formatting scheduled date:", e);
      }
    }

    const attendees: any[] = [];

    await db.transaction(async (tx) => {
      // 1. Detach existing meeting linked to this prep session
      if (meetingPrepSessionId) {
        await tx.update(tarkieMeetingsTable)
          .set({ meetingPrepSessionId: null })
          .where(eq(tarkieMeetingsTable.meetingPrepSessionId, meetingPrepSessionId));
      }

      // 2. Insert meeting
      await tx.insert(tarkieMeetingsTable).values({
        id: meetingId,
        userId: userId,
        meetingPrepSessionId: meetingPrepSessionId || null,
        clientProfileId: clientProfileId || null,
        projectId: projectId || null,
        createdBy: userId,
        title,
        companyName: companyName || null,
        meetingType,
        scheduledAt: scheduledISO,
        durationMinutes: durationMinutes || 60,
        zoomLink: zoomLink || null,
        qrCode,
        status: "scheduled",
        activeApps: JSON.stringify(activeApps || []),
        customAgenda: customAgenda || null,
        recordingEnabled: true,
        createdAt: now,
        updatedAt: now
      });

      // 3. Persist assignments (Team Members)
      if (assignedIds && Array.isArray(assignedIds) && assignedIds.length > 0) {
        const assignmentValues = assignedIds.map(uid => ({
          id: `ma_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          meetingId: meetingId,
          userId: uid
        }));
        await tx.insert(meetingAssignmentsTable).values(assignmentValues);

        // AUTO-REGISTER Team Assignments as Attendees
        const teamUsers = await tx.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, assignedIds));
          
        for (const u of teamUsers) {
          if (preRegisteredAttendees?.some((pa: any) => pa.email === u.email)) continue;
          const attId = `att_team_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
          await tx.insert(meetingAttendeesTable).values({
            id: attId,
            meetingId,
            fullName: u.name || "Team Member",
            email: u.email,
            registrationType: "team-assigned",
            attendanceStatus: "expected",
            createdAt: now
          });
          attendees.push({ id: attId, meetingId, fullName: u.name, email: u.email, registrationType: "team-assigned", attendanceStatus: "expected" });
        }
      }

      // 4. Insert pre-registered attendees
      if (preRegisteredAttendees && Array.isArray(preRegisteredAttendees) && preRegisteredAttendees.length > 0) {
        for (const att of preRegisteredAttendees) {
          const attId = `att_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
          await tx.insert(meetingAttendeesTable).values({
            id: attId,
            meetingId,
            fullName: att.fullName,
            position: att.position || null,
            companyName: att.companyName || null,
            mobileNumber: att.mobileNumber || null,
            email: att.email || null,
            registrationType: "pre-registered",
            attendanceStatus: "expected",
            consentGiven: false,
            createdAt: now
          });
          attendees.push({ id: attId, meetingId, ...att, registrationType: "pre-registered", attendanceStatus: "expected" });
        }
      }
    });

    // Fetch final canonical data
    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, meetingId)).limit(1);
    const meeting = meetingRows[0];

    return NextResponse.json({ ...meeting, attendees, qrValue: qrCode });
  } catch (error: any) {
    console.error("Create meeting error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create meeting" },
      { status: 500 }
    );
  }
}
