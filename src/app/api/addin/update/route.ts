import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getClaudeModel } from "@/lib/ai";

/**
 * POST /api/addin/update
 * Analyzes slide content vs account intelligence using Claude
 * and returns suggested text replacements.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { prompt, clientId, slideContent, applyToAll } = await req.json();

    let intelligence = "";
    let companyName = "General Context";

    // 1. Fetch Account Intelligence if a client is selected
    if (clientId) {
      const results = await db.select().from(clientProfiles).where(eq(clientProfiles.id, clientId)).limit(1);
      const client = results[0];
      if (client) {
        intelligence = client.intelligenceContent || "";
        companyName = client.companyName;
      }
    }

    // 2. Initialize Claude
    const model = await getClaudeModel();

    // 3. Construct System Prompt
    const systemPrompt = `You are an expert Presentation Assistant and Business Analyst part of the Team OS ecosystem.
Your goal is to help users update their PowerPoint slides with accuracy and intelligence.

CONTEXT:
Selected Account: ${companyName}
Account Intelligence (Markdown):
${intelligence || "No intelligence provided. Use general knowledge or follow the user's prompt exactly."}

TASK:
Identify text on the current slide that should be updated based on the User's Prompt and the Account Intelligence.
For example, if the slide has a placeholder like "[Name]" or "TBD" for a role, and the Intelligence has that person's name, suggest a replacement.
If the User says "Update the team", find team-related text on the slide and replace it with real team members from the Intelligence.

CURRENT SLIDE CONTENT:
${JSON.stringify(slideContent || [])}

USER PROMPT:
"${prompt}"

OUTPUT FORMAT:
Return ONLY a JSON array of objects with "original" and "replacement" fields.
Example: [{"original": "Customer Name", "replacement": "${companyName}"}]
Do NOT include any conversational text. Return an empty array if no updates are needed.
`;

    const response = await model.generateContent(systemPrompt);
    const text = response.response.text();

    // 4. Parse JSON from AI response
    try {
      // Find JSON block if AI included markdown formatting
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const suggestions = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      return NextResponse.json({ suggestions });
    } catch (e) {
      console.error("AI Response parsing failed:", text);
      return NextResponse.json({ suggestions: [], raw: text });
    }

  } catch (err: any) {
    console.error("POST /api/addin/update error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
