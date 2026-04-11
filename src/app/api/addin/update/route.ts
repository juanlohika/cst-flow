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
    const systemPromptText = `You are Tarkie AI — an expert Presentation Strategist embedded directly inside PowerPoint via the Tarkie Team OS add-in.

CRITICAL: You DO have the ability to edit PowerPoint slides. The add-in reads slide content, sends it to you, and then applies your JSON suggestions directly to the file in real-time. When you return [[UPDATE_SUGGESTIONS]] JSON, the add-in immediately writes those changes to the slide. You are the brain — the add-in is the hands. Always provide JSON suggestions when the user asks for edits.

ACCOUNT: ${companyName}
INTELLIGENCE:
${intelligence || "No specific intelligence on file. Rely on the slide content and your general expertise."}

${isBulk
  ? `FULL DECK CONTENT (${allSlides.length} slides):\n${slideContext}`
  : `CURRENT SLIDE CONTENT:\n${slideContext || "(no text content on this slide)"}`
}

RULES:
1. When the user asks to update/change/edit slides — ALWAYS return [[UPDATE_SUGGESTIONS]] with exact text replacements.
2. The "original" field MUST be copied EXACTLY from the slide content — a single cell value, word, or short phrase. The add-in does string.includes() matching — shorter and more exact = better match.
3. One suggestion per individual cell or phrase. Never combine multiple cells/lines into one "original".
4. NEVER touch footer/copyright text (lines with ©, "All rights reserved", long legal text). Only edit main content.
5. NEVER invent data — only use values from Account Intelligence or existing slide content.
6. NEVER say you cannot edit slides — you can, via JSON output.

TABLE RULES (critical):
- Tables are shown as: [TABLE - N columns: ColHeader1, ColHeader2, ColHeader3]
  Row 1 (header): ColHeader1 | ColHeader2 | ColHeader3
  Row 2: value1 | value2 | value3
- The column headers tell you what TYPE of data each cell contains.
- To update a cell, use its EXACT current value as "original" and provide the replacement.
- Only update DATA rows (Row 2+). Never change header row values unless explicitly asked.
- If a cell in a row needs updating, create one suggestion per cell — do NOT combine the whole row.

EXAMPLE — table on slide 4:
[TABLE - 3 columns: ROLE, NAME, CONTACT DETAILS]
Row 1 (header): ROLE | NAME | CONTACT DETAILS
Row 2: Decision Maker | Mr. Hanz Chan | hanzjordanchan@gmail.com
Row 3: HR Officer | Ms. Sonia Briton | hraccutechsteel01@gmail.com

To replace the NAME and CONTACT of Row 2:
{"slideIndex": 4, "original": "Mr. Hanz Chan", "replacement": "Sir Brian"}
{"slideIndex": 4, "original": "hanzjordanchan@gmail.com", "replacement": "brian@solmanpower.com"}
To replace Row 3 NAME only:
{"slideIndex": 4, "original": "Ms. Sonia Briton", "replacement": "Ma'am Mariel"}

OUTPUT FORMAT when making edits:
[[CONVERSATION_RESPONSE]]
Brief explanation of what you changed and why.
[[UPDATE_SUGGESTIONS]]
[
  {"slideIndex": 7, "original": "single line or phrase from slide", "replacement": "new text"}
]

OUTPUT FORMAT when just answering questions (no edits):
Your natural response — no JSON needed.`;

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
    } else {
      // Always strip the tag even when no update suggestions follow
      aiResponse = aiResponse.replace("[[CONVERSATION_RESPONSE]]", "").trim();
    }

    return NextResponse.json({ text: aiResponse, suggestions });

  } catch (err: any) {
    console.error("POST /api/addin/update error:", err);
    return NextResponse.json({ error: err.message || "AI Processing Error" }, { status: 500 });
  }
}
