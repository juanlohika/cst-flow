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
    const systemPrompt = `You are a high-fidelity Design Architect for Tarkie's Presentation Builder.
Your task is to populate a ${blockType} block using only the data provided.

=== DESIGN RULES (STRICKLY MANDATORY) ===
${designSkill || "Use professional presentation design standards."}

=== ACCOUNT INTELLIGENCE (PRIMARY SOURCE) ===
${accountIntelligence || "No account intelligence available. STOP. Do not hallucinate. Use generic Tarkie placeholders."}

=== BLOCK TYPE: ${blockType} ===

=== OUTPUT FORMAT ===
- Return ONLY valid JSON matching the schema below.
- Do NOT add markdown, preamble, or explanations.
- If Account Intelligence is provided, EXCLUSIVELY use that data to fill the content.
- For Sparkle rows, keep the labels exactly as defined in the schema.

=== SCHEMA ===
${getBlockSchema(blockType)}

=== USER CONTEXT/PROMPT ===
${prompt}`;

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
      return `{ 
        "rows": [
          { "letter": "S", "label": "Single Source of Truth", "description": "Criteria/Observations" },
          { "letter": "P", "label": "Phased Implementation", "description": "Criteria/Observations" },
          { "letter": "A", "label": "Auditors and Follow-Through", "description": "Criteria/Observations" },
          { "letter": "R", "label": "Robust Data Migration", "description": "Criteria/Observations" },
          { "letter": "K", "label": "KPIs to Track Success", "description": "Criteria/Observations" },
          { "letter": "L", "label": "Leadership Commitment", "description": "Criteria/Observations" },
          { "letter": "E", "label": "Easier than Before", "description": "Criteria/Observations" }
        ] 
      }`;
    default:
      return `{ "body": "string content" }`;
  }
}
