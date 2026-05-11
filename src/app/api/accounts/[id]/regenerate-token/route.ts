import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles as clientProfilesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateAccessToken } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/[id]/regenerate-token  → admin-only
 * Rotates the accessToken. Any existing Telegram-group bindings, magic links,
 * etc that used the old token must be re-registered.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const rows = await db
      .select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const accessToken = generateAccessToken();
    await db
      .update(clientProfilesTable)
      .set({ accessToken, updatedAt: new Date().toISOString() })
      .where(eq(clientProfilesTable.id, params.id));

    return NextResponse.json({ accessToken });
  } catch (error: any) {
    console.error("[regenerate-token] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
