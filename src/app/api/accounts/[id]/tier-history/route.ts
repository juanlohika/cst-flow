import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { tierIntervals, recordTierChange } from "@/lib/courtesy/tier-history";
import { loadTierFrequencyMap, resolveAccountFrequency } from "@/lib/accounts/tier-frequency";

export const dynamic = "force-dynamic";

/**
 * GET  /api/accounts/[id]/tier-history  → the account's tier movements
 * POST /api/accounts/[id]/tier-history  → record a movement
 *   body: { tier, effectiveFrom, frequencyOverride?, reason? }
 *
 * Each row carries the cadence that applied during that interval, since that is
 * the thing people actually want to know when auditing a past score.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    if (!(await canAccessClient(
      { userId: session.user.id, isAdmin: (session.user as any).role === "admin" }, params.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const intervals = await tierIntervals(params.id);
    const tierMap = await loadTierFrequencyMap();
    const withCadence = intervals.map(iv => ({
      ...iv,
      cadence: resolveAccountFrequency({
        tier: iv.tier, frequencyOverride: iv.frequencyOverride, tierMap,
      }).label,
    }));
    // Newest first — the current tier is what people look for.
    withCadence.reverse();
    return NextResponse.json({ intervals: withCadence });
  } catch (error: any) {
    console.error("[tier-history GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    if (!(await canAccessClient(
      { userId: session.user.id, isAdmin: (session.user as any).role === "admin" }, params.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const tier = String(body?.tier ?? "").trim();
    const effectiveFrom = String(body?.effectiveFrom ?? "").trim();
    if (!["VIP", "1", "2", "3", "4", "5"].includes(tier)) {
      return NextResponse.json({ error: "tier must be VIP or 1–5" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      return NextResponse.json({ error: "effectiveFrom must be YYYY-MM-DD" }, { status: 400 });
    }

    const res = await recordTierChange({
      accountId: params.id,
      tier,
      frequencyOverride: body?.frequencyOverride ?? undefined,
      effectiveFrom,
      reason: body?.reason || null,
      changedByUserId: session.user.id,
    });
    if (!res.ok) return NextResponse.json({ error: res.note }, { status: 400 });
    return NextResponse.json(res);
  } catch (error: any) {
    console.error("[tier-history POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
