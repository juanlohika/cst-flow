import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getModelForApp } from "@/lib/ai";

/**
 * POST /api/addin/update
 * Analyzes slide content vs account intelligence using Claude
 * and returns suggested text replacements.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { prompt, clientId, slideContent, applyToAll, history } = body;

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    let intelligence = "";
    let companyName = "General Context";
    
    // 1. Fetch Account Intelligence if a client is selected
    if (clientId && typeof clientId === "string" && clientId.trim() !== "") {
      const results = await db.select().from(clientProfiles).where(eq(clientProfiles.id, clientId)).limit(1);
      const client = results[0];
      if (client) {
        intelligence = client.intelligenceContent || "";
        companyName = client.companyName;
      }
    }

    // 2. Initialize AI Model
    const model = await getModelForApp("tarkie-ai");

    // 3. Construct System Prompt + conversational messages
    const systemPromptText = `You are an expert Presentation Assistant and Business Analyst, part of the Tarkie Team OS ecosystem.
Your goal is to help users update their PowerPoint slides with accuracy and intelligence. Use a professional, helpful, and conversational tone.

CONTEXT:
Selected Account: ${companyName}
Account Intelligence (Markdown):
${intelligence || "No specific intelligence provided. Use general knowledge and the current slide content to assist."}

CURRENT SLIDE CONTENT:
${JSON.stringify(slideContent || [])}

TASK:
1. Analyze the USER MESSAGE in the context of the conversation and the current slide content.
2. If the user asks to update or fill in data, identify the relevant text on the slide and suggest replacements using the Account Intelligence.
3. If the user is just chatting or asking for advice, provide a helpful and smart response.
4. Always maintain context from the conversation history — refer back to earlier messages when relevant.

OUTPUT FORMAT:
If you are suggesting slide updates, return your response in this exact format:
[[CONVERSATION_RESPONSE]]
(Your friendly conversational reply here)
[[UPDATE_SUGGESTIONS]]
[{"original": "exact text to replace", "replacement": "new text value"}]

If no slide updates are needed, just return your conversational response without the [[UPDATE_SUGGESTIONS]] block.`;

    // Pass history as proper conversation turns (Gemini-compatible format that buildClaudeAdapter maps to messages[])
    const inputPayload = {
      systemInstruction: {
        parts: [{ text: systemPromptText }]
      },
      contents: [
        ...(history || []).map((h: any) => ({
          role: h.role === "ai" ? "model" : "user",
          parts: [{ text: h.text }]
        })),
        { role: "user", parts: [{ text: prompt }] }
      ]
    };

    const response = await model.generateContent(inputPayload);
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
    const errorMsg = err.message || "Unknown error";
    
    return NextResponse.json({ 
      error: `AI Processing Error: ${errorMsg}` 
    }, { status: 500 });
  }
}
