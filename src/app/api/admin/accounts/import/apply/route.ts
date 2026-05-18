import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { applyValidated, type ValidationResult } from "@/lib/accounts/bulk-import";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/accounts/import/apply
 * Body JSON: { filename: string, validation: ValidationResult }
 *
 * Applies the validated rows. Admin only. The client posts back the exact
 * payload returned from /validate so we don't need to persist between steps.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    await ensureAccessSchema();

    const body = await req.json();
    const validation = body?.validation as ValidationResult | undefined;
    const filename = String(body?.filename || "uploaded.xlsx");
    if (!validation || !Array.isArray(validation.accounts) || !Array.isArray(validation.team)) {
      return NextResponse.json({ error: "Body must include the validation object returned by /validate." }, { status: 400 });
    }

    const result = await applyValidated({
      validation,
      uploadedBy: session.user.id,
      filename,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[accounts/import/apply]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
