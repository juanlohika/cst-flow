import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getModelForApp } from "@/lib/ai";

/**
 * POST /api/addin/scan
 * Scans the entire deck to provide an "understanding" and suggestions.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { fullContent, clientId } = body;

    if (!fullContent || !Array.isArray(fullContent)) {
       return NextResponse.json({ error: "Missing or invalid deck content" }, { status: 400 });
    }

    console.log(`[SCAN] Received deck scan request. Slides: ${fullContent.length}, Payload Size: ${JSON.stringify(fullContent).length} chars`);

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

    const model = await getModelForApp("tarkie-ai");

    // Format deck content as readable text
    const deckText = fullContent.map((slide: any) => {
      const lines: string[] = Array.isArray(slide.content) ? slide.content : [];
      return `[Slide ${slide.slideIndex}]\n${lines.length > 0 ? lines.join("\n") : "(no text content)"}`;
    }).join("\n\n");

    const totalWithText = fullContent.filter((s: any) => Array.isArray(s.content) && s.content.length > 0).length;

    const systemPrompt = `You are Tarkie AI — an expert Presentation Strategist embedded in PowerPoint via the Tarkie Team OS.
The user just opened their deck for an initial scan. Be smart, specific, and conversational.

ACCOUNT: ${companyName}
INTELLIGENCE:
${intelligence || "No specific intelligence on file."}

DECK: ${fullContent.length} slides total, ${totalWithText} slides with readable text content.

SLIDE CONTENT:
${deckText}

IMPORTANT: Only describe what you can actually read above. If a slide shows "(no text content)" it may contain only images or graphics — acknowledge this honestly rather than guessing.

TASK:
1. Tell the user what this deck is about based on the text you can read — be specific (mention slide numbers, actual text you see).
2. If the Account Intelligence has relevant details not yet in the deck, call out specifically where they could be added (e.g. "Slide 5 has a placeholder that could use Sol Manpower's actual team names from your account profile").
3. Suggest 3 concrete things you can do right now to improve this deck.
4. End with a question asking how they'd like to proceed.

Keep the tone sharp, warm, and consultant-like. No markdown headers — write like you're talking to a colleague.`;

    const response = await model.generateContent(systemPrompt);
    const text = response.response.text();

    const response = await model.generateContent(systemPrompt);
    const text = response.response.text();

    return NextResponse.json({ text });

  } catch (err: any) {
    console.error("POST /api/addin/scan error:", err);
    // Return detailed error for debugging
    const errorMsg = err.message || "Unknown error";
    const errorStack = process.env.NODE_ENV === "development" ? err.stack : undefined;
    
    return NextResponse.json({ 
      error: `Server Scan Error: ${errorMsg}`,
      details: errorStack
    }, { status: 500 });
  }
}
