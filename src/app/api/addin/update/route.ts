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
    const { prompt, clientId, slideContent, allSlides, history, activeSlideIndex } = body;

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
    const model = await getModelForApp("tarkie-ai").catch(async (e) => {
      // If tarkie-ai app row doesn't exist in DB, fall back to global primary provider
      console.warn("[addin/update] getModelForApp failed, using getGeminiModel fallback:", e.message);
      const { getGeminiModel } = await import("@/lib/ai");
      return getGeminiModel();
    });

    // ── 3. Build slide context string ─────────────────────────────────────────
    const isBulk = Array.isArray(allSlides) && allSlides.length > 0;
    const currentSlideNum = activeSlideIndex || 1;
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
  : `CURRENT SLIDE: Slide ${currentSlideNum}\nCONTENT:\n${slideContext || "(no text content on this slide)"}`
}

RULES:
1. When the user asks to update/change/edit slides — ALWAYS return [[UPDATE_SUGGESTIONS]].
2. NEVER touch footer/copyright text (©, "All rights reserved"). Only edit main content.
3. NEVER invent data — only use values from Account Intelligence or existing slide content.
4. NEVER say you cannot edit slides — you can, via JSON output.

TABLE FORMAT (how tables appear in slide content):
Tables are scanned with exact cell coordinates. Format:
[TABLE:0 rows:3 cols:3]
[0,0]="ROLE" [0,1]="NAME" [0,2]="CONTACT DETAILS"
[1,0]="Decision Maker" [1,1]="Mr. Hanz Chan" [1,2]="hanzjordanchan@gmail.com"
[2,0]="HR Officer" [2,1]="Ms. Sonia Briton" [2,2]="hraccutechsteel01@gmail.com"

- [row,col] is 0-based. Row 0 = header row.
- To update a cell, output its exact [row,col] and the new value.
- To ADD a new row, simply use a row index beyond the current rowCount — the add-in will automatically insert the row.
- To ADD a new column, use a col index beyond current columnCount — it will be added automatically.
- To update text shapes (non-table), use "original" + "replacement" as before.

EXAMPLE — update slide 4 table (TABLE:0):
Replace NAME and CONTACT in row 1, add new row 3:
{"slideIndex": 4, "row": 1, "col": 1, "replacement": "Sir Brian"}
{"slideIndex": 4, "row": 1, "col": 2, "replacement": "brian@solmanpower.com"}
{"slideIndex": 4, "row": 2, "col": 1, "replacement": "Ma'am Mariel"}
{"slideIndex": 4, "row": 3, "col": 0, "replacement": "Accounting Officer"}
{"slideIndex": 4, "row": 3, "col": 1, "replacement": "Ma'am Hazel"}
{"slideIndex": 4, "row": 3, "col": 2, "replacement": "hazel@solmanpower.com"}

For text shapes (no table):
{"slideIndex": 4, "original": "Sol Manpower Project Team", "replacement": "New Title"}

OUTPUT FORMAT when making edits:
[[CONVERSATION_RESPONSE]]
Brief explanation of what you changed and why.
[[UPDATE_SUGGESTIONS]]
[
  {"slideIndex": 4, "row": 1, "col": 1, "replacement": "Sir Brian"},
  {"slideIndex": 4, "row": 1, "col": 2, "replacement": "brian@solmanpower.com"}
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

    // Retry up to 3 times on overload (Anthropic 529), with backoff
    let response;
    const delays = [4000, 8000, 15000];
    for (let attempt = 0; ; attempt++) {
      try {
        response = await model.generateContent(inputPayload);
        break;
      } catch (aiErr: any) {
        const isOverloaded =
          aiErr?.status === 529 ||
          aiErr?.message?.toLowerCase().includes("overload") ||
          aiErr?.error?.type === "overloaded_error";
        if (isOverloaded && attempt < delays.length) {
          console.warn(`[addin/update] Claude overloaded, retrying in ${delays[attempt]}ms (attempt ${attempt + 1})`);
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
        throw aiErr;
      }
    }
    const text = response!.response.text();

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
    const isOverloaded =
      err?.status === 529 ||
      err?.message?.toLowerCase().includes("overload") ||
      err?.error?.type === "overloaded_error";
    const userMessage = isOverloaded
      ? "The AI is temporarily overloaded. Please wait a moment and try again."
      : err.message || "AI Processing Error";
    return NextResponse.json({ error: userMessage }, { status: isOverloaded ? 503 : 500 });
  }
}
