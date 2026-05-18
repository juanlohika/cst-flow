import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import { publishCampaign } from "@/lib/accounts/campaign";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/assessment-campaigns/[id]/publish
 * Compute the queue, persist targets, send emails, flip campaign to 'published'.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const appUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || new URL(req.url).origin;

    const result = await publishCampaign({ campaignId: params.id, appUrl });
    if (!result.ok) return NextResponse.json({ error: result.errors.join(" · ") || "Publish failed" }, { status: 400 });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[campaign publish]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
