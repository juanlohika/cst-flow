import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  arimaConversations,
  arimaMessages,
  users as usersTable,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { eq, asc, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function loadAndAuthorize(id: string, userId: string, isAdmin: boolean) {
  const rows = await db
    .select({
      id: arimaConversations.id,
      userId: arimaConversations.userId,
      clientProfileId: arimaConversations.clientProfileId,
      channel: arimaConversations.channel,
      title: arimaConversations.title,
      status: arimaConversations.status,
      messageCount: arimaConversations.messageCount,
      lastMessageAt: arimaConversations.lastMessageAt,
      createdAt: arimaConversations.createdAt,
      ownerName: usersTable.name,
      ownerEmail: usersTable.email,
      clientName: clientProfilesTable.companyName,
    })
    .from(arimaConversations)
    .leftJoin(usersTable, eq(usersTable.id, arimaConversations.userId))
    .leftJoin(clientProfilesTable, eq(clientProfilesTable.id, arimaConversations.clientProfileId))
    .where(eq(arimaConversations.id, id))
    .limit(1);

  const conv = rows[0];
  if (!conv) return { error: { status: 404, message: "Not found" } } as const;
  if (conv.userId !== userId && !isAdmin) {
    return { error: { status: 403, message: "Forbidden" } } as const;
  }
  return { conv } as const;
}

/** GET /api/arima/conversations/[id]  → conversation + its messages */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";

    const result = await loadAndAuthorize(params.id, userId, isAdmin);
    if ("error" in result) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }

    const msgs = await db
      .select()
      .from(arimaMessages)
      .where(eq(arimaMessages.conversationId, params.id))
      .orderBy(asc(arimaMessages.createdAt));

    return NextResponse.json({ conversation: result.conv, messages: msgs });
  } catch (error: any) {
    console.error("[arima/conversations GET id] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** PATCH /api/arima/conversations/[id]  → update title, status, clientProfileId */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";

    const result = await loadAndAuthorize(params.id, userId, isAdmin);
    if ("error" in result) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }

    const body = await req.json();
    const updateData: any = { updatedAt: new Date().toISOString() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.clientProfileId !== undefined) updateData.clientProfileId = body.clientProfileId || null;

    await db.update(arimaConversations).set(updateData).where(eq(arimaConversations.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[arima/conversations PATCH] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE /api/arima/conversations/[id]  → hard delete (cascades to messages) */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";

    const result = await loadAndAuthorize(params.id, userId, isAdmin);
    if ("error" in result) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }

    await db.delete(arimaConversations).where(eq(arimaConversations.id, params.id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[arima/conversations DELETE] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
