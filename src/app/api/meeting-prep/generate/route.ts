import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getModelForApp } from "@/lib/ai";

/**
 * POST /api/meeting-prep/generate
 * Generate agenda, questionnaire, and discussion guide for a client meeting
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
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
    const profile = await prisma.clientProfile.findUnique({
      where: { id: clientProfileId },
    });

    if (!profile || profile.userId !== session.user.id) {
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

    // Generate content using Gemini
    const model = await getModelForApp("meeting-prep");

    const prompt = buildGenerationPrompt(profile, meetingType, knowledgeBase);

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse the generated content
    const generated = parseGeneratedContent(text);

    // Create or update MeetingPrepSession
    let session_record = await prisma.meetingPrepSession.findFirst({
      where: {
        clientProfileId,
        meetingType,
      },
    });

    if (!session_record) {
      session_record = await prisma.meetingPrepSession.create({
        data: {
          userId: session.user.id,
          clientProfileId,
          meetingType,
          status: "ready",
          agendaContent: generated.agenda,
          questionnaireContent: generated.questionnaire,
          discussionGuide: generated.discussionGuide,
          preparationChecklist: generated.checklist,
          anticipatedRequirements: generated.anticipatedRequirements,
        },
      });
    } else {
      session_record = await prisma.meetingPrepSession.update({
        where: { id: session_record.id },
        data: {
          status: "ready",
          agendaContent: generated.agenda,
          questionnaireContent: generated.questionnaire,
          discussionGuide: generated.discussionGuide,
          preparationChecklist: generated.checklist,
          anticipatedRequirements: generated.anticipatedRequirements,
        },
      });
    }

    return NextResponse.json(session_record);
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
 * Falls back gracefully if no skill found for a given slug.
 */
async function loadKnowledgeBase(
  industry: string,
  modulesAvailed: string[],
  meetingType: string
): Promise<string> {
  let content = "";

  // Load industry skill (try exact match, then "general")
  const industrySkill = await prisma.skill.findFirst({
    where: { category: "meeting-prep", subcategory: "industry", slug: industry, isActive: true },
  }) ?? await prisma.skill.findFirst({
    where: { category: "meeting-prep", subcategory: "industry", slug: "general", isActive: true },
  });
  if (industrySkill) {
    content += `## Industry Context: ${industry}\n${industrySkill.content}\n\n`;
  }

  // Load meeting-type skill
  const meetingTypeSkill = await prisma.skill.findFirst({
    where: { category: "meeting-prep", subcategory: "meeting-type", slug: meetingType, isActive: true },
  });
  if (meetingTypeSkill) {
    content += `## Meeting Type Guide: ${meetingType}\n${meetingTypeSkill.content}\n\n`;
  }

  // Load any module-specific skills that match availed modules
  if (modulesAvailed.length > 0) {
    const moduleSkills = await prisma.skill.findMany({
      where: {
        category: "meeting-prep",
        subcategory: "module",
        slug: { in: modulesAvailed },
        isActive: true,
      },
    });
    for (const ms of moduleSkills) {
      content += `## Module: ${ms.slug}\n${ms.content}\n\n`;
    }
  }

  return content || "No knowledge base loaded — please seed skills via Admin > Skills.";
}

/**
 * Build the Gemini prompt
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
 * Stores arrays as JSON strings for DB storage.
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
