import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runDueCheckIns } from "@/lib/arima/checkins";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/arima-checkins/run
 *
 * Runs all due check-ins. Two ways to invoke:
 *  - Admin (NextAuth admin role) — UI "Run now" button
 *  - Cron/external trigger via x-cron-secret header (env CHECKINS_CRON_SECRET)
 *
 * Returns counts + a per-client summary so the UI can show what happened.
 */
export async function POST(req: Request) {
  try {
    await ensureAccessSchema();

    // Auth: either an admin user OR a valid cron secret header
    const session = await auth();
    const isAdmin = session?.user?.id && (session.user as any).role === "admin";

    const cronSecret = req.headers.get("x-cron-secret") || "";
    const expectedSecret = process.env.CHECKINS_CRON_SECRET || "";
    const isCronCall = !!expectedSecret && cronSecret === expectedSecret;

    if (!isAdmin && !isCronCall) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runDueCheckIns({ ensureSchedules: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[checkins/run] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET handler returns a preview of what /run WOULD do (without sending), so
 * admins can see who's due before triggering.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    await ensureAccessSchema();
    const { listDueSchedules, backfillSchedules } = await import("@/lib/arima/checkins/cadence");
    await backfillSchedules();
    const due = await listDueSchedules();
    return NextResponse.json({ due });
  } catch (error: any) {
    console.error("[checkins/run GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
