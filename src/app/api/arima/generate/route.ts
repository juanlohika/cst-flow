import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getModelForApp, generateWithRetry } from "@/lib/ai";
import { db } from "@/db";
import { skills as skillsTable } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const FALLBACK_INSTRUCTION = `You are ARIMA, an AI Relationship Manager for the CST team at MobileOptima/Tarkie.
Be warm, concise, professional. Always identify yourself as an AI on the first message.
Never invent contract terms, commit to deadlines, or share info about other clients.
Escalate sensitive topics (legal, billing, scope changes, complaints) to a human teammate.`;

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt, messages } = await req.json();
    if (!prompt && (!messages || messages.length === 0)) {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    // Resolve the model for ARIMA (provider configured in App Builder; defaults to global primary)
    const model = await getModelForApp("arima");

    // Pull active skills for category "arima" and concatenate them
    let arimaSkill = "";
    try {
      const skills = await db
        .select()
        .from(skillsTable)
        .where(and(eq(skillsTable.category, "arima"), eq(skillsTable.isActive, true)))
        .orderBy(desc(skillsTable.updatedAt));
      if (skills.length > 0) {
        arimaSkill = skills.map(s => s.content).join("\n\n---\n\n");
      }
    } catch (err) {
      console.error("[arima] skill fetch failed:", err);
    }

    const systemInstruction = arimaSkill || FALLBACK_INSTRUCTION;

    // Build conversation content in Gemini-compatible format (Claude adapter also handles this)
    let contents: any[] = [];
    if (Array.isArray(messages) && messages.length > 0) {
      contents = messages.map((m: any) => ({
        role: m.role === "model" || m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    } else {
      contents = [{ role: "user", parts: [{ text: prompt }] }];
    }

    const result = await generateWithRetry(model, {
      contents,
      systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    });

    return NextResponse.json({ content: result.response.text() });
  } catch (error: any) {
    console.error("[arima] generation error:", error);
    const isOverloaded =
      error?.status === 503 ||
      (typeof error?.message === "string" && error.message.toLowerCase().includes("overload"));
    return NextResponse.json(
      { error: error.message || "ARIMA failed to respond" },
      { status: isOverloaded ? 503 : 500 }
    );
  }
}
