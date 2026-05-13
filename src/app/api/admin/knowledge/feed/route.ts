import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { knowledgeFeedEntries } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** GET /api/admin/knowledge/feed — list feed entries (newest first) */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const rows = await db
      .select()
      .from(knowledgeFeedEntries)
      .orderBy(desc(knowledgeFeedEntries.publishedAt));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[knowledge/feed GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** POST /api/admin/knowledge/feed — add a new feed entry */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const body = await req.json();
    const title = String(body?.title || "").trim();
    const bodyText = String(body?.body || "").trim();
    if (!title || !bodyText) return NextResponse.json({ error: "title and body are required" }, { status: 400 });

    const id = `kfeed_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await db.insert(knowledgeFeedEntries).values({
      id,
      title,
      body: bodyText,
      category: body?.category || "general",
      audience: body?.audience || "all",
      publishedAt: body?.publishedAt || now,
      expiresAt: body?.expiresAt || null,
      createdAt: now,
      createdByUserId: session!.user!.id,
    });

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (error: any) {
    console.error("[knowledge/feed POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
