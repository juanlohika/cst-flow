import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { createBindKey } from "@/lib/telegram/bind-keys";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/telegram-bindings/keys
 * Body: { clientProfileId, label }
 *
 * Creates a new ClientBindKey. Returns the key (including its accessToken)
 * so the admin UI can immediately surface the bind link / QR.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const clientProfileId = (body?.clientProfileId || "").trim();
    const label = (body?.label || "").trim();
    if (!clientProfileId) return NextResponse.json({ error: "clientProfileId required" }, { status: 400 });
    if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });

    const key = await createBindKey({
      clientProfileId,
      label,
      createdBy: session.user.id,
    });
    return NextResponse.json({ key }, { status: 201 });
  } catch (error: any) {
    console.error("[telegram-bindings POST key]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
