import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

/**
 * POST /api/meetings/[id]/transcribe
 *
 * Accepts already-transcribed text (from the browser's Web Speech API)
 * and appends it to the meeting's rawTranscript in the database.
 *
 * No AI processing happens here — the text is ground-truth from the
 * browser STT engine. This eliminates hallucinations that occurred
 * when the previous implementation sent base64 audio to Gemini as text.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
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
    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: meetingId, userId: session.user.id },
    });

    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    // Append the new chunk to whatever transcript already exists
    const existing = await prisma.meetingTranscript.findUnique({
      where: { meetingId },
      select: { rawTranscript: true },
    });

    const updated = existing?.rawTranscript
      ? `${existing.rawTranscript}\n${text}`
      : text;

    const stored = await prisma.meetingTranscript.upsert({
      where: { meetingId },
      update: {
        rawTranscript: updated,
        updatedAt: new Date(),
      },
      create: {
        meetingId,
        rawTranscript: text,
        primaryLanguage: 'bilingual',
        hasCodeSwitching: true,
      },
    });

    return NextResponse.json({ success: true, id: stored.id });
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
 * Returns the full transcript for a meeting.
 */
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

    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: meetingId, userId: session.user.id },
    });

    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const transcript = await prisma.meetingTranscript.findUnique({
      where: { meetingId },
    });

    return NextResponse.json({ transcript });
  } catch (error) {
    console.error('Get transcript error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcript' },
      { status: 500 }
    );
  }
}
