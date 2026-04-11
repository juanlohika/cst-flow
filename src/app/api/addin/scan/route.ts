import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getClaudeModel } from "@/lib/ai";

/**
 * POST /api/addin/scan
 * Scans the entire deck to provide an "understanding" and suggestions.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { fullContent, clientId } = await req.json();

    let intelligence = "";
    let companyName = "General Context";
    
    if (clientId) {
      const results = await db.select().from(clientProfiles).where(eq(clientProfiles.id, clientId)).limit(1);
      const client = results[0];
      if (client) {
        intelligence = client.intelligenceContent || "";
        companyName = client.companyName;
      }
    }

    const model = await getClaudeModel();

    const systemPrompt = `You are an expert Presentation Strategist. 
The user has just opened their PowerPoint deck and wants an "Initial Scan" to understand what needs work.

ACCOUNT CONTEXT:
Client: ${companyName}
Intelligence: ${intelligence || "No specific intelligence provided."}

DECK CONTENT:
${JSON.stringify(fullContent)}

TASK:
1. Summarize what this deck is about (e.g., "This is a 12-slide Kick-off presentation for Sol Manpower").
2. Identify missing information based on the Client Intelligence (e.g., "I noticed Slide 4 has placeholders for the implementation team, but we have their names in your records").
3. Suggest 3 specific ways you can help right now.
4. Keep the tone friendly, smart, and proactive.

OUTPUT:
Return a conversational response that ends with a question about how to proceed.
`;

    const response = await model.generateContent(systemPrompt);
    const text = response.response.text();

    return NextResponse.json({ text });

  } catch (err: any) {
    console.error("POST /api/addin/scan error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
