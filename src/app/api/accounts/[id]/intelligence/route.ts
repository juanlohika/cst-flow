import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

/**
 * GET /api/accounts/[id]/intelligence — get intelligence content for an account
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Account intelligence is the most sensitive text we hold on a client, but
    // this route only checked "is signed in" — any user could read or overwrite
    // any client's dossier. Scope it like every other account route.
    await ensureAccessSchema();
    if (!(await canAccessClient(
      { userId: session.user.id, isAdmin: (session.user as any).role === "admin" }, params.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    await ensureAccessSchema();
    if (!(await canAccessClient(
      { userId: session.user.id, isAdmin: (session.user as any).role === "admin" }, params.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { intelligenceContent } = body;

    if (intelligenceContent === undefined) {
      return NextResponse.json({ error: "intelligenceContent is required" }, { status: 400 });
    }

    // Guard against wiping a curated dossier. Some accounts hold 15k+ chars of
    // hand-written context; an empty or near-empty body is almost always a bug
    // or a mis-scoped AI call, not an intentional deletion. Deleting requires
    // an explicit allowClear flag.
    const incoming = String(intelligenceContent ?? "");
    if (incoming.trim().length === 0 && body?.allowClear !== true) {
      const cur = await db.select({ c: clientProfiles.intelligenceContent })
        .from(clientProfiles).where(eq(clientProfiles.id, params.id)).limit(1);
      const existingLen = (cur[0]?.c || "").trim().length;
      if (existingLen > 0) {
        return NextResponse.json({
          error: `Refusing to clear ${existingLen} characters of existing intelligence. Pass allowClear: true if that is really intended.`,
        }, { status: 409 });
      }
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
