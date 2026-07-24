/**
 * Pilot Tracker — validate a roster XLSX (no DB writes).
 *
 * POST /api/accounts/[id]/pilot-tracker/import/validate
 *   multipart/form-data with `file` (.xlsx)
 *
 * Returns per-row {rowNumber, status, message} report + summary counts.
 * The admin previews this and clicks "Apply" to commit — apply is a
 * separate endpoint (/apply) that re-parses the file rather than trusting
 * the client to echo the report back.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pilotProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { validateWorkbook } from "@/lib/pilot/bulk-import";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [project] = await db
    .select()
    .from(pilotProjects)
    .where(and(eq(pilotProjects.clientProfileId, id), eq(pilotProjects.status, "active")))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "No active pilot project" }, { status: 404 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Max ${MAX_BYTES} bytes.` },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const report = validateWorkbook(buffer);
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to parse XLSX" },
      { status: 500 },
    );
  }
}
