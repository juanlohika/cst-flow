import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { arimaTools } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/arima-tools/[name]
 * Body: { enabled?: boolean, autonomy?: 'auto'|'approval'|'disabled' }
 */
export async function PATCH(req: Request, { params }: { params: { name: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const updateData: any = { updatedAt: new Date().toISOString() };
    if ("enabled" in body) updateData.enabled = !!body.enabled;
    if ("autonomy" in body && ["auto", "approval", "disabled"].includes(body.autonomy)) {
      updateData.autonomy = body.autonomy;
    }

    await db.update(arimaTools).set(updateData).where(eq(arimaTools.name, params.name));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[admin/arima-tools PATCH] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
