import { NextResponse } from "next/server";
import { db } from "@/db";
import { arimaConversations, arimaMessages, clientContacts } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { getPortalSession } from "@/lib/portal/auth";
import { runArima } from "@/lib/arima/runtime";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/chat → return the conversation history for this subscriber
 * POST /api/portal/chat → send a new message; ARIMA replies, scoped to the client
 *
 * Auth: portal session cookie, NOT NextAuth.
 * Client scoping is automatic — the subscriber's clientProfileId is derived from
 * their ClientContact record, so they CANNOT change it.
 */

async function findOrCreateConversation(args: {
  contactId: string;
  clientProfileId: string;
}): Promise<string> {
  const externalKey = `portal:${args.contactId}`;
  const existing = await db
    .select({ id: arimaConversations.id })
    .from(arimaConversations)
    .where(and(
      eq(arimaConversations.channel, "portal"),
      eq(arimaConversations.title, externalKey)
    ))
    .limit(1);

  if (existing[0]) return existing[0].id;

  const convId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  await db.insert(arimaConversations).values({
    id: convId,
    userId: args.contactId, // portal contacts are "the user" for this conversation
    clientProfileId: args.clientProfileId,
    channel: "portal",
    title: externalKey,
    status: "active",
    messageCount: 0,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return convId;
}

export async function GET() {
  try {
    await ensureAccessSchema();
    const portal = await getPortalSession();
    if (!portal) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const conversationId = await findOrCreateConversation({
      contactId: portal.contactId,
      clientProfileId: portal.clientProfileId,
    });

    const msgs = await db
      .select({
        id: arimaMessages.id,
        role: arimaMessages.role,
        content: arimaMessages.content,
        createdAt: arimaMessages.createdAt,
      })
      .from(arimaMessages)
      .where(eq(arimaMessages.conversationId, conversationId))
      .orderBy(asc(arimaMessages.createdAt));

    return NextResponse.json({
      session: portal,
      conversationId,
      messages: msgs,
    });
  } catch (error: any) {
    console.error("[portal/chat GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureAccessSchema();
    const portal = await getPortalSession();
    if (!portal) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const userMessage = (body?.message || "").trim();
    if (!userMessage) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    const conversationId = await findOrCreateConversation({
      contactId: portal.contactId,
      clientProfileId: portal.clientProfileId,
    });

    // Pull prior history (last 12 turns for context)
    const history = await db
      .select({ role: arimaMessages.role, content: arimaMessages.content })
      .from(arimaMessages)
      .where(eq(arimaMessages.conversationId, conversationId))
      .orderBy(asc(arimaMessages.createdAt));
    const priorContents = history.slice(-12).map(m => ({
      role: m.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: m.content }],
    }));

    // Prefix with contact name so ARIMA knows who's writing
    const inlineMessage = `[${portal.contactName}]: ${userMessage}`;

    const result = await runArima({
      conversationId,
      userId: portal.contactId,
      clientProfileId: portal.clientProfileId,
      userMessage: inlineMessage,
      priorContents,
    });

    // Refresh contact lastSeenAt
    await db.update(clientContacts)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(clientContacts.id, portal.contactId))
      .catch(() => {});

    return NextResponse.json({
      content: result.replyText,
      conversationId,
      capturedRequest: result.capturedRequestId
        ? { id: result.capturedRequestId, title: result.capturedRequest!.title }
        : null,
    });
  } catch (error: any) {
    console.error("[portal/chat POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
