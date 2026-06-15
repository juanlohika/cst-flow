/**
 * POST /api/accounts/[id]/pin-validator/geocode
 *
 * Reads the account's Pin Validator Sheet, geocodes every row that has a
 * Location but no Lat/Lng yet, and writes results back. Honors the monthly
 * 40,000-call free-tier cap via the shared quota tracker.
 *
 * The call blocks until the whole batch finishes (or hits the cap), then
 * returns the outcome summary. For very large lists (thousands of stores)
 * we may need a background-job pattern later, but synchronous-with-throttle
 * is fine for the realistic per-account size we expect.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pinValidatorProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import { geocodeSheet } from "@/lib/pin-validator/geocoder";

// Geocoding a batch of stores can take a while — Next.js's default 10s
// timeout would chop it. Mark this route as long-running.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  await ensureAccessSchema();
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const projects = await db
      .select({ googleSheetId: pinValidatorProjects.googleSheetId })
      .from(pinValidatorProjects)
      .where(
        and(
          eq(pinValidatorProjects.clientProfileId, id),
          eq(pinValidatorProjects.status, "active"),
        ),
      )
      .limit(1);
    if (projects.length === 0) {
      return NextResponse.json(
        { error: "Pin Validator is not activated for this account." },
        { status: 404 },
      );
    }
    const outcome = await geocodeSheet(projects[0].googleSheetId);
    return NextResponse.json({ outcome });
  } catch (e: any) {
    console.error("[pin-validator/geocode] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Geocoding failed" },
      { status: 500 },
    );
  }
}
