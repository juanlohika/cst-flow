import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const meetingId = params.id;

    // Fetch meeting using raw SQL to bypass the outdated Prisma Client (missing columns)
    const meetingsRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM TarkieMeeting WHERE id = ? AND userId = ?`,
      meetingId,
      session.user.id
    );
    
    if (!meetingsRes || meetingsRes.length === 0) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const rawMeeting = meetingsRes[0];
    
    // Normalize properties (ensure correct casing and defaults for manually added columns)
    const meeting = {
      ...rawMeeting,
      // Handle both camelCase and snake_case or lowercase coming from raw SQL
      meetingPrepSessionId: rawMeeting.meetingPrepSessionId || rawMeeting.meetingprepsessionid || rawMeeting.meeting_prep_session_id,
      activeApps: rawMeeting.activeApps || rawMeeting.activeapps || rawMeeting.active_apps || '[]',
      customAgenda: rawMeeting.customAgenda || rawMeeting.customagenda || rawMeeting.custom_agenda || null,
      projectId: rawMeeting.projectId || rawMeeting.projectid || rawMeeting.project_id || null,
      createdBy: rawMeeting.createdBy || rawMeeting.createdby || rawMeeting.created_by || session.user.id
    };

    // Fetch related data with separate queries
    const [attendees, transcript, prepSession] = await Promise.all([
      prisma.meetingAttendee.findMany({ where: { meetingId } }),
      prisma.meetingTranscript.findUnique({ where: { meetingId } }),
      meeting.meetingPrepSessionId
        ? prisma.meetingPrepSession.findUnique({ where: { id: meeting.meetingPrepSessionId } })
        : Promise.resolve(null),
    ]);

    // Construct full response object
    const response = {
      ...meeting,
      attendees,
      transcript,
      meetingPrepSession: prepSession
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Get meeting error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch meeting' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const meetingId = params.id;
    const body = await request.json();
    const sets: string[] = [];
    const vals: any[] = [];

    if (body.status) { sets.push(`status = ?`); vals.push(body.status); }
    if (body.recordingLink) { sets.push(`recordingLink = ?`); vals.push(body.recordingLink); }
    if (body.clientProfileId !== undefined) { sets.push(`clientProfileId = ?`); vals.push(body.clientProfileId ?? null); }
    if (body.activeApps !== undefined) { 
      const activeAppsStr = Array.isArray(body.activeApps) ? JSON.stringify(body.activeApps) : body.activeApps;
      sets.push(`activeApps = ?`); 
      vals.push(activeAppsStr); 
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 });
    }

    vals.push(meetingId, session.user.id);
    const affected = await prisma.$executeRawUnsafe(
      `UPDATE TarkieMeeting SET ${sets.join(", ")}, updatedAt = datetime('now') WHERE id = ? AND userId = ?`,
      ...vals
    );

    if (affected === 0) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update meeting error:', error);
    return NextResponse.json(
      { error: 'Failed to update meeting' },
      { status: 500 }
    );
  }
}