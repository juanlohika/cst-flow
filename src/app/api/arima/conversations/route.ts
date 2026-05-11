import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  arimaConversations,
  users as usersTable,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/arima/conversations
 *   ?scope=mine  → conversations owned by the current user (default)
 *   ?scope=team  → all conversations (admin only)
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") || "mine";

    let rows: any[] = [];
    try {
      const base = db
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
        .orderBy(desc(arimaConversations.lastMessageAt));

      if (scope === "team") {
        if (!isAdmin) {
          return NextResponse.json({ error: "Admin only" }, { status: 403 });
        }
        rows = await base;
      } else {
        rows = await base.where(eq(arimaConversations.userId, userId));
      }
    } catch (e: any) {
      console.warn("[arima/conversations GET] query failed, returning empty:", e?.message);
      rows = [];
    }

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[arima/conversations GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
