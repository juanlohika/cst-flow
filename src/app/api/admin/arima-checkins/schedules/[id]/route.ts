import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaCheckInSchedules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { cadenceToDays, addDays } from "@/lib/arima/checkins/cadence";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/arima-checkins/schedules/[id]
 * Body: { cadence?, customIntervalDays?, preferredChannel?, status?, nextDueAt? }
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const allowed = ["cadence", "customIntervalDays", "preferredChannel", "status", "nextDueAt", "consecutiveNoResponse"];
    const updateData: any = { updatedAt: new Date().toISOString() };
    for (const k of allowed) {
      if (k in body && body[k] !== undefined) updateData[k] = body[k];
    }

    // If cadence changed but nextDueAt wasn't explicitly set, recompute it from now
    if (("cadence" in body || "customIntervalDays" in body) && !("nextDueAt" in body)) {
      const days = cadenceToDays(updateData.cadence || "monthly", updateData.customIntervalDays);
      updateData.nextDueAt = addDays(new Date().toISOString(), days);
    }

    await db.update(arimaCheckInSchedules).set(updateData).where(eq(arimaCheckInSchedules.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[schedule PATCH]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
