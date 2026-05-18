import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { generateTemplateXlsx } from "@/lib/accounts/bulk-import";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/accounts/import/template
 * Returns the XLSX template pre-filled with current accounts + memberships.
 * Admin only.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    await ensureAccessSchema();

    const buf = await generateTemplateXlsx();
    return new NextResponse(buf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cst-accounts-import-template.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error("[accounts/import/template]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
