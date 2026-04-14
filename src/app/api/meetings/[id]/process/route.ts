import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { 
  tarkieMeetings as tarkieMeetingsTable, 
  meetingTranscripts as meetingTranscriptsTable,
  meetingAttendees as meetingAttendeesTable,
  skills as skillsTable,
  savedWorks as savedWorkTable
} from '@/db/schema';
import { auth } from '@/auth';
import { eq, and, inArray } from 'drizzle-orm';
import { getModelForApp, getStoredApiKey, generateWithRetry } from '@/lib/ai';

const TARKIE_INTEGRITY_RULE = `
IMPORTANT: "Tarkie" is our product name. Never mishear or transcribe it as "Turkey" (the animal or country) or "Starkey". If the transcript contains "Turkey" or "Starkey" where it refers to our product or ecosystem, ALWAYS correct it to "Tarkie". This is a non-negotiable rule.
`;

/**
 * POST /api/meetings/[id]/process
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

    // Fetch meeting
    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, meetingId)).limit(1);
    const meeting = meetingRows[0];

    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    // Fetch transcript
    const transcriptRows = await db.select().from(meetingTranscriptsTable).where(eq(meetingTranscriptsTable.meetingId, meetingId)).limit(1);
    const transcript = transcriptRows[0];

    const transcriptText = transcript?.rawTranscript?.trim() || "";
    const body = await request.json().catch(() => ({}));
    const { notes, flowchartResult, flowContext, verifiedTasks } = body;

    if (!transcriptText && !notes?.trim()) {
      return NextResponse.json(
        { error: 'No content to process. Please ensure either the transcript or facilitator notes are not empty.' },
        { status: 400 }
      );
    }

    const attendees = await db.select().from(meetingAttendeesTable).where(eq(meetingAttendeesTable.meetingId, meetingId));
    const attendeesText = attendees.map(a => `${a.fullName}${a.position ? ` (${a.position})` : ''}`).join('\n');
    const attendeesSection = attendeesText ? `\n\nATTENDEES:\n${attendeesText}` : '';
    
    const fullContentForAI = `TRANSCRIPT:\n${transcriptText}${notes ? `\n\nFACILITATOR LIVE NOTES:\n${notes}` : ''}${attendeesSection}`;

    const apiKey = await getStoredApiKey();
    const model = await getModelForApp("meetings");

    // Fetch Standard MOM Skill
    const momSkillRows = await db.select().from(skillsTable).where(and(eq(skillsTable.slug, 'minutes-template'), eq(skillsTable.isActive, true))).limit(1);
    const momSkill = momSkillRows[0];
    
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


    // Fetch BRD Skill (Loaded from Admin)
    const brdSkillRows = await db.select().from(skillsTable).where(and(eq(skillsTable.category, 'brd'), eq(skillsTable.isActive, true))).orderBy(desc(skillsTable.updatedAt)).limit(1);
    const brdSkillContent = brdSkillRows[0]?.content || "";

    // AI Prompts
    const minutesPrompt = `${momInstructions}\n\n${fullContentForAI}\n\nReturn ONLY a valid JSON object:\n{\n  "title": "Professional Meeting Title",\n  "date": "Meeting Date and Duration",\n  "attendees": ["List of all present individuals"],\n  "keyTakeaways": ["Explicit strategic decisions or realizations"],\n  "actionItems": [{"task": "detailed task", "owner": "assigned person or empty string"}],\n  "clarificationsRequired": ["Ambiguous or misheard points requiring followup"]\n}`;

    const brdPrompt = `
      ${brdSkillContent}
      
      You are processing a transcript from a live meeting.
      ${TARKIE_INTEGRITY_RULE}
      
      BA TASK: Extract and draft the Business Requirements based on the framework above.
      
      INPUT DATA:
      ${fullContentForAI}
      
      OUTPUT: Return ONLY a valid JSON object matching this schema:
      {
        "overview": "Comprehensive project overview",
        "scope": "In-scope and Out-of-scope details",
        "functionalRequirements": ["mapped requirements with Field/Dashboard/Manager tagging"],
        "nonFunctionalRequirements": ["quality/performance needs"],
        "assumptions": ["logic assumptions made"],
        "openItems": ["things requiring client confirmation based on the elicitation steps"]
      }
    `.trim();

    const tasksPrompt = `You are extracting action items. PRIORITIZE FACILITATOR NOTES.\n\n${fullContentForAI}\n\nReturn ONLY a valid JSON array:\n[\n  {"title": "task description", "owner": "person name or empty string", "due": "date if mentioned or empty string", "priority": "high|medium|low"}\n]\nIf no clear action items, return []`;

    // Run AI in parallel
    const [minutesResult, brdResult, tasksResult] = await Promise.all([
      generateWithRetry(model, minutesPrompt),
      generateWithRetry(model, brdPrompt),
      generateWithRetry(model, tasksPrompt),
    ]);

    const minutesState = safeParseJson(minutesResult.response.text()) ?? {
      title: meeting.title,
      date: typeof meeting.scheduledAt === 'string' ? meeting.scheduledAt : (meeting.scheduledAt as Date).toISOString(),
      attendees: attendees.map(a => a.fullName),
      keyTakeaways: [],
      actionItems: [],
      clarificationsRequired: [],
    };
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

    // Apply Verification Overrides
    if (Array.isArray(verifiedTasks)) {
      minutesState.actionItems = verifiedTasks.map((v: any) => ({
        task: v.task,
        owner: v.owner,
        plannedStart: v.plannedStart,
        plannedEnd: v.plannedEnd
      }));
      tasks = verifiedTasks.map((v: any) => ({
        title: v.task,
        owner: v.owner,
        priority: 'medium',
        due: v.plannedEnd || '',
        plannedStart: v.plannedStart,
        plannedEnd: v.plannedEnd
      }));
    }

    const minutesMarkdown = formatMinutesMarkdown(minutesState);
    const brdMarkdown = formatBRDMarkdown(brdState);

    await db.transaction(async (tx) => {
      // 1. Upsert transcript
      await tx.insert(meetingTranscriptsTable)
        .values({
          id: transcript?.id || `tr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          meetingId,
          rawTranscript: transcriptText,
          minutesOfMeeting: minutesMarkdown,
          generatedBRD: brdMarkdown,
          generatedTasks: JSON.stringify(tasks),
          primaryLanguage: 'bilingual',
          hasCodeSwitching: true,
          updatedAt: new Date().toISOString()
        })
        .onConflictDoUpdate({
          target: meetingTranscriptsTable.meetingId,
          set: {
            minutesOfMeeting: minutesMarkdown,
            generatedBRD: brdMarkdown,
            generatedTasks: JSON.stringify(tasks),
            updatedAt: new Date().toISOString()
          }
        });

      // 2. Complete meeting
      await tx.update(tarkieMeetingsTable)
        .set({ status: 'completed' })
        .where(eq(tarkieMeetingsTable.id, meetingId));

      const now = new Date().toISOString();

      // 3. Auto-save BRD to SavedWork
      if (brdMarkdown && meeting.clientProfileId) {
        await tx.insert(savedWorkTable).values({
          id: `sw_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          userId: userId,
          appType: 'brd',
          title: `BRD — ${meeting.title}`,
          data: brdMarkdown,
          clientProfileId: meeting.clientProfileId,
          createdAt: now,
          updatedAt: now
        });
      }

      // 4. Auto-save Flowchart to SavedWork
      if (flowchartResult && meeting.clientProfileId) {
        await tx.insert(savedWorkTable).values({
          id: `sw_flow_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
          userId: userId,
          appType: 'architect',
          title: `Process Flow (${flowContext || "as-is"}) — ${meeting.title}`,
          data: flowchartResult,
          clientProfileId: meeting.clientProfileId,
          createdAt: now,
          updatedAt: now
        });
      }
    });

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

function safeParseJson(raw: string): any | null {
  const text = raw.trim();
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
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
  if (state.attendees?.length) lines.push(`**Attendees:** ${state.attendees.join(', ')}`);
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
      const dates = (item.plannedStart || item.plannedEnd) ? ` | ${item.plannedStart || '?'} to ${item.plannedEnd || '?'}` : '';
      lines.push(`- ${item.task}${owner}${dates}`);
    });
    lines.push('');
  }
  if (state.clarificationsRequired?.length) {
    lines.push('## Clarification Required');
    lines.push('> [!CAUTION]\n> Points requiring confirmation.');
    state.clarificationsRequired.forEach((item: string) => lines.push(`- ${item}`));
  }
  return lines.join('\n').trim();
}

function formatBRDMarkdown(state: any): string {
  const lines: string[] = [];
  if (state.overview) lines.push('## Overview', state.overview, '');
  if (state.scope) lines.push('## Scope', state.scope, '');
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
  return lines.join('\n').trim();
}
