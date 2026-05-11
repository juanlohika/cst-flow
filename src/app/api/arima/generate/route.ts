import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getModelForApp, generateWithRetry, readAIConfig } from "@/lib/ai";
import { db } from "@/db";
import {
  skills as skillsTable,
  arimaConversations,
  arimaMessages,
} from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const FALLBACK_INSTRUCTION = `You are ARIMA, an AI Relationship Manager for the CST team at MobileOptima/Tarkie.
Be warm, concise, professional. Always identify yourself as an AI on the first message.
Never invent contract terms, commit to deadlines, or share info about other clients.
Escalate sensitive topics (legal, billing, scope changes, complaints) to a human teammate.`;

function titleFromText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 60) return oneLine;
  return oneLine.slice(0, 57) + "…";
}

async function ensureTables() {
  try {
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaConversation (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      clientProfileId TEXT,
      channel TEXT DEFAULT 'web' NOT NULL,
      title TEXT,
      summary TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      lastMessageAt TEXT DEFAULT (datetime('now')) NOT NULL,
      messageCount INTEGER DEFAULT 0 NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL,
      updatedAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    await db.run(sql`CREATE TABLE IF NOT EXISTS ArimaMessage (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL REFERENCES ArimaConversation(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      tokensIn INTEGER,
      tokensOut INTEGER,
      toolCalls TEXT,
      createdAt TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
  } catch (e) {
    console.warn("[arima] ensureTables warn:", e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    await ensureTables();

    const body = await req.json();
    const { prompt, messages, conversationId: incomingConvId, clientProfileId } = body;

    if (!prompt && (!messages || messages.length === 0)) {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    // ─── Resolve or create conversation ─────────────────────────────────
    let conversationId = incomingConvId as string | undefined;
    const now = new Date().toISOString();
    const lastUserMessage =
      (Array.isArray(messages) && messages.length > 0
        ? messages[messages.length - 1]?.content
        : prompt) || "";

    if (!conversationId) {
      conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      await db.insert(arimaConversations).values({
        id: conversationId,
        userId,
        clientProfileId: clientProfileId || null,
        channel: "web",
        title: titleFromText(lastUserMessage) || "New conversation",
        status: "active",
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Verify ownership; if not the owner, deny
      const existing = await db
        .select({ id: arimaConversations.id, userId: arimaConversations.userId })
        .from(arimaConversations)
        .where(eq(arimaConversations.id, conversationId))
        .limit(1);
      const isAdmin = (session.user as any).role === "admin";
      if (!existing[0] || (existing[0].userId !== userId && !isAdmin)) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
    }

    // ─── Resolve model + skill ──────────────────────────────────────────
    const model = await getModelForApp("arima");
    const aiConfig = await readAIConfig();
    const providerLabel = (model as any)?.__provider || aiConfig.primaryProvider || "unknown";

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

    // ─── Build content for the model ────────────────────────────────────
    let contents: any[] = [];
    if (Array.isArray(messages) && messages.length > 0) {
      contents = messages.map((m: any) => ({
        role: m.role === "model" || m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    } else {
      contents = [{ role: "user", parts: [{ text: prompt }] }];
    }

    // ─── Persist the user message before calling the model ──────────────
    await db.insert(arimaMessages).values({
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      conversationId,
      role: "user",
      content: lastUserMessage,
      createdAt: now,
    });

    // ─── Call the model ─────────────────────────────────────────────────
    const result = await generateWithRetry(model, {
      contents,
      systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
    });
    const replyText = result.response.text();

    // ─── Persist the assistant reply + update conversation aggregate ────
    const replyAt = new Date().toISOString();
    await db.insert(arimaMessages).values({
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
      conversationId,
      role: "assistant",
      content: replyText,
      provider: providerLabel,
      createdAt: replyAt,
    });

    await db
      .update(arimaConversations)
      .set({
        messageCount: sql`COALESCE(${arimaConversations.messageCount}, 0) + 2`,
        lastMessageAt: replyAt,
        updatedAt: replyAt,
      })
      .where(eq(arimaConversations.id, conversationId));

    return NextResponse.json({ content: replyText, conversationId });
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
