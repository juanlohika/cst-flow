import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { knowledgeDocuments } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { upsertKnowledgeDocument } from "@/lib/knowledge";
import { extractTextFromPdf } from "@/lib/knowledge/pdf";

export const dynamic = "force-dynamic";

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") return { error: { status: 403, message: "Admin only" } } as const;
  return { ok: true as const };
}

/** GET /api/admin/knowledge/documents — list active documents */
export async function GET() {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const rows = await db
      .select({
        id: knowledgeDocuments.id,
        slug: knowledgeDocuments.slug,
        title: knowledgeDocuments.title,
        category: knowledgeDocuments.category,
        version: knowledgeDocuments.version,
        audience: knowledgeDocuments.audience,
        sourceMime: knowledgeDocuments.sourceMime,
        sourceBytes: knowledgeDocuments.sourceBytes,
        updatedAt: knowledgeDocuments.updatedAt,
        createdAt: knowledgeDocuments.createdAt,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.status, "active"))
      .orderBy(asc(knowledgeDocuments.category), asc(knowledgeDocuments.title));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("[knowledge/documents GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/knowledge/documents
 * Accepts either JSON (markdown paste) or multipart form (file upload).
 *
 * JSON body:
 *   { slug, title, category, content, audience?, changeNote? }
 *
 * Multipart (file upload):
 *   slug (string), title (string), category (string), audience? (string),
 *   changeNote? (string), file (Blob — pdf, md, or txt)
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    await ensureAccessSchema();

    const ct = req.headers.get("content-type") || "";
    let slug = ""; let title = ""; let category = ""; let audience: any = "all";
    let changeNote: string | null = null;
    let content = ""; let sourceMime: string | null = null; let sourceBytes: number | null = null;

    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      slug = String(form.get("slug") || "").trim();
      title = String(form.get("title") || "").trim();
      category = String(form.get("category") || "").trim();
      audience = String(form.get("audience") || "all").trim();
      changeNote = (form.get("changeNote") as string) || null;
      const file = form.get("file") as Blob | null;
      if (file && typeof (file as any).arrayBuffer === "function") {
        const buf = Buffer.from(await (file as any).arrayBuffer());
        sourceMime = (file as any).type || null;
        sourceBytes = buf.byteLength;
        if (sourceMime === "application/pdf" || sourceBytes > 0 && (await sniffIsPdf(buf))) {
          content = await extractTextFromPdf(buf);
          sourceMime = sourceMime || "application/pdf";
        } else {
          content = buf.toString("utf-8");
          sourceMime = sourceMime || "text/markdown";
        }
      }
      // Allow paste-content as fallback even with multipart
      if (!content) content = String(form.get("content") || "");
    } else {
      const body = await req.json().catch(() => ({}));
      slug = String(body?.slug || "").trim();
      title = String(body?.title || "").trim();
      category = String(body?.category || "").trim();
      audience = body?.audience || "all";
      changeNote = body?.changeNote || null;
      content = String(body?.content || "");
      sourceMime = body?.sourceMime || "text/markdown";
      sourceBytes = content ? Buffer.byteLength(content, "utf-8") : 0;
    }

    if (!slug || !title || !category) {
      return NextResponse.json({ error: "slug, title, and category are required" }, { status: 400 });
    }
    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: "Document content is empty (PDF may be scanned/image-only — OCR not yet supported)." }, { status: 400 });
    }

    const result = await upsertKnowledgeDocument({
      slug, title, category, content,
      sourceMime, sourceBytes,
      audience,
      changeNote,
      userId: session!.user!.id || null,
    });

    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (error: any) {
    console.error("[knowledge/documents POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function sniffIsPdf(buf: Buffer): Promise<boolean> {
  // PDF files start with "%PDF-"
  return buf.length >= 5 && buf.slice(0, 5).toString("ascii") === "%PDF-";
}
