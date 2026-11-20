import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { usageStats } from "@/lib/pdf-compressor/usage";

export const dynamic = "force-dynamic";

/** GET /api/tools/pdf-compress/stats: usage counter for CST OS users (not the public portal). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await usageStats(), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error(`[pdf-compressor] stats failed: ${e?.message}`);
    return NextResponse.json({ error: "Could not load usage" }, { status: 500 });
  }
}
