import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { knowledgeModules } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** GET /api/admin/knowledge/modules — list all modules */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const rows = await db
      .select()
      .from(knowledgeModules)
      .orderBy(asc(knowledgeModules.category), asc(knowledgeModules.name));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[knowledge/modules GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** POST /api/admin/knowledge/modules — upsert a module by slug */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const body = await req.json();
    const slug = String(body?.slug || "").trim().toLowerCase();
    const name = String(body?.name || "").trim();
    const description = String(body?.description || "").trim();
    if (!slug || !name || !description) return NextResponse.json({ error: "slug, name, description required" }, { status: 400 });

    const existing = await db.select().from(knowledgeModules).where(eq(knowledgeModules.slug, slug)).limit(1);
    const now = new Date().toISOString();
    const payload = {
      slug,
      name,
      category: body?.category || null,
      description,
      whoItsFor: body?.whoItsFor || null,
      keyFeatures: body?.keyFeatures || null,
      priceNote: body?.priceNote || null,
      status: body?.status || "active",
      audience: body?.audience || "all",
      updatedAt: now,
    };

    if (existing.length > 0) {
      await db.update(knowledgeModules).set(payload).where(eq(knowledgeModules.id, existing[0].id));
      return NextResponse.json({ ok: true, id: existing[0].id, updated: true });
    } else {
      const id = `kmod_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      await db.insert(knowledgeModules).values({ id, ...payload, createdAt: now });
      return NextResponse.json({ ok: true, id, created: true }, { status: 201 });
    }
  } catch (error: any) {
    console.error("[knowledge/modules POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
