import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { 
  tarkieMeetings as tarkieMeetingsTable, 
  skills as skillsTable 
} from '@/db/schema';
import { auth } from '@/auth';
import { eq, and, inArray } from 'drizzle-orm';
import { getModelForApp, getStoredApiKey } from '@/lib/ai';

const TARKIE_INTEGRITY_RULE = `
IMPORTANT: "Tarkie" is our product name. Never mishear or transcribe it as "Turkey" (the animal or country) or "Starkey". If the transcript contains "Turkey" or "Starkey" where it refers to our product or ecosystem, ALWAYS correct it to "Tarkie". This is a non-negotiable rule.
`;

const TAGLISH_RULE = `
SUPPORTED LANGUAGE (TAGLISH): The input transcript may contain a mix of English and Filipino (Taglish). You must comprehend the meaning in both languages and ensure the final output is written in formal, professional English.
`;

/**
 * POST /api/meetings/[id]/live-update
 * MIGRATED TO DRIZZLE
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let panel: string | undefined;
  let currentState: any;

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const meetingId = params.id;
    let newTranscript: string;
    let prepContext: any;
    let notes: string | undefined;
    ({ panel, newTranscript, currentState, prepContext, notes } =
      await request.json());

    if (!panel) {
      return NextResponse.json({ error: 'Panel is required' }, { status: 400 });
    }
    
    if (!newTranscript?.trim() && !notes?.trim()) {
      // Graceful "No Change" response to prevent 400s in console during silence
      return new Response(null, { status: 204 });
    }

    // Verify meeting ownership
    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, meetingId)).limit(1);
    if (meetingRows.length === 0) {
      return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
    }

    // Fetch relevant skills from DB
    const skillsRows = await db.select().from(skillsTable).where(and(
      inArray(skillsTable.slug, ['live-brd', 'live-minutes']),
      eq(skillsTable.isActive, true)
    ));
    
    const brdSkill = skillsRows.find(s => s.slug === 'live-brd')?.content || '';
    const minutesSkill = skillsRows.find(s => s.slug === 'live-minutes')?.content || '';

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

    console.log(`[live-update] Processing ${panel} | Transcript Length: ${newTranscript?.length || 0} | Notes Length: ${notes?.length || 0}`);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text().trim();

    if (!rawText) {
      console.warn(`[live-update] AI returned empty response for panel=${panel}`);
      return NextResponse.json({ panel, state: currentState, skipped: true, reason: 'empty' });
    }

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
${TAGLISH_RULE}
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
${TAGLISH_RULE}
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
