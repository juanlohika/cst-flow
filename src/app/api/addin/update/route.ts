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

    const { prompt, clientId, slideContent, applyToAll, history } = await req.json();

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
Your goal is to help users update their PowerPoint slides with accuracy and intelligence. Use a professional, helpful, and conversational tone.

CONTEXT:
Selected Account: ${companyName}
Account Intelligence (Markdown):
${intelligence || "No intelligence provided. Use general knowledge."}

CURRENT SLIDE CONTENT:
${JSON.stringify(slideContent || [])}

CONVERSATION HISTORY:
${(history || []).map((m: any) => `${m.role.toUpperCase()}: ${m.text}`).join("\n")}

TASK:
1. Analyze the USER PROMPT in the context of the HISTORY and the CURRENT SLIDE.
2. If the user asks to update or fill in data, identify the relevant text on the slide and suggest replacements using the Intelligence.
3. If the user is just chatting or asking for advice, provide a helpful and smart response.

OUTPUT FORMAT:
If you are suggesting slide updates, return a JSON block at the end of your response like this:
[[CONVERSATION_RESPONSE]]
(Your friendly conversational reply here)
[[UPDATE_SUGGESTIONS]]
[{"original": "placeholder", "replacement": "real value"}]

If no updates are needed, just return your conversational response.
`;

    const response = await model.generateContent(systemPrompt);
    const text = response.response.text();

    // 4. Parse Response
    let aiResponse = text;
    let suggestions: any[] = [];

    if (text.includes("[[UPDATE_SUGGESTIONS]]")) {
      const parts = text.split("[[UPDATE_SUGGESTIONS]]");
      aiResponse = parts[0].replace("[[CONVERSATION_RESPONSE]]", "").trim();
      const suggestionPart = parts[1].trim();
      try {
        const jsonMatch = suggestionPart.match(/\[[\s\S]*\]/);
        suggestions = JSON.parse(jsonMatch ? jsonMatch[0] : suggestionPart);
      } catch (e) {
        console.error("Failed to parse suggestions JSON", e);
      }
    }

    return NextResponse.json({ text: aiResponse, suggestions });

  } catch (err: any) {
    console.error("POST /api/addin/update error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
