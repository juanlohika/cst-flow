import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureAccessSchema } from "@/lib/access/accounts";
import {
  loadTierFrequencyMap, saveTierFrequencyMap, TIER_LABELS, DEFAULT_TIER_FREQUENCY,
} from "@/lib/accounts/tier-frequency";

export const dynamic = "force-dynamic";

/** GET — return the current tier→frequency mapping. POST — save a new one. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const map = await loadTierFrequencyMap();
    return NextResponse.json({ map, defaults: DEFAULT_TIER_FREQUENCY, tierLabels: TIER_LABELS });
  } catch (error: any) {
    console.error("[account-tiers GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
    await ensureAccessSchema();

    const body = await req.json();
    const map = body?.map;
    if (!map || typeof map !== "object") {
      return NextResponse.json({ error: "Body must include { map: { VIP: '...', '1': '...', ... } }" }, { status: 400 });
    }
    // Sanitize — only allow the known tier labels, coerce values to strings.
    const sanitized: any = { ...DEFAULT_TIER_FREQUENCY };
    for (const tier of TIER_LABELS) {
      if (typeof map[tier] === "string" && map[tier].trim()) {
        sanitized[tier] = map[tier].trim();
      }
    }
    await saveTierFrequencyMap(sanitized);
    return NextResponse.json({ ok: true, map: sanitized });
  } catch (error: any) {
    console.error("[account-tiers POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
