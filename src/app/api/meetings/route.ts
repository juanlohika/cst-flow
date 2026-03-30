import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings
 * Fetch all meetings for the current user
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const where: any = { userId: session.user.id };
    if (status) where.status = status;

    // Fetch flat to avoid libsql include issues, then manually attach attendees
    const meetings = await prisma.tarkieMeeting.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
    });

    const meetingIds = meetings.map((m: any) => m.id);
    const allAttendees = meetingIds.length > 0
      ? await prisma.meetingAttendee.findMany({ where: { meetingId: { in: meetingIds } } })
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
 * Create a new meeting from a prep session
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
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
      plannedEndTime,
    } = body;

    // Resolve meetingType + clientProfileId from prep session if not provided
    if (meetingPrepSessionId && (!meetingType || !clientProfileId)) {
      const prep = await prisma.meetingPrepSession.findUnique({
        where: { id: meetingPrepSessionId },
      });
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

    // Detach any existing meeting linked to this prep session (unique constraint)
    if (meetingPrepSessionId) {
      await prisma.$executeRawUnsafe(
        `UPDATE TarkieMeeting SET meetingPrepSessionId = NULL WHERE meetingPrepSessionId = ?`,
        meetingPrepSessionId
      );
    }

    // Insert meeting using raw SQL (avoids nested create issues with libsql)
    await prisma.$executeRawUnsafe(
      `INSERT INTO TarkieMeeting (
        id, userId, meetingPrepSessionId, clientProfileId, projectId, createdBy,
        title, companyName, meetingType, scheduledAt, durationMinutes,
        zoomLink, qrCode, status,
        activeApps,
        customAgenda,
        recordingEnabled, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      meetingId,
      session.user!.id,
      meetingPrepSessionId || null,
      clientProfileId || null,
      projectId || null,
      session.user!.id,
      title,
      companyName || null,
      meetingType,
      scheduledISO,
      durationMinutes || 60,
      zoomLink || null,
      qrCode,
      "scheduled",
      JSON.stringify(activeApps || []),
      customAgenda || null,
      1,
      now,
      now
    );

    // Persist assignments (Team Members)
    if (assignedIds && Array.isArray(assignedIds)) {
      for (const uid of assignedIds) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO MeetingAssignment (id, meetingId, userId) VALUES (?, ?, ?)`,
          `ma_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          meetingId,
          uid
        );
      }
    }

    // Insert pre-registered attendees one by one
    const attendees: any[] = [];
    for (const attendee of preRegisteredAttendees || []) {
      const attendeeId = `att_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO MeetingAttendee (
          id, meetingId, fullName, position, companyName, mobileNumber, email,
          registrationType, attendanceStatus, consentGiven, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        attendeeId,
        meetingId,
        attendee.fullName,
        attendee.position || null,
        attendee.companyName || null,
        attendee.mobileNumber || null,
        attendee.email || null,
        "pre-registered",
        "expected",
        0,
        now
      );
      attendees.push({ id: attendeeId, meetingId, ...attendee, registrationType: "pre-registered", attendanceStatus: "expected" });
    }

    // AUTO-REGISTER Team Assignments as Attendees
    if (assignedIds && Array.isArray(assignedIds)) {
      const users = await prisma.user.findMany({ 
        where: { id: { in: assignedIds } },
        select: { id: true, name: true, email: true }
      });
      for (const u of users) {
        // Skip if already pre-registered by email
        if (preRegisteredAttendees?.some((pa: any) => pa.email === u.email)) continue;
        
        const attendeeId = `att_team_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
        await prisma.$executeRawUnsafe(
          `INSERT INTO MeetingAttendee (
            id, meetingId, fullName, email, registrationType, attendanceStatus, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          attendeeId,
          meetingId,
          u.name || "Team Member",
          u.email,
          "team-assigned",
          "expected",
          now
        );
        attendees.push({ id: attendeeId, meetingId, fullName: u.name, email: u.email, registrationType: "team-assigned", attendanceStatus: "expected" });
      }
    }

    // Fetch the created meeting to return canonical data
    const meeting = await prisma.tarkieMeeting.findUnique({ where: { id: meetingId } });

    return NextResponse.json({ ...meeting, attendees, qrValue: qrCode });
  } catch (error: any) {
    console.error("Create meeting error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create meeting" },
      { status: 500 }
    );
  }
}
