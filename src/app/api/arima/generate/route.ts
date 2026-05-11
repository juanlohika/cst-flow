import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getModelForApp, generateWithRetry, readAIConfig } from "@/lib/ai";
import { db } from "@/db";
import {
  skills as skillsTable,
  arimaConversations,
  arimaMessages,
  arimaRequests,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { canAccessClient } from "@/lib/access/accounts";

interface ParsedRequest {
  title: string;
  description: string;
  category: string;
  priority: string;
}

const REQUEST_REGEX = /\[REQUEST\]([\s\S]*?)\[\/REQUEST\]/i;

function parseRequestBlock(text: string): { cleanText: string; request: ParsedRequest | null } {
  const match = text.match(REQUEST_REGEX);
  if (!match) return { cleanText: text, request: null };

  const inside = match[1];
  const grab = (key: string) => {
    const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "im");
    const m = inside.match(re);
    return m ? m[1].trim() : "";
  };

  const title = grab("title");
  const description = grab("description");
  const categoryRaw = (grab("category") || "other").toLowerCase();
  const priorityRaw = (grab("priority") || "medium").toLowerCase();

  const validCategories = ["feature", "bug", "question", "config", "meeting", "other"];
  const validPriorities = ["low", "medium", "high", "urgent"];
  const category = validCategories.includes(categoryRaw) ? categoryRaw : "other";
  const priority = validPriorities.includes(priorityRaw) ? priorityRaw : "medium";

  // Strip the [REQUEST] block from the visible reply
  const cleanText = text.replace(REQUEST_REGEX, "").replace(/```\s*```/g, "").trim();

  if (!title) return { cleanText, request: null };
  return { cleanText, request: { title, description, category, priority } };
}

function buildClientContext(profile: any): string {
  if (!profile) return "";
  const modules = (() => {
    try {
      const arr = JSON.parse(profile.modulesAvailed || "[]");
      return Array.isArray(arr) && arr.length > 0 ? arr.join(", ") : "(none specified)";
    } catch {
      return profile.modulesAvailed || "(none specified)";
    }
  })();

  const lines: string[] = [];
  lines.push("## CURRENT CLIENT CONTEXT");
  lines.push("");
  lines.push(`You are talking ABOUT or ON BEHALF OF the following client account. Use this context to ground every reply. Do not invent fields that are not present.`);
  lines.push("");
  lines.push(`- **Company:** ${profile.companyName || "Unknown"}`);
  lines.push(`- **Industry:** ${profile.industry || "Unknown"}`);
  if (profile.companySize) lines.push(`- **Company size:** ${profile.companySize}`);
  lines.push(`- **Modules contracted:** ${modules}`);
  lines.push(`- **Engagement status:** ${profile.engagementStatus || "unknown"}`);
  if (profile.primaryContact) lines.push(`- **Primary contact:** ${profile.primaryContact}${profile.primaryContactEmail ? ` (${profile.primaryContactEmail})` : ""}`);
  if (profile.specialConsiderations) {
    lines.push("");
    lines.push(`**Special considerations:** ${profile.specialConsiderations}`);
  }
  if (profile.intelligenceContent) {
    lines.push("");
    lines.push("### Account intelligence");
    lines.push(profile.intelligenceContent.length > 4000
      ? profile.intelligenceContent.slice(0, 4000) + "\n\n[…truncated]"
      : profile.intelligenceContent);
  }
  lines.push("");
  lines.push("Reference these facts naturally when helpful. Never share information about other clients.");
  return lines.join("\n");
}

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

    const isAdmin = (session.user as any).role === "admin";

    // ─── ACCESS GATE: if a clientProfileId was passed, the caller must have access ──
    if (clientProfileId) {
      const allowed = await canAccessClient({ userId, isAdmin }, clientProfileId);
      if (!allowed) {
        return NextResponse.json(
          { error: "You do not have access to this account. Ask an admin to grant you access." },
          { status: 403 }
        );
      }
    }

    // ─── Resolve or create conversation ─────────────────────────────────
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
      // Verify ownership; if not the owner, deny
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
      // If the conversation has a clientProfileId, the user must STILL have access
      // (otherwise their access may have been revoked since the chat started).
      if (existing[0].clientProfileId) {
        const stillAllowed = await canAccessClient({ userId, isAdmin }, existing[0].clientProfileId);
        if (!stillAllowed) {
          return NextResponse.json(
            { error: "Your access to this account has been revoked." },
            { status: 403 }
          );
        }
      }
      // If the user picked a new client mid-conversation, update it; otherwise keep existing
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

    // ─── Load the linked client profile (if any) ────────────────────────
    let clientProfile: any = null;
    if (activeClientProfileId) {
      try {
        const rows = await db
          .select()
          .from(clientProfilesTable)
          .where(eq(clientProfilesTable.id, activeClientProfileId))
          .limit(1);
        clientProfile = rows[0] || null;
      } catch (e) {
        console.warn("[arima] client profile lookup failed:", e);
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
    const baseInstruction = arimaSkill || FALLBACK_INSTRUCTION;
    const clientContext = buildClientContext(clientProfile);
    const systemInstruction = clientContext
      ? `${baseInstruction}\n\n---\n\n${clientContext}`
      : baseInstruction;

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
    const rawReply = result.response.text();

    // ─── Parse out any [REQUEST]…[/REQUEST] block ───────────────────────
    const { cleanText: replyText, request: parsedRequest } = parseRequestBlock(rawReply);

    // ─── Persist the assistant reply + update conversation aggregate ────
    const replyAt = new Date().toISOString();
    const assistantMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(arimaMessages).values({
      id: assistantMsgId,
      conversationId,
      role: "assistant",
      content: replyText, // store the CLEAN reply (without [REQUEST] block) so it shows the same way in transcripts
      provider: providerLabel,
      createdAt: replyAt,
    });

    // ─── If ARIMA captured a request, persist it ────────────────────────
    let createdRequestId: string | null = null;
    if (parsedRequest) {
      try {
        createdRequestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
        await db.insert(arimaRequests).values({
          id: createdRequestId,
          conversationId,
          sourceMessageId: assistantMsgId,
          userId,
          clientProfileId: activeClientProfileId,
          title: parsedRequest.title.slice(0, 200),
          description: parsedRequest.description || null,
          category: parsedRequest.category,
          priority: parsedRequest.priority,
          status: "new",
          createdAt: replyAt,
          updatedAt: replyAt,
        });
      } catch (reqErr) {
        console.warn("[arima] failed to insert captured request:", reqErr);
        createdRequestId = null;
      }
    }

    await db
      .update(arimaConversations)
      .set({
        messageCount: sql`COALESCE(${arimaConversations.messageCount}, 0) + 2`,
        lastMessageAt: replyAt,
        updatedAt: replyAt,
      })
      .where(eq(arimaConversations.id, conversationId));

    return NextResponse.json({
      content: replyText,
      conversationId,
      capturedRequest: createdRequestId
        ? { id: createdRequestId, title: parsedRequest!.title, category: parsedRequest!.category, priority: parsedRequest!.priority }
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
