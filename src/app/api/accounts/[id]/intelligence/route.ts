import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";

/**
 * GET /api/accounts/[id]/intelligence — get intelligence content for an account
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db.select({
      id: clientProfiles.id,
      companyName: clientProfiles.companyName,
      intelligenceContent: clientProfiles.intelligenceContent,
    }).from(clientProfiles).where(eq(clientProfiles.id, params.id)).limit(1);

    if (rows.length === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    return NextResponse.json(rows[0]);
  } catch (err: any) {
    console.error("GET /api/accounts/[id]/intelligence error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/accounts/[id]/intelligence — update intelligence content
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { intelligenceContent } = body;

    if (intelligenceContent === undefined) {
      return NextResponse.json({ error: "intelligenceContent is required" }, { status: 400 });
    }

    await db.update(clientProfiles).set({
      intelligenceContent,
      updatedAt: new Date().toISOString(),
    }).where(eq(clientProfiles.id, params.id));

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("PATCH /api/accounts/[id]/intelligence error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
