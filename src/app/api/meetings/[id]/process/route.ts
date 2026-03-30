import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { getModelForApp, getStoredApiKey } from '@/lib/ai';

const TARKIE_INTEGRITY_RULE = `
IMPORTANT: "Tarkie" is our product name. Never mishear or transcribe it as "Turkey" (the animal or country) or "Starkey". If the transcript contains "Turkey" or "Starkey" where it refers to our product or ecosystem, ALWAYS correct it to "Tarkie". This is a non-negotiable rule.
`;

/**
 * POST /api/meetings/[id]/process
 *
 * Called once when a meeting ends. Generates polished final versions of
 * Minutes, BRD, and Tasks from the full accumulated transcript.
 *
 * Anti-hallucination rules are applied to all prompts:
 * - AI is instructed to ONLY extract what was explicitly stated
 * - Structured JSON output prevents regex-based parsing failures
 * - A single focused prompt per output type (not one combined prompt)
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

    // Fetch meeting and transcript separately (libsql adapter breaks on include)
    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: meetingId, userId: session.user.id },
    });

    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    const transcript = await prisma.meetingTranscript.findUnique({
      where: { meetingId },
    });

    const transcriptText = transcript?.rawTranscript?.trim() || "";
    const body = await request.json().catch(() => ({}));
    const { notes, flowchartResult, flowContext, verifiedTasks } = body;

    if (!transcriptText && !notes?.trim()) {
      return NextResponse.json(
        { error: 'No content to process. Please ensure either the transcript or facilitator notes are not empty.' },
        { status: 400 }
      );
    }


    const attendees = await prisma.meetingAttendee.findMany({ where: { meetingId } });
    const attendeesText = attendees.map(a => `${a.fullName}${a.position ? ` (${a.position})` : ''}`).join('\n');
    const attendeesSection = attendeesText ? `\n\nATTENDEES:\n${attendeesText}` : '';
    
    const fullContentForAI = `TRANSCRIPT:\n${transcriptText}${notes ? `\n\nFACILITATOR LIVE NOTES:\n${notes}` : ''}${attendeesSection}`;

    const apiKey = await getStoredApiKey();
    const model = await getModelForApp("meetings");

    // Fetch Standard MOM Skill
    const momSkill = await prisma.skill.findFirst({
      where: { slug: 'minutes-template', isActive: true }
    });
    
    // User requested format for MOM
    const baseMomInstructions = `
The format should be:
- Meeting Title
- Date & Time
- Attendees (Based on attendance record)
- Key Takeaways
- Action Next Steps
- Rule: Do not hallucinate.
- ${TARKIE_INTEGRITY_RULE}
- Ask clarification questions if things got non-sense like perhaps a misheard terminology or unknown terminology.
`;

    const momInstructions = (momSkill?.content || "") + "\n" + baseMomInstructions;


    // ── Generate Minutes ───────────────────────────────────────────────────
    const minutesPrompt = `${momInstructions}

${fullContentForAI}

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "title": "Professional Meeting Title",
  "date": "Meeting Date and Duration",
  "attendees": ["List of all present individuals"],
  "keyTakeaways": ["Explicit strategic decisions or realizations"],
  "actionItems": [{"task": "detailed task", "owner": "assigned person or empty string"}],
  "clarificationsRequired": ["Ambiguous or misheard points requiring followup"]
}`;

    // ── Generate BRD ───────────────────────────────────────────────────────
    const brdPrompt = `You are a professional business analyst producing a Business Requirements Document.

CRITICAL RULES:
1. Only capture requirements EXPLICITLY stated by participants or in notes
2. Do NOT infer requirements from context or general knowledge
3. The transcript is in mixed English and Filipino — convert meaning to professional English
4. If something is ambiguous, omit it
5. ${TARKIE_INTEGRITY_RULE}

${fullContentForAI}

Return ONLY a valid JSON object (no markdown, no code fences):
{
  "overview": "1-2 sentence summary of what was discussed",
  "scope": "what is in scope based on the discussion",
  "functionalRequirements": ["explicit functional requirement 1", "..."],
  "nonFunctionalRequirements": ["explicit non-functional requirement 1", "..."],
  "assumptions": ["explicit assumption stated"],
  "openItems": ["unresolved requirement gaps"]
}`;

    // ── Generate Tasks ─────────────────────────────────────────────────────
    const tasksPrompt = `You are extracting action items.

SOURCES OF TRUTH:
1. FACILITATOR LIVE NOTES (ABSOLUTE PRIORITY): Include any task or action items written here, even if the transcript is silent.
2. TRANSCRIPT: Extract explicitly assigned tasks discussed during the meeting.

CRITICAL RULES:
1. Only extract tasks EXPLICITLY assigned or agreed upon.
2. If the transcript is empty but notes contain tasks, you MUST extract them.
3. The transcript is in mixed English and Filipino.
4. If a task in the Notes conflicts with the Transcript, PRIORITIZE the Notes.
5. Do NOT hallucinate.
6. ${TARKIE_INTEGRITY_RULE}


${fullContentForAI}

Return ONLY a valid JSON array (no markdown, no code fences):
[
  {"title": "task description", "owner": "person name or empty string", "due": "date if mentioned or empty string", "priority": "high|medium|low"}
]

If no clear action items were assigned, return an empty array: []`;

    // Run all three in parallel
    const [minutesResult, brdResult, tasksResult] = await Promise.all([
      model.generateContent(minutesPrompt),
      model.generateContent(brdPrompt),
      model.generateContent(tasksPrompt),
    ]);

    const minutesState = safeParseJson(minutesResult.response.text()) ?? {
      title: meeting.title,
      date: meeting.scheduledAt.toISOString(),
      attendees: attendees.map(a => a.fullName),
      keyTakeaways: [],
      actionItems: [],
      clarificationsRequired: [],
    };

    // Use attendance records as primary source
    minutesState.attendees = attendees.map(a => a.fullName);

    const brdState = safeParseJson(brdResult.response.text()) ?? {
      overview: '',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
    };

    let tasks = (() => {
      const parsed = safeParseJson(tasksResult.response.text());
      return Array.isArray(parsed) ? parsed : [];
    })();

    // ── Apply Verification Overrides ──────────────────────────────────────
    if (Array.isArray(verifiedTasks) && verifiedTasks.length > 0) {
      // Override Action Next Steps in minutes
      minutesState.actionItems = verifiedTasks.map((v: any) => ({
        task: v.task,
        owner: v.owner,
        plannedStart: v.plannedStart,
        plannedEnd: v.plannedEnd
      }));

      // Override Task Roadmap items
      tasks = verifiedTasks.map((v: any) => ({
        title: v.task,
        owner: v.owner,
        priority: 'medium',
        due: v.plannedEnd || '',
        plannedStart: v.plannedStart,
        plannedEnd: v.plannedEnd
      }));
    }

    // Format minutes as readable markdown for storage/display
    const minutesMarkdown = formatMinutesMarkdown(minutesState);
    const brdMarkdown = formatBRDMarkdown(brdState);

    // Save to database — upsert in case the transcript record doesn't exist yet
    await prisma.meetingTranscript.upsert({
      where: { meetingId },
      update: {
        minutesOfMeeting: minutesMarkdown,
        generatedBRD: brdMarkdown,
        generatedTasks: JSON.stringify(tasks),
        updatedAt: new Date(),
      },
      create: {
        meetingId,
        rawTranscript: transcriptText,
        minutesOfMeeting: minutesMarkdown,
        generatedBRD: brdMarkdown,
        generatedTasks: JSON.stringify(tasks),
        primaryLanguage: 'bilingual',
        hasCodeSwitching: true,
      },
    });

    // Use raw SQL to avoid libsql adapter issues with Prisma update()
    await prisma.$executeRawUnsafe(
      `UPDATE TarkieMeeting SET status = 'completed' WHERE id = ?`,
      meetingId
    );

    const now = new Date().toISOString();

    // Auto-save BRD as SavedWork if meeting has a linked account
    if (brdMarkdown && (meeting as any).clientProfileId) {
      const swId = `sw_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO SavedWork (id, userId, appType, title, data, clientProfileId, createdAt, updatedAt)
         VALUES (?, ?, 'brd', ?, ?, ?, ?, ?)`,
        swId,
        session.user!.id,
        `BRD — ${(meeting as any).title}`,
        brdMarkdown,
        (meeting as any).clientProfileId,
        now,
        now
      );
    }

    // Auto-save Flowchart as SavedWork if provided and has a linked account
    if (flowchartResult && (meeting as any).clientProfileId) {
      const swId = `sw_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO SavedWork (id, userId, appType, title, data, clientProfileId, createdAt, updatedAt)
         VALUES (?, ?, 'architect', ?, ?, ?, ?, ?)`,
        swId,
        session.user!.id,
        `Process Flow (${flowContext || "as-is"}) — ${(meeting as any).title}`,
        flowchartResult,
        (meeting as any).clientProfileId,
        now,
        now
      );
    }

    return NextResponse.json({
      minutes: minutesMarkdown,
      brd: brdMarkdown,
      tasks,
      success: true,
    });
  } catch (error: any) {
    console.error('Meeting process error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process meeting' },
      { status: 500 }
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJson(raw: string): any | null {
  const text = raw.trim();

  // Try 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Try 2: strip ```json ... ``` fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }

  // Try 3: first complete { ... } or [ ... ] block
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }

  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }

  return null;
}

function formatMinutesMarkdown(state: any): string {
  const lines: string[] = [];

  lines.push(`# ${state.title || 'Minutes of Meeting'}`);
  lines.push(`**Date:** ${state.date || 'N/A'}`);
  if (state.attendees?.length) {
    lines.push(`**Attendees:** ${state.attendees.join(', ')}`);
  }
  lines.push('');

  if (state.keyTakeaways?.length) {
    lines.push('## Key Takeaways');
    state.keyTakeaways.forEach((item: string) => lines.push(`- ${item}`));
    lines.push('');
  }
  if (state.actionItems?.length) {
    lines.push('## Action Items & Next Steps');
    state.actionItems.forEach((item: any) => {
      const owner = item.owner ? ` (${item.owner})` : '';
      const dates = (item.plannedStart || item.plannedEnd) 
        ? ` | ${item.plannedStart || '?'} to ${item.plannedEnd || '?'}`
        : '';
      lines.push(`- ${item.task}${owner}${dates}`);
    });
    lines.push('');
  }
  if (state.clarificationsRequired?.length) {
    lines.push('## Clarification Required');
    lines.push('> [!CAUTION]');
    lines.push('> The following points were ambiguous or misheard during the meeting and require confirmation.');
    state.clarificationsRequired.forEach((item: string) => lines.push(`- ${item}`));
    lines.push('');
  }

  return lines.join('\n').trim() || 'No content extracted from transcript.';
}

function formatBRDMarkdown(state: any): string {
  const lines: string[] = [];

  if (state.overview) {
    lines.push('## Overview');
    lines.push(state.overview);
    lines.push('');
  }
  if (state.scope) {
    lines.push('## Scope');
    lines.push(state.scope);
    lines.push('');
  }
  if (state.functionalRequirements?.length) {
    lines.push('## Functional Requirements');
    state.functionalRequirements.forEach((r: string) => lines.push(`- ${r}`));
    lines.push('');
  }
  if (state.nonFunctionalRequirements?.length) {
    lines.push('## Non-Functional Requirements');
    state.nonFunctionalRequirements.forEach((r: string) => lines.push(`- ${r}`));
    lines.push('');
  }
  if (state.assumptions?.length) {
    lines.push('## Assumptions');
    state.assumptions.forEach((a: string) => lines.push(`- ${a}`));
    lines.push('');
  }
  if (state.openItems?.length) {
    lines.push('## Open Items');
    state.openItems.forEach((item: string) => lines.push(`- ${item}`));
  }

  return lines.join('\n').trim() || 'No BRD content extracted from transcript.';
}
