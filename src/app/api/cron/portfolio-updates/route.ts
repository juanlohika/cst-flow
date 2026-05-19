import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  runMaintenanceUpdate,
  runCcStatus,
  runHypercareOverdueSweep,
} from "@/lib/arima/proactive-portfolio";

export const dynamic = "force-dynamic";

type Job = "maintenance" | "cc-status" | "hypercare" | "all";

/**
 * POST /api/cron/portfolio-updates?job=<maintenance|cc-status|hypercare|all>
 *
 * Triggers proactive ARIMA portfolio updates to the bound Super Admin GC.
 *
 * Auth: admin (NextAuth) OR cron header `x-cron-secret` = env PORTFOLIO_CRON_SECRET.
 *
 * Scheduling intent (configure externally via Cloud Scheduler / cron-job.org):
 *   - Bi-weekly maintenance: job=maintenance, Mondays 09:00 PHT, every 2 weeks
 *   - Monthly CC status:     job=cc-status, last day of month 17:00 PHT
 *   - Daily hypercare sweep: job=hypercare, every morning 08:00 PHT
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const isAdmin = !!(session?.user?.id && (session.user as any).role === "admin");

    const cronSecret = req.headers.get("x-cron-secret") || "";
    const expectedSecret = process.env.PORTFOLIO_CRON_SECRET || "";
    const isCronCall = !!expectedSecret && cronSecret === expectedSecret;

    if (!isAdmin && !isCronCall) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const job = (url.searchParams.get("job") || "all") as Job;

    const results: Record<string, any> = {};
    if (job === "maintenance" || job === "all") {
      results.maintenance = await runMaintenanceUpdate();
    }
    if (job === "cc-status" || job === "all") {
      results.ccStatus = await runCcStatus();
    }
    if (job === "hypercare" || job === "all") {
      results.hypercare = await runHypercareOverdueSweep();
    }
    return NextResponse.json({ ok: true, job, results });
  } catch (error: any) {
    console.error("[cron/portfolio-updates] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
