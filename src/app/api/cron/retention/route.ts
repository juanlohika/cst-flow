import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { runRetentionSweep, DEFAULT_POLICY } from "@/lib/arima/retention";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/retention
 *
 * Clears diagnostic rows that have aged out. Nothing that records WHAT WAS
 * ASKED FOR is touched — requests, evidence links, messages and the BRD usage
 * log all stay. See src/lib/arima/retention.ts for what each sweep covers.
 *
 * Auth: admin (NextAuth) OR `x-cron-secret` = env PORTFOLIO_CRON_SECRET, the
 * same secret the portfolio cron uses so there is only one to rotate.
 *
 * Query params:
 *   dry=1          count without deleting — run this first
 *   runLogDays     override the 60-day run-log window
 *   limit          max rows per table per run (default 5000)
 *
 * Suggested schedule: weekly, Sundays 03:00 PHT. There is no urgency — the
 * point is that growth stops being unbounded, not that it is trimmed daily.
 *
 * GET returns the policy without changing anything, so you can check what a run
 * would do from a browser.
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

    await ensureAccessSchema();

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const runLogDays = Number(url.searchParams.get("runLogDays") || 0);
    const limit = Number(url.searchParams.get("limit") || 0);

    const result = await runRetentionSweep({
      dryRun,
      policy: {
        ...(runLogDays > 0 ? { runLogDays } : {}),
        ...(limit > 0 ? { limit } : {}),
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[cron/retention] failed:", e);
    return NextResponse.json({ error: e?.message || "retention sweep failed" }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!(session?.user?.id && (session.user as any).role === "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    policy: DEFAULT_POLICY,
    note:
      "POST to run. Add ?dry=1 to count without deleting. " +
      "Requests, evidence links, messages and the BRD usage log are never touched.",
  });
}
