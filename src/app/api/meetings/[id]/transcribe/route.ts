import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { 
  tarkieMeetings as tarkieMeetingsTable, 
  meetingTranscripts as meetingTranscriptsTable 
} from '@/db/schema';
import { auth } from '@/auth';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/meetings/[id]/transcribe
 * MIGRATED TO DRIZZLE
 */
export async function POST(
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
    const rawBody = await request.json();
    const rawText: string = rawBody.text?.trim() ?? '';
    const text = rawText.replace(/\b(Turkey|Starkey|starkey|turkey)\b/g, "Tarkie");

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    // Verify meeting ownership
    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, meetingId)).limit(1);
    if (meetingRows.length === 0) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    // Append the new chunk to whatever transcript already exists
    const existingRows = await db.select({ rawTranscript: meetingTranscriptsTable.rawTranscript })
      .from(meetingTranscriptsTable)
      .where(eq(meetingTranscriptsTable.meetingId, meetingId))
      .limit(1);

    const existing = existingRows[0];
    const updated = existing?.rawTranscript
      ? `${existing.rawTranscript}\n${text}`
      : text;

    const transcriptId = existing ? undefined : `tr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

    await db.insert(meetingTranscriptsTable)
      .values({
        id: transcriptId || `temp_${Date.now()}`, // fallback if existing is null
        meetingId,
        rawTranscript: updated,
        primaryLanguage: 'bilingual',
        hasCodeSwitching: true,
        updatedAt: new Date().toISOString()
      })
      .onConflictDoUpdate({
        target: meetingTranscriptsTable.meetingId,
        set: {
          rawTranscript: updated,
          updatedAt: new Date().toISOString()
        }
      });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Transcribe save error:', error);
    return NextResponse.json(
      { error: 'Failed to save transcript chunk' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/meetings/[id]/transcribe
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

    // Verify ownership
    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, meetingId)).limit(1);
    if (meetingRows.length === 0) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

    const transcriptRows = await db.select().from(meetingTranscriptsTable).where(eq(meetingTranscriptsTable.meetingId, meetingId)).limit(1);

    return NextResponse.json({ transcript: transcriptRows[0] || null });
  } catch (error) {
    console.error('Get transcript error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcript' },
      { status: 500 }
    );
  }
}
