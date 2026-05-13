import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaChannelBindings } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/[id]/bindings
 * Returns the active Telegram (and future channel) bindings for this account.
 * Used by the Contacts tab so admins can pick which group a new contact
 * should be routed to.
 */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const isAdmin = (session.user as any).role === "admin";
    await ensureAccessSchema();

    const allowed = await canAccessClient({ userId, isAdmin }, params.id);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rows = await db
      .select({
        id: arimaChannelBindings.id,
        channel: arimaChannelBindings.channel,
        chatId: arimaChannelBindings.chatId,
        chatTitle: arimaChannelBindings.chatTitle,
        boundAt: arimaChannelBindings.boundAt,
        status: arimaChannelBindings.status,
      })
      .from(arimaChannelBindings)
      .where(and(
        eq(arimaChannelBindings.clientProfileId, params.id),
        eq(arimaChannelBindings.status, "active"),
      ))
      .orderBy(asc(arimaChannelBindings.boundAt));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[account bindings GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
