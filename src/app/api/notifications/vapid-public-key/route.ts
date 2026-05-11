import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrCreateVapidKeys } from "@/lib/notifications/vapid";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/vapid-public-key
 * Returns the VAPID public key the browser uses to subscribe to push.
 * Auto-generates the keys on first call.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const config = await getOrCreateVapidKeys();
    return NextResponse.json({ publicKey: config.publicKey });
  } catch (error: any) {
    console.error("[vapid-public-key] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
