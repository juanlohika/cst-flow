import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { extendSuperAdminContext } from "@/lib/super-admin/context";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/super-admin/extend
 * Body: { hours }
 * Admin-only endpoint to push the SA context expiration forward.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const hours = Math.max(1, Math.min(2160, Number(body?.hours) || 24));
    const newExpiry = await extendSuperAdminContext({ hours, byUserId: session.user.id });
    if (!newExpiry) return NextResponse.json({ error: "No active Super Admin context to extend" }, { status: 404 });
    return NextResponse.json({ ok: true, expiresAt: newExpiry });
  } catch (error: any) {
    console.error("[super-admin/extend POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
