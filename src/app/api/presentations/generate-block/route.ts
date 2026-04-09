import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGeminiModel } from "@/lib/ai";

/**
 * POST /api/presentations/generate-block
 * AI-powered block content generation using design skill + account intelligence + user prompt
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { blockType, prompt, images, designSkill, accountIntelligence, slideBackground } = body;

    if (!blockType || !prompt) {
      return NextResponse.json({ error: "blockType and prompt are required" }, { status: 400 });
    }

    const model = await getGeminiModel();

    // Build the system context
    const systemPrompt = `You are a content generator for Tarkie's Presentation Builder.

=== DESIGN RULES ===
${designSkill || "Use professional presentation design standards."}

Output must comply with all design rules above.
Return ONLY valid JSON matching the block schema below. No markdown, no preamble.
Highlight key terms per the design rules.
Max 6 bullets per list. Max 8 rows per table.
Tone: professional, concise, tech-forward.

=== ACCOUNT INTELLIGENCE ===
${accountIntelligence || "No account intelligence available. Generate generic professional content."}

=== BLOCK TYPE: ${blockType} ===

=== OUTPUT SCHEMA ===
${getBlockSchema(blockType)}

=== SLIDE BACKGROUND ===
${slideBackground || "light"}

=== USER PROMPT ===
${prompt}

CRITICAL: Return ONLY the JSON object. No explanation, no markdown fences.`;

    // Process base64 images into Gemini InlineData format
    const promptParts: any[] = [systemPrompt];
    
    if (images && images.length > 0) {
      for (const base64Str of images) {
        // e.g. "data:image/png;base64,iVBORw0KGgo..."
        const match = base64Str.match(/^data:(image\/[a-z]+);base64,(.*)$/);
        if (match) {
          promptParts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      }
    }

    const result = await model.generateContent(promptParts);
    const responseText = result.response.text();

    // Parse the JSON from the response
    let content: any;
    try {
      // Try to extract JSON from the response (handle markdown fences)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = JSON.parse(jsonMatch[0]);
      } else {
        content = { body: responseText };
      }
    } catch {
      content = { body: responseText };
    }

    return NextResponse.json({ content: JSON.stringify(content), blockType });
  } catch (err: any) {
    console.error("POST /api/presentations/generate-block error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function getBlockSchema(blockType: string): string {
  switch (blockType) {
    case "text":
      return `{ "heading": "string", "body": "string", "subtitle": "string (optional)" }`;
    case "bullet-list":
      return `{ "items": ["string item 1", "string item 2", ...] }`;
    case "table":
      return `{ "columns": ["COL1", "COL2", ...], "rows": [["cell1", "cell2", ...], ...] }`;
    case "phase-card":
      return `{ "phases": [{ "label": "PHASE 1", "title": "Phase Title", "items": ["item1", "item2"] }] }`;
    case "sparkle-row":
      return `{ "rows": [{ "letter": "S", "label": "Label", "description": "Description" }, ...] }`;
    default:
      return `{ "body": "string content" }`;
  }
}
