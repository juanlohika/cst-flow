import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pushMetricsToSheet } from "@/lib/metrics/sheets-push";

export const dynamic = "force-dynamic";

/**
 * POST /api/metrics/[userId]/push?month=YYYY-MM
 * On-demand "push now", for month-end when waiting for the weekly cron is not
 * good enough. Same visibility rule as reading: own metrics, or admin.
 */
export async function POST(req: Request, { params }: { params: { userId: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin && session.user.id !== params.userId) {
      return NextResponse.json({ error: "You can only push your own metrics." }, { status: 403 });
    }

    const month = new URL(req.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }

    const res = await pushMetricsToSheet({ userId: params.userId, month });
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 });
    return NextResponse.json(res);
  } catch (error: any) {
    console.error("[metrics push]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
