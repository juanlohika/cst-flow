import { NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable, meetingPrepSessions as meetingPrepSessionsTable, skills as skillsTable } from "@/db/schema";
import { auth } from "@/auth";
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import { eq, and, inArray } from "drizzle-orm";

/**
 * POST /api/meeting-prep/generate
 * Generate agenda, questionnaire, and discussion guide for a client meeting
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
    const { clientProfileId, meetingType } = body;

    if (!clientProfileId || !meetingType) {
      return NextResponse.json(
        { error: "clientProfileId and meetingType are required" },
        { status: 400 }
      );
    }

    // Fetch client profile
    const profileRows = await db.select()
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, clientProfileId))
      .limit(1);
    const profile = profileRows[0];

    if (!profile || profile.userId !== userId) {
      return NextResponse.json(
        { error: "Profile not found or unauthorized" },
        { status: 404 }
      );
    }

    // Load knowledge base files
    const knowledgeBase = await loadKnowledgeBase(
      profile.industry,
      JSON.parse(profile.modulesAvailed || "[]"),
      meetingType
    );

    // Generate content using AI
    const model = await getModelForApp("meeting-prep");

    const prompt = buildGenerationPrompt(profile, meetingType, knowledgeBase);

    const result = await generateWithRetry(model, prompt);
    const text = result.response.text();

    // Parse the generated content
    const generated = parseGeneratedContent(text);

    // Create or update MeetingPrepSession
    const existingSessions = await db.select({ id: meetingPrepSessionsTable.id })
      .from(meetingPrepSessionsTable)
      .where(and(
        eq(meetingPrepSessionsTable.clientProfileId, clientProfileId),
        eq(meetingPrepSessionsTable.meetingType, meetingType)
      ))
      .limit(1);

    let sessionId: string;
    const now = new Date().toISOString();

    if (existingSessions.length === 0) {
      sessionId = `mps_${Date.now()}`;
      await db.insert(meetingPrepSessionsTable).values({
        id: sessionId,
        userId,
        clientProfileId,
        meetingType,
        status: "ready",
        agendaContent: generated.agenda,
        questionnaireContent: generated.questionnaire,
        discussionGuide: generated.discussionGuide,
        preparationChecklist: generated.checklist,
        anticipatedRequirements: generated.anticipatedRequirements,
        createdAt: now,
        updatedAt: now
      });
    } else {
      sessionId = existingSessions[0].id;
      await db.update(meetingPrepSessionsTable)
        .set({
          status: "ready",
          agendaContent: generated.agenda,
          questionnaireContent: generated.questionnaire,
          discussionGuide: generated.discussionGuide,
          preparationChecklist: generated.checklist,
          anticipatedRequirements: generated.anticipatedRequirements,
          updatedAt: now
        })
        .where(eq(meetingPrepSessionsTable.id, sessionId));
    }

    // Read back the record
    const saved = await db.select()
      .from(meetingPrepSessionsTable)
      .where(eq(meetingPrepSessionsTable.id, sessionId))
      .limit(1);
      
    return NextResponse.json(saved[0] || { id: sessionId });
  } catch (error: any) {
    console.error("Generate prep error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate prep package" },
      { status: 500 }
    );
  }
}

/**
 * Load relevant knowledge base from the Skill DB table.
 * MIGRATED TO DRIZZLE
 */
async function loadKnowledgeBase(
  industry: string,
  modulesAvailed: string[],
  meetingType: string
): Promise<string> {
  let content = "";

  // Load industry skill (try exact match, then "general")
  const industrySkillRows = await db.select()
    .from(skillsTable)
    .where(and(
      eq(skillsTable.category, "meeting-prep"),
      eq(skillsTable.subcategory, "industry"),
      eq(skillsTable.slug, industry),
      eq(skillsTable.isActive, true)
    ))
    .limit(1);
    
  let industrySkill = industrySkillRows[0];
  
  if (!industrySkill) {
    const generalSkillRows = await db.select()
      .from(skillsTable)
      .where(and(
        eq(skillsTable.category, "meeting-prep"),
        eq(skillsTable.subcategory, "industry"),
        eq(skillsTable.slug, "general"),
        eq(skillsTable.isActive, true)
      ))
      .limit(1);
    industrySkill = generalSkillRows[0];
  }
  
  if (industrySkill) {
    content += `## Industry Context: ${industry}\n${industrySkill.content}\n\n`;
  }

  // Load meeting-type skill
  const meetingTypeSkillRows = await db.select()
    .from(skillsTable)
    .where(and(
      eq(skillsTable.category, "meeting-prep"),
      eq(skillsTable.subcategory, "meeting-type"),
      eq(skillsTable.slug, meetingType),
      eq(skillsTable.isActive, true)
    ))
    .limit(1);
    
  if (meetingTypeSkillRows[0]) {
    content += `## Meeting Type Guide: ${meetingType}\n${meetingTypeSkillRows[0].content}\n\n`;
  }

  // Load any module-specific skills that match availed modules
  if (modulesAvailed.length > 0) {
    const moduleSkills = await db.select()
      .from(skillsTable)
      .where(and(
        eq(skillsTable.category, "meeting-prep"),
        eq(skillsTable.subcategory, "module"),
        inArray(skillsTable.slug, modulesAvailed as any[]),
        eq(skillsTable.isActive, true)
      ));
      
    for (const ms of moduleSkills) {
      content += `## Module: ${ms.slug}\n${ms.content}\n\n`;
    }
  }

  return content || "No knowledge base loaded — please seed skills via Admin > Skills.";
}

/**
 * Build the prompt
 */
function buildGenerationPrompt(
  profile: any,
  meetingType: string,
  knowledgeBase: string
): string {
  return `You are an expert Tarkie implementation facilitator preparing for a client meeting.

KNOWLEDGE BASE:
${knowledgeBase}

CLIENT PROFILE:
- Company: ${profile.companyName}
- Industry: ${profile.industry}
- Modules Availed: ${JSON.parse(profile.modulesAvailed || "[]").join(", ") || "None specified"}
- Engagement Status: ${profile.engagementStatus}
- Special Considerations: ${profile.specialConsiderations || "None provided"}
- Primary Contact: ${profile.primaryContact || "Not specified"}

MEETING TYPE: ${meetingType}

Generate a meeting preparation package. Return ONLY a valid JSON object — no markdown fences, no explanation.

The JSON must follow this exact structure:
{
  "agenda": [
    { "time": "0:00", "topic": "string", "duration": "X min", "notes": "string" }
  ],
  "questionnaire": [
    { "category": "string", "question": "string" }
  ],
  "discussionGuide": "markdown string with facilitation tips and flow suggestions",
  "checklist": [
    { "task": "string", "category": "prep|materials|logistics" }
  ],
  "anticipatedRequirements": [
    { "module": "string", "requirement": "string", "priority": "high|medium|low" }
  ]
}

Rules:
- Agenda: realistic time allocations specific to their industry and availed modules
- Questionnaire: discovery-focused questions only, not sales-focused
- Discussion guide: facilitation notes, potential complexity areas, transition cues between topics
- Checklist: concrete tasks the facilitator must complete BEFORE the meeting
- Anticipated requirements: patterns common in their industry for their specific modules
- All text in professional English`;
}

/**
 * Parse the AI response into structured content.
 */
function parseGeneratedContent(text: string): {
  agenda: string;
  questionnaire: string;
  discussionGuide: string;
  checklist: string;
  anticipatedRequirements: string;
} {
  const empty = {
    agenda: "[]",
    questionnaire: "[]",
    discussionGuide: "",
    checklist: "[]",
    anticipatedRequirements: "[]",
  };

  // Strip markdown fences if present
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();

  // Extract first complete {...} block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return { ...empty, discussionGuide: text };

  try {
    const parsed = JSON.parse(match[0]);
    return {
      agenda: JSON.stringify(Array.isArray(parsed.agenda) ? parsed.agenda : []),
      questionnaire: JSON.stringify(Array.isArray(parsed.questionnaire) ? parsed.questionnaire : []),
      discussionGuide: typeof parsed.discussionGuide === "string" ? parsed.discussionGuide : "",
      checklist: JSON.stringify(Array.isArray(parsed.checklist) ? parsed.checklist : []),
      anticipatedRequirements: JSON.stringify(Array.isArray(parsed.anticipatedRequirements) ? parsed.anticipatedRequirements : []),
    };
  } catch (err) {
    console.error("Failed to parse prep JSON:", err);
    return { ...empty, discussionGuide: text };
  }
}
