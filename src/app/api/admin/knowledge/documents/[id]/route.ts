import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { knowledgeDocuments, knowledgeDocumentVersions } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** GET /api/admin/knowledge/documents/[id] — full doc + version history */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const docRows = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, params.id)).limit(1);
    if (docRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const versions = await db
      .select({
        version: knowledgeDocumentVersions.version,
        title: knowledgeDocumentVersions.title,
        changeNote: knowledgeDocumentVersions.changeNote,
        createdAt: knowledgeDocumentVersions.createdAt,
        createdByUserId: knowledgeDocumentVersions.createdByUserId,
      })
      .from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.documentId, params.id))
      .orderBy(desc(knowledgeDocumentVersions.version));

    return NextResponse.json({ document: docRows[0], versions });
  } catch (error: any) {
    console.error("[knowledge/documents/id GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE /api/admin/knowledge/documents/[id] — soft-archive (status='archived') */
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    await db.update(knowledgeDocuments)
      .set({ status: "archived", updatedAt: new Date().toISOString() })
      .where(eq(knowledgeDocuments.id, params.id));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[knowledge/documents/id DELETE]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
