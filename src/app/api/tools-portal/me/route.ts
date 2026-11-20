import { NextResponse } from "next/server";
import { allowedDomains, getPortalUser } from "@/lib/tools-portal/session";

export const dynamic = "force-dynamic";

/** GET /api/tools-portal/me: who is signed in to the Tools Portal (or null). */
export async function GET() {
  const user = await getPortalUser();
  return NextResponse.json({ user, domains: allowedDomains() }, { headers: { "Cache-Control": "no-store" } });
}
