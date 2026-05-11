import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendCheckInForClient } from "@/lib/arima/checkins";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/arima-checkins/send-now
 * Body: { clientProfileId, preferredChannel? }
 *
 * Sends a check-in to ONE client right now, regardless of cadence.
 * Used by the "Send check-in now" button on the account detail page.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const clientProfileId = body?.clientProfileId;
    if (!clientProfileId) return NextResponse.json({ error: "clientProfileId required" }, { status: 400 });

    const result = await sendCheckInForClient({
      clientProfileId,
      preferredChannel: body.preferredChannel,
      triggeredByUserId: session.user.id,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[checkins/send-now] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
