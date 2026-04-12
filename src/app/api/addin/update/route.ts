import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getModelForApp } from "@/lib/ai";

/**
 * POST /api/addin/update
 *
 * Receives a slide schema (from scan-schema) + user prompt + account intelligence.
 * Returns AI response + update suggestions targeting shapes by shapeIdx.
 *
 * Body: {
 *   prompt: string,
 *   clientId?: string,
 *   slideSchema: SlideSchema,      ← preferred: schema from scan-schema
 *   slideContent?: string[],       ← legacy fallback (raw text array)
 *   history?: { role: string, text: string }[],
 *   activeSlideIndex?: number,
 * }
 *
 * Returns: { text: string, suggestions: UpdateSuggestion[] }
 *
 * UpdateSuggestion (table cell):  { slideIndex, shapeIdx, row, col, replacement }
 * UpdateSuggestion (text shape):  { slideIndex, shapeIdx, replacement }
 * UpdateSuggestion (legacy):      { slideIndex, original, replacement }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { prompt, clientId, slideSchema, slideContent, history, activeSlideIndex } = body;

    if (!prompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });

    // ── Account Intelligence ───────────────────────────────────────────────
    let intelligence = "";
    let companyName = "General Context";
    if (clientId && typeof clientId === "string" && clientId.trim() !== "") {
      const results = await db.select().from(clientProfiles).where(eq(clientProfiles.id, clientId)).limit(1);
      const client = results[0];
      if (client) { intelligence = client.intelligenceContent || ""; companyName = client.companyName; }
    }

    // ── AI Model ───────────────────────────────────────────────────────────
    const model = await getModelForApp("tarkie-ai").catch(async (e) => {
      console.warn("[addin/update] getModelForApp failed, fallback:", e.message);
      const { getGeminiModel } = await import("@/lib/ai");
      return getGeminiModel();
    });

    // ── Build slide context string from schema or legacy ───────────────────
    let slideContextStr = "";
    const currentSlideNum = activeSlideIndex || 1;

    if (slideSchema) {
      // Schema-based context — rich format
      slideContextStr = buildSchemaContext(slideSchema);
    } else if (Array.isArray(slideContent) && slideContent.length > 0) {
      // Legacy fallback — raw text array
      slideContextStr = slideContent.join("\n");
    }

    // ── System Prompt ──────────────────────────────────────────────────────
    const systemPromptText = `You are Tarkie AI — an expert Presentation Strategist embedded inside PowerPoint via the Tarkie Team OS add-in.

CRITICAL: You CAN edit PowerPoint slides. When you return [[UPDATE_SUGGESTIONS]] JSON, the add-in immediately writes those changes to the slide. Always provide JSON suggestions when the user asks for edits.

ACCOUNT: ${companyName}
INTELLIGENCE:
${intelligence || "No specific intelligence on file. Rely on the slide content and your general expertise."}

CURRENT SLIDE: Slide ${currentSlideNum}
${slideContextStr || "(no content on this slide)"}

SHAPE TARGETING (use shapeIdx when available — more reliable than text search):
- Text shape:  { "slideIndex": N, "shapeIdx": 2, "replacement": "New text" }
- Table cell:  { "slideIndex": N, "shapeIdx": 0, "row": 1, "col": 2, "replacement": "Value" }
- Legacy text search (only if shapeIdx unknown): { "slideIndex": N, "original": "old text", "replacement": "new text" }

TABLE FORMAT (when schema shows table content):
Tables use [row,col] 0-based coordinates. Row 0 = header.
To ADD a new row, use a row index beyond current rowCount — add-in inserts it automatically.
To ADD a new column, use a col index beyond current columnCount.

PLACEHOLDER SHAPES:
Shapes with role "placeholder" are templates waiting to be filled in.
When updating, replace placeholder content with real data from Account Intelligence.

RULES:
1. When user asks to update/change/edit slides — ALWAYS return [[UPDATE_SUGGESTIONS]].
2. NEVER touch footer/copyright text (©, "All rights reserved"). Only edit main content.
3. NEVER invent data — only use values from Account Intelligence or existing slide content.
4. NEVER say you cannot edit slides.
5. Target shapes by shapeIdx whenever the schema provides it — do NOT use "original" text search for shapes that have a known shapeIdx.

OUTPUT FORMAT when making edits:
[[CONVERSATION_RESPONSE]]
Brief explanation of what you changed and why.
[[UPDATE_SUGGESTIONS]]
[
  { "slideIndex": 3, "shapeIdx": 1, "replacement": "Step 1: Tap the Add button on the home screen" },
  { "slideIndex": 3, "shapeIdx": 0, "row": 1, "col": 1, "replacement": "Sir Brian" }
]

OUTPUT FORMAT when just answering questions (no edits):
Your natural response — no JSON needed.`;

    // ── Call AI ────────────────────────────────────────────────────────────
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

    // Retry up to 3 times on overload
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
          console.warn(`[addin/update] Overloaded, retrying in ${delays[attempt]}ms`);
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
        throw aiErr;
      }
    }

    const text = response!.response.text();

    // ── Parse response ─────────────────────────────────────────────────────
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

// ── Build a readable context string from a SlideSchema ────────────────────────
function buildSchemaContext(slideSchema: any): string {
  if (!slideSchema) return "";
  const lines: string[] = [];

  if (slideSchema.topic) lines.push(`Topic: ${slideSchema.topic}`);
  if (slideSchema.slideRole) lines.push(`Slide type: ${slideSchema.slideRole}`);
  if (slideSchema.completeness) lines.push(`Status: ${slideSchema.completeness}`);
  if (slideSchema.issues?.length > 0) lines.push(`Issues: ${slideSchema.issues.join("; ")}`);

  lines.push("");
  lines.push("SHAPES:");

  for (const shape of (slideSchema.shapes || [])) {
    let line = `[Shape ${shape.shapeIdx}] type:${shape.type} role:${shape.role} location:${shape.location}`;
    if (shape.context) line += `\n  context: "${shape.context}"`;
    if (shape.content) line += `\n  content: ${shape.content}`;
    if (shape.linkedTo?.length > 0) line += `\n  linkedTo: shapes [${shape.linkedTo.join(", ")}]`;
    lines.push(line);
  }

  return lines.join("\n");
}
