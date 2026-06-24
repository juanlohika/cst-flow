/**
 * POST /api/accounts/[id]/pin-validator/geocode-job/worker?jobId=...
 *
 * The background worker that actually runs the geocoding loop. Called
 * via a detached fetch from POST /geocode-job (the "start" endpoint),
 * and also re-triggered by the watchdog in GET /geocode-job when a
 * stale heartbeat is detected.
 *
 * No user-facing auth — anyone hitting this URL just runs whatever
 * job they specify, which is intentional: the worker is invoked by
 * server-to-server fetches with the user's actor identity already
 * recorded in the job row. We DO sanity-check that the job exists +
 * the project belongs to this account.
 *
 * The platform may kill this request mid-run. That's fine — the
 * heartbeat will go stale, the next GET call will notice, and we'll
 * be re-invoked. Jobs survive across multiple worker lifetimes.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pinValidatorGeocodingJobs, pinValidatorProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runGeocodingJob } from "@/lib/pin-validator/geocoder-job";

// Long-running. Firebase App Hosting allows up to ~540s per request; the
// runner ticks fast enough that even multi-thousand-row batches usually
// finish in two or three invocations.
export const maxDuration = 540;
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: accountId } = await ctx.params;
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  // Validate the job belongs to this account's active project. Cheap
  // sanity check so a stray /worker call can't run the wrong job.
  const rows = await db
    .select({
      jobProjectId: pinValidatorGeocodingJobs.projectId,
      projectClient: pinValidatorProjects.clientProfileId,
      projectStatus: pinValidatorProjects.status,
    })
    .from(pinValidatorGeocodingJobs)
    .innerJoin(
      pinValidatorProjects,
      eq(pinValidatorProjects.id, pinValidatorGeocodingJobs.projectId),
    )
    .where(eq(pinValidatorGeocodingJobs.id, jobId))
    .limit(1);
  const r = rows[0];
  if (!r) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (r.projectClient !== accountId) {
    return NextResponse.json(
      { error: "Job does not belong to this account" },
      { status: 403 },
    );
  }
  if (r.projectStatus !== "active") {
    return NextResponse.json(
      { error: "Project is archived" },
      { status: 410 },
    );
  }

  try {
    await runGeocodingJob(jobId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[geocode-job/worker] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Worker crashed" },
      { status: 500 },
    );
  }
}
