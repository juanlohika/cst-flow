import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/test
 * Sends a test notification to the calling user. Useful for verifying setup.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    await ensureAccessSchema();

    const result = await dispatchNotification({
      userIds: [userId],
      type: "request_captured",
      title: "Test notification 🎉",
      body: "If you can see this, web push is working correctly.",
      link: "/arima",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("[notifications/test] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
