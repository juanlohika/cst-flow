import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { 
  tarkieMeetings as tarkieMeetingsTable, 
  meetingAttendees as meetingAttendeesTable, 
  meetingTranscripts as meetingTranscriptsTable, 
  meetingPrepSessions as meetingPrepSessionsTable 
} from '@/db/schema';
import { auth } from '@/auth';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/meetings/[id]
 * MIGRATED TO DRIZZLE
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const meetingId = params.id;

    // Fetch meeting
    const meetingsRes = await db.select()
      .from(tarkieMeetingsTable)
      .where(eq(tarkieMeetingsTable.id, meetingId))
      .limit(1);
    
    if (meetingsRes.length === 0) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const meeting = meetingsRes[0];
    
    // Fetch related data
    const [attendees, transcriptRows, prepSessionRows] = await Promise.all([
      db.select().from(meetingAttendeesTable).where(eq(meetingAttendeesTable.meetingId, meetingId)),
      db.select().from(meetingTranscriptsTable).where(eq(meetingTranscriptsTable.meetingId, meetingId)).limit(1),
      meeting.meetingPrepSessionId
        ? db.select().from(meetingPrepSessionsTable).where(eq(meetingPrepSessionsTable.id, meeting.meetingPrepSessionId)).limit(1)
        : Promise.resolve([]),
    ]);

    // Construct full response object
    const response = {
      ...meeting,
      attendees,
      transcript: transcriptRows[0] || null,
      meetingPrepSession: prepSessionRows[0] || null
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

/**
 * PATCH /api/meetings/[id]
 * MIGRATED TO DRIZZLE
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const meetingId = params.id;
    const body = await request.json();
    const updateData: any = { updatedAt: new Date().toISOString() };

    if (body.status) updateData.status = body.status;
    if (body.recordingLink) updateData.recordingLink = body.recordingLink;
    if (body.clientProfileId !== undefined) updateData.clientProfileId = body.clientProfileId ?? null;
    if (body.activeApps !== undefined) { 
      updateData.activeApps = Array.isArray(body.activeApps) ? JSON.stringify(body.activeApps) : body.activeApps;
    }

    if (Object.keys(updateData).length <= 1) { // only updatedAt
      return NextResponse.json({ error: 'No valid fields provided for update' }, { status: 400 });
    }

    const result = await db.update(tarkieMeetingsTable)
      .set(updateData)
      .where(eq(tarkieMeetingsTable.id, meetingId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update meeting error:', error);
    return NextResponse.json(
      { error: 'Failed to update meeting' },
      { status: 500 }
    );
  }
}