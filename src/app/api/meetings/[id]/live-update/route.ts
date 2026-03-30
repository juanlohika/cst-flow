import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { getModelForApp, getStoredApiKey } from '@/lib/ai';

const TARKIE_INTEGRITY_RULE = `
IMPORTANT: "Tarkie" is our product name. Never mishear or transcribe it as "Turkey" (the animal or country) or "Starkey". If the transcript contains "Turkey" or "Starkey" where it refers to our product or ecosystem, ALWAYS correct it to "Tarkie". This is a non-negotiable rule.
`;

/**
 * POST /api/meetings/[id]/live-update
 *
 * Called every ~20 seconds during a live meeting to update a specific
 * AI panel (minutes or brd) based on newly transcribed speech.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let panel: string | undefined;
  let currentState: any;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const meetingId = params.id;
    let newTranscript: string;
    let prepContext: any;
    let notes: string | undefined;
    ({ panel, newTranscript, currentState, prepContext, notes } =
      await request.json());

    if (!panel || (!newTranscript?.trim() && !notes?.trim())) {
      return NextResponse.json(
        { error: 'Either newTranscript or notes is required' },
        { status: 400 }
      );
    }

    // Verify meeting ownership
    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: meetingId, userId: session.user.id },
    });
    if (!meeting) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    // Fetch relevant skills from DB
    const skills = await prisma.skill.findMany({
      where: {
        slug: { in: ['live-brd', 'live-minutes'] },
        isActive: true
      }
    });
    const brdSkill = skills.find(s => s.slug === 'live-brd')?.content || '';
    const minutesSkill = skills.find(s => s.slug === 'live-minutes')?.content || '';

    const apiKey = await getStoredApiKey();
    const model = await getModelForApp("meetings");

    let prompt = '';

    if (panel === 'minutes') {
      prompt = buildMinutesPrompt(newTranscript || '', currentState, notes, minutesSkill);
    } else if (panel === 'brd') {
      prompt = buildBrdPrompt(newTranscript || '', currentState, prepContext, notes, brdSkill);
    } else {
      return NextResponse.json({ error: 'Invalid panel. Use "minutes" or "brd".' }, { status: 400 });
    }

    const result = await model.generateContent(prompt);
    const rawText = result.response.text().trim();

    const state = parseJsonResponse(rawText);
    if (!state) {
      console.error(`[live-update] AI returned non-JSON for panel=${panel}:`, rawText.slice(0, 300));
      return NextResponse.json({ panel, state: currentState, skipped: true });
    }

    return NextResponse.json({ panel, state });
  } catch (error: any) {
    const msg: string = error.message || '';
    if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests')) {
      return NextResponse.json({ panel, state: currentState, skipped: true, reason: 'quota' });
    }
    console.error('Live update error:', error);
    return NextResponse.json({ error: msg || 'Live update failed' }, { status: 500 });
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildMinutesPrompt(newTranscript: string, currentState: any, notes: string | undefined, skillContent: string): string {
  const notesSection = notes ? `\n\nFACILITATOR LIVE NOTES (PRIORITY):\n${notes}\n` : '';
  const skillSection = skillContent ? `\n\nOPERATING SKILLS & INSTRUCTIONS:\n${skillContent}\n` : '';
  
  return `You are a live meeting scribe. Update the minutes based on the new transcript and notes.
${skillSection}
${notesSection}
NEW TRANSCRIPT CONTENT:
"${newTranscript || '[No new speech]'}"

CURRENT STATE (JSON):
${JSON.stringify(currentState || { keyAgreements: [], discussionPoints: [], actionItems: [], openQuestions: [], parkingLot: [], clarificationsRequired: [] }, null, 2)}

Return ONLY a valid JSON object matching this structure:
{
  "keyAgreements": ["strings"],
  "discussionPoints": ["strings"],
  "actionItems": [{"task": "string", "owner": "string"}],
  "openQuestions": ["strings"],
  "parkingLot": ["strings"],
  "clarificationsRequired": ["critical questions for facilitator to ask"],
  "rule": "${TARKIE_INTEGRITY_RULE}"
}`;
}


function buildBrdPrompt(newTranscript: string, currentState: any, prepContext: any, notes: string | undefined, skillContent: string): string {
  const notesSection = notes ? `\n\nFACILITATOR LIVE NOTES (PRIORITY):\n${notes}\n` : '';
  const skillSection = skillContent ? `\n\nOPERATING SKILLS & INSTRUCTIONS:\n${skillContent}\n` : '';
  
  const questions: string[] = [];
  if (prepContext?.questionnaire && Array.isArray(prepContext.questionnaire)) {
    prepContext.questionnaire.slice(0, 8).forEach((q: any) => {
      const text = typeof q === 'string' ? q : q.question || q.text || '';
      if (text) questions.push(text);
    });
  }

  return `You are a Senior Business Analyst updating a BRD in real-time.
${skillSection}
${notesSection}
PREP QUESTIONNAIRE CONTEXT:
${questions.length > 0 ? questions.map((q, i) => `${i + 1}. ${q}`).join('\n') : 'None'}

NEW TRANSCRIPT CONTENT:
"${newTranscript}"

CURRENT STATE (JSON):
${JSON.stringify(currentState || { requirements: [], suggestedQuestions: [] }, null, 2)}

STRICT RULES:
1. Capture Tarkie ecosystem requirements (Field App, Manager App, Control Tower).
2. Distinguish between Current vs Future state.
3. INTERACTIVE QUESTIONS: If you need a quick decision (like platform choice), return an object in "suggestedQuestions" instead of a string.
4. If a "Facilitator Selection" appears in the transcript, resolve the corresponding requirement/question immediately.
5. ${TARKIE_INTEGRITY_RULE}

Return ONLY a valid JSON object matching this structure:
{
  "requirements": [
    {"text": "requirement string", "type": "functional | non-functional"}
  ],
  "suggestedQuestions": [
    "simple string question",
    {"question": "The question text", "options": ["Option A", "Option B"]}
  ]
}`;
}

// ─── JSON parser ─────────────────────────────────────────────────────────────

function parseJsonResponse(raw: string): any | null {
  try { return JSON.parse(raw); } catch {}
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) { try { return JSON.parse(fenceMatch[1].trim()); } catch {} }
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  return null;
}
