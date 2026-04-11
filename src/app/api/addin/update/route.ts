import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getModelForApp } from "@/lib/ai";

/**
 * POST /api/addin/update
 *
 * Single-slide mode:  { prompt, clientId, slideContent: string[], history }
 * All-slides mode:    { prompt, clientId, allSlides: {slideIndex:number, content:string[]}[], history }
 *
 * Returns: { text: string, suggestions: {slideIndex?:number, original:string, replacement:string}[] }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { prompt, clientId, slideContent, allSlides, history } = body;

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    // ── 1. Account Intelligence ───────────────────────────────────────────────
    let intelligence = "";
    let companyName = "General Context";
    if (clientId && typeof clientId === "string" && clientId.trim() !== "") {
      const results = await db.select().from(clientProfiles).where(eq(clientProfiles.id, clientId)).limit(1);
      const client = results[0];
      if (client) {
        intelligence = client.intelligenceContent || "";
        companyName = client.companyName;
      }
    }

    // ── 2. AI Model ───────────────────────────────────────────────────────────
    const model = await getModelForApp("tarkie-ai");

    // ── 3. Build slide context string ─────────────────────────────────────────
    const isBulk = Array.isArray(allSlides) && allSlides.length > 0;
    const slideContext = isBulk
      ? allSlides.map((s: any) => `[Slide ${s.slideIndex}]\n${(s.content || []).join("\n")}`).join("\n\n")
      : (slideContent || []).join("\n");

    // ── 4. System Prompt ──────────────────────────────────────────────────────
    const systemPromptText = `You are Tarkie AI — an expert Presentation Strategist and Business Analyst embedded in PowerPoint via the Tarkie Team OS.
Your job: help the user craft, update, and improve their slides using real client intelligence.
Be conversational, smart, and proactive. Think like a senior consultant who knows the client deeply.

ACCOUNT: ${companyName}
INTELLIGENCE:
${intelligence || "No specific intelligence on file. Rely on the slide content and your general expertise."}

${isBulk
  ? `FULL DECK CONTENT (${allSlides.length} slides):\n${slideContext}`
  : `CURRENT SLIDE CONTENT:\n${slideContext || "(no text content on this slide)"}`
}

INSTRUCTIONS:
1. Read the user's request carefully, in context of the conversation history.
2. If they want updates: identify exact text on the slides and propose precise replacements sourced from the Account Intelligence.
3. If they are just asking questions or chatting: respond helpfully without making up updates.
4. Never invent company data — only use what is in the Account Intelligence or slide content.
5. Be specific: mention slide numbers and quote the text you're changing.

OUTPUT FORMAT when suggesting updates:
[[CONVERSATION_RESPONSE]]
Your natural, helpful reply explaining what you changed and why.
[[UPDATE_SUGGESTIONS]]
[
  {"slideIndex": 1, "original": "exact text to find", "replacement": "new text"},
  {"slideIndex": 3, "original": "another placeholder", "replacement": "real value"}
]

OUTPUT FORMAT when NO updates needed (just conversation):
Your natural response — no JSON block.`;

    // ── 5. Call AI with proper conversation history ───────────────────────────
    const inputPayload = {
      systemInstruction: { parts: [{ text: systemPromptText }] },
      contents: [
        ...(history || []).map((h: any) => ({
          role: h.role === "ai" ? "model" : "user",
          parts: [{ text: h.text }],
        })),
        { role: "user", parts: [{ text: prompt }] },
      ],
    };

    const response = await model.generateContent(inputPayload);
    const text = response.response.text();

    // ── 6. Parse ──────────────────────────────────────────────────────────────
    let aiResponse = text;
    let suggestions: any[] = [];

    if (text.includes("[[UPDATE_SUGGESTIONS]]")) {
      const parts = text.split("[[UPDATE_SUGGESTIONS]]");
      aiResponse = parts[0].replace("[[CONVERSATION_RESPONSE]]", "").trim();
      const suggestionPart = parts[1]?.trim() || "";
      try {
        const jsonMatch = suggestionPart.match(/\[[\s\S]*\]/);
        suggestions = JSON.parse(jsonMatch ? jsonMatch[0] : suggestionPart);
      } catch (e) {
        console.error("[addin/update] Failed to parse suggestions JSON:", e);
      }
    }

    return NextResponse.json({ text: aiResponse, suggestions });

  } catch (err: any) {
    console.error("POST /api/addin/update error:", err);
    return NextResponse.json({ error: err.message || "AI Processing Error" }, { status: 500 });
  }
}
