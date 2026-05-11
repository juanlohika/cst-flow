import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/auth/me
 * Returns the current portal session (or 401 if none).
 */
export async function GET() {
  try {
    await ensureAccessSchema();
    const session = await getPortalSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ session });
  } catch (error: any) {
    console.error("[portal/auth/me] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
