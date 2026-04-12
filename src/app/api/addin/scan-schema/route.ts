import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getModelForApp } from "@/lib/ai";

/**
 * POST /api/addin/scan-schema
 *
 * Receives raw slide data (shapes with optional base64 images) from the add-in.
 * Calls AI to:
 *   - Describe each picture shape (context field)
 *   - Infer role, linkedTo, completeness per shape
 *   - Infer slideRole, topic, completeness, issues per slide
 *   - Infer deckRole
 *
 * Body: {
 *   slides: { slideIndex: number, shapes: RawShape[] }[],
 *   clientId?: string
 * }
 *
 * RawShape: { shapeIdx, type, location, bounds, content?, base64?, mimeType? }
 *
 * Returns: { schema: DeckSchema, summary: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { slides, clientId } = body;

    if (!Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json({ error: "Missing slides" }, { status: 400 });
    }

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
      console.warn("[scan-schema] getModelForApp failed, fallback:", e.message);
      const { getGeminiModel } = await import("@/lib/ai");
      return getGeminiModel();
    });

    // ── Build content parts for AI ─────────────────────────────────────────
    // We send all shapes across all slides in one call.
    // Pictures are sent as inlineData; text/table shapes as text description.
    const userParts: any[] = [];

    let slidesSummary = "";
    for (const slide of slides) {
      slidesSummary += `\n--- SLIDE ${slide.slideIndex} ---\n`;
      for (const shape of slide.shapes) {
        slidesSummary += `Shape ${shape.shapeIdx} [${shape.type}] at ${shape.location} bounds:(L${shape.bounds?.left} T${shape.bounds?.top} W${shape.bounds?.width} H${shape.bounds?.height})\n`;
        if (shape.type === "text" || shape.type === "table") {
          slidesSummary += `Content: ${shape.content || "(empty)"}\n`;
        }
        if (shape.type === "picture") {
          slidesSummary += `[IMAGE — see inline data below, label: Slide${slide.slideIndex}_Shape${shape.shapeIdx}]\n`;
        }
      }
    }

    userParts.push({ text: slidesSummary });

    // Attach all picture shapes as inline images
    for (const slide of slides) {
      for (const shape of slide.shapes) {
        if (shape.type === "picture" && shape.base64) {
          userParts.push({
            inlineData: { mimeType: shape.mimeType || "image/png", data: shape.base64 }
          });
        }
      }
    }

    // ── System Prompt ──────────────────────────────────────────────────────
    const systemPrompt = `You are Tarkie AI — a PowerPoint presentation analyst.

ACCOUNT: ${companyName}
INTELLIGENCE:
${intelligence || "No specific intelligence on file."}

Your job: analyze the slide shapes described and return a complete JSON schema for the deck.

SHAPE ROLES:
- "screenshot": a picture of a UI/app screen
- "title": the main heading of a slide
- "body": main content paragraph
- "caption": short text describing or labeling a nearby image
- "placeholder": text that is clearly a template placeholder (e.g. "(add instruction here)", "[Company Name]", "TBD", "Lorem ipsum")
- "decoration": purely visual element with no content value
- "data": a table or data-heavy text block
- "unknown": cannot determine

SLIDE ROLES: "step" | "cover" | "summary" | "data" | "blank" | "mixed"
COMPLETENESS: "complete" | "needs-instruction" | "needs-image" | "needs-data" | "empty"
DECK ROLES: "step-by-step guide" | "proposal" | "report" | "mixed"

LINKING RULES:
- A screenshot (picture) and a nearby caption/body text box are "linkedTo" each other
- "Nearby" means: within ~150pts of each other, or clearly aligned (same row/column area)
- Use shapeIdx values for linkedTo arrays

INSTRUCTIONS:
1. For each picture shape, write a 1-sentence "context" describing what the image shows (based on the inline image data)
2. For each text shape, set role based on content
3. For each slide, set slideRole, topic (1 short phrase), completeness, and issues (array of strings describing what's missing or wrong)
4. Set deckRole based on overall pattern
5. Count readySlides (slides with completeness === "complete")

OUTPUT: Return ONLY valid JSON in this exact structure, no markdown, no explanation:
{
  "scannedAt": "ISO timestamp",
  "deckRole": "...",
  "totalSlides": N,
  "readySlides": N,
  "slides": [
    {
      "slideIndex": 1,
      "slideRole": "...",
      "topic": "...",
      "completeness": "...",
      "issues": ["..."],
      "shapes": [
        {
          "shapeIdx": 0,
          "type": "picture|text|table|other",
          "role": "...",
          "context": "...",
          "location": "...",
          "bounds": { "left": 0, "top": 0, "width": 0, "height": 0 },
          "linkedTo": [],
          "content": "..."
        }
      ]
    }
  ],
  "summary": "2-3 sentence plain-English summary of the deck for the user"
}`;

    const inputPayload = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: userParts }],
    };

    // Retry on overload
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
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
        throw aiErr;
      }
    }

    const rawText = response!.response.text().trim();

    // Strip markdown code fences if AI wrapped the JSON
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error("[scan-schema] Failed to parse AI JSON:", e, "\nRaw:", rawText.slice(0, 500));
      return NextResponse.json({ error: "AI returned invalid schema JSON" }, { status: 500 });
    }

    // Strip base64 from schema before storing (not needed after AI processed them)
    for (const slide of (parsed.slides || [])) {
      for (const shape of (slide.shapes || [])) {
        delete shape.base64;
        delete shape.mimeType;
      }
    }

    const summary = parsed.summary || `Scanned ${slides.length} slides. Deck type: ${parsed.deckRole || "unknown"}.`;
    delete parsed.summary; // keep schema clean

    return NextResponse.json({ schema: parsed, summary });

  } catch (err: any) {
    console.error("[scan-schema] Error:", err);
    return NextResponse.json({ error: err.message || "Server error" }, { status: 500 });
  }
}
