import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { parseXlsx, validateRows } from "@/lib/accounts/bulk-import";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/accounts/import/validate
 * Body: multipart/form-data with `file` (XLSX)
 *
 * Returns the validation report without writing anything. Admin only.
 * The client passes the file back to /apply along with the parsed payload
 * in JSON form (so we don't need to store anything between validate + apply).
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    await ensureAccessSchema();

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    const buffer = await (file as File).arrayBuffer();

    let parsed;
    try {
      parsed = parseXlsx(buffer);
    } catch (e: any) {
      return NextResponse.json({
        error: `Couldn't parse the file as XLSX: ${e?.message}. Make sure you uploaded the template from /api/admin/accounts/import/template.`,
      }, { status: 400 });
    }

    const result = await validateRows(parsed);

    return NextResponse.json({
      ok: true,
      filename: (file as File).name,
      validation: result,
    });
  } catch (error: any) {
    console.error("[accounts/import/validate]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
