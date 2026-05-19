import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { revokeBindKey, regenerateBindKey } from "@/lib/telegram/bind-keys";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/telegram-bindings/keys/[id]
 * Body: { action: "revoke" | "regenerate" }
 *
 * Revoke: marks the key revoked + revokes any active binding using it.
 * Regenerate: rotates the accessToken (any existing /bind <oldToken> stops working).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json().catch(() => ({}));
    const action = (body?.action || "").trim();
    if (action === "revoke") {
      await revokeBindKey(params.id);
      return NextResponse.json({ ok: true });
    }
    if (action === "regenerate") {
      const accessToken = await regenerateBindKey(params.id);
      return NextResponse.json({ ok: true, accessToken });
    }
    return NextResponse.json({ error: "Unknown action. Use 'revoke' or 'regenerate'." }, { status: 400 });
  } catch (error: any) {
    console.error("[telegram-bindings POST key/[id]]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
