import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { accountModules } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/account-modules
 *   Returns all active modules sorted by sortOrder. Available to any
 *   authenticated user (used by the account profile form's multi-select).
 *
 * POST /api/account-modules
 *   Admin only. Body: { slug?, label, description?, sortOrder? }. If slug is
 *   omitted, it's derived from the label.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();

    const rows = await db
      .select()
      .from(accountModules)
      .where(eq(accountModules.isActive, true))
      .orderBy(asc(accountModules.sortOrder), asc(accountModules.label));

    return NextResponse.json({ modules: rows });
  } catch (error: any) {
    console.error("[account-modules GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const label = String(body?.label || "").trim();
    if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
    const slug = String(body?.slug || slugify(label)).trim();
    if (!slug) return NextResponse.json({ error: "could not derive slug from label" }, { status: 400 });

    // Check if already exists by slug
    const existing = await db.select({ id: accountModules.id, isActive: accountModules.isActive })
      .from(accountModules)
      .where(eq(accountModules.slug, slug))
      .limit(1);
    if (existing[0]) {
      // Reactivate + update label if previously archived
      await db.update(accountModules)
        .set({ label, isActive: true, description: body?.description ?? null, updatedAt: new Date().toISOString() })
        .where(eq(accountModules.id, existing[0].id));
      return NextResponse.json({ ok: true, id: existing[0].id, slug, label, alreadyExisted: true });
    }

    const id = `mod_${slug}`;
    const now = new Date().toISOString();
    await db.insert(accountModules).values({
      id,
      slug,
      label,
      description: body?.description || null,
      sortOrder: typeof body?.sortOrder === "number" ? body.sortOrder : 999,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true, id, slug, label });
  } catch (error: any) {
    console.error("[account-modules POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
