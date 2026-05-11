import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaConversations, arimaMessages } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { canAccessClient } from "@/lib/access/accounts";
import { runArima } from "@/lib/arima/runtime";

export const dynamic = "force-dynamic";

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
    const isAdmin = (session.user as any).role === "admin";

    await ensureTables();

    const body = await req.json();
    const { prompt, messages, conversationId: incomingConvId, clientProfileId } = body;

    if (!prompt && (!messages || messages.length === 0)) {
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });
    }

    // Access gate
    if (clientProfileId) {
      const allowed = await canAccessClient({ userId, isAdmin }, clientProfileId);
      if (!allowed) {
        return NextResponse.json(
          { error: "You do not have access to this account. Ask an admin to grant you access." },
          { status: 403 }
        );
      }
    }

    // Resolve or create conversation
    let conversationId = incomingConvId as string | undefined;
    let activeClientProfileId: string | null = clientProfileId || null;
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
        clientProfileId: activeClientProfileId,
        channel: "web",
        title: titleFromText(lastUserMessage) || "New conversation",
        status: "active",
        messageCount: 0,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const existing = await db
        .select({
          id: arimaConversations.id,
          userId: arimaConversations.userId,
          clientProfileId: arimaConversations.clientProfileId,
        })
        .from(arimaConversations)
        .where(eq(arimaConversations.id, conversationId))
        .limit(1);
      if (!existing[0] || (existing[0].userId !== userId && !isAdmin)) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
      if (existing[0].clientProfileId) {
        const stillAllowed = await canAccessClient({ userId, isAdmin }, existing[0].clientProfileId);
        if (!stillAllowed) {
          return NextResponse.json(
            { error: "Your access to this account has been revoked." },
            { status: 403 }
          );
        }
      }
      if (clientProfileId !== undefined && clientProfileId !== existing[0].clientProfileId) {
        await db
          .update(arimaConversations)
          .set({ clientProfileId: clientProfileId || null, updatedAt: now })
          .where(eq(arimaConversations.id, conversationId));
        activeClientProfileId = clientProfileId || null;
      } else {
        activeClientProfileId = existing[0].clientProfileId || null;
      }
    }

    // Prior history (all messages EXCEPT the new one we're about to add)
    const priorContents = (Array.isArray(messages) ? messages.slice(0, -1) : []).map((m: any) => ({
      role: m.role === "model" || m.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: m.content }],
    }));

    // Run the shared ARIMA loop (persists, calls model, parses requests, persists reply)
    const result = await runArima({
      conversationId,
      userId,
      clientProfileId: activeClientProfileId,
      userMessage: lastUserMessage,
      priorContents,
    });

    return NextResponse.json({
      content: result.replyText,
      conversationId,
      capturedRequest: result.capturedRequestId
        ? {
            id: result.capturedRequestId,
            title: result.capturedRequest!.title,
            category: result.capturedRequest!.category,
            priority: result.capturedRequest!.priority,
          }
        : null,
    });
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
