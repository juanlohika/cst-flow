/**
 * POST /api/accounts/[id]/pin-validator/geocode-job
 *   Start a new background geocoding job for this account's Pin Validator
 *   project. Returns 202 immediately with { jobId }. The work runs in the
 *   background — see /worker.
 *
 * GET /api/accounts/[id]/pin-validator/geocode-job
 *   Returns { active: <JobView | null>, lastCompleted: <JobView | null> }.
 *   The UI polls this every couple of seconds while a job is running.
 *   Also performs the watchdog check: if the active job has gone stale
 *   (no heartbeat for >2 min), kicks the worker again before returning.
 *
 * DELETE /api/accounts/[id]/pin-validator/geocode-job
 *   Request cancellation of the active job. Worker exits between ticks.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pinValidatorProjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import {
  startGeocodingJob,
  loadLatestJob,
  loadLatestCompletedJob,
  requestCancel,
  isJobStale,
} from "@/lib/pin-validator/geocoder-job";

export const dynamic = "force-dynamic";

// Same approach as the magic-link route — derive the external origin from
// X-Forwarded-* headers so the detached fetch hits the public URL (Firebase
// container's req.nextUrl.origin is 0.0.0.0:8080 internally).
const PRODUCTION_BASE_URL = "https://cst-flow--cst-flowdesk.asia-east1.hosted.app";

function externalOrigin(req: NextRequest, hdrs: Headers): string {
  const forwardedHost = hdrs.get("x-forwarded-host") || hdrs.get("host");
  const forwardedProto = hdrs.get("x-forwarded-proto");
  if (forwardedHost && !/^(0\.0\.0\.0|127\.0\.0\.1|localhost)/i.test(forwardedHost)) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }
  const origin = req.nextUrl.origin;
  if (origin && !/0\.0\.0\.0|127\.0\.0\.1/.test(origin)) return origin;
  return PRODUCTION_BASE_URL;
}

type AuthResult =
  | { ok: true; actor: { userId: string; isAdmin: boolean } }
  | { ok: false; status: number; message: string };

async function authorize(req: NextRequest, accountId: string): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, accountId))) {
    return { ok: false, status: 403, message: "Forbidden" };
  }
  return { ok: true, actor };
}

async function loadActiveProjectId(accountId: string): Promise<string | null> {
  const projects = await db
    .select({ id: pinValidatorProjects.id })
    .from(pinValidatorProjects)
    .where(
      and(
        eq(pinValidatorProjects.clientProfileId, accountId),
        eq(pinValidatorProjects.status, "active"),
      ),
    )
    .limit(1);
  return projects[0]?.id || null;
}

async function triggerWorker(req: NextRequest, hdrs: Headers, accountId: string, jobId: string) {
  const origin = externalOrigin(req, hdrs);
  const url = `${origin}/api/accounts/${accountId}/pin-validator/geocode-job/worker?jobId=${jobId}`;
  // Detached — we deliberately do NOT await. The platform keeps the function
  // alive while there's any in-flight fetch, but this response returns
  // immediately to the caller.
  fetch(url, { method: "POST", cache: "no-store" }).catch((e) => {
    console.warn("[geocode-job] worker trigger failed:", e?.message || e);
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(req, id);
  if (!a.ok) return NextResponse.json({ error: a.message }, { status: a.status });

  try {
    const projectId = await loadActiveProjectId(id);
    if (!projectId) {
      return NextResponse.json(
        { error: "Pin Validator is not activated for this account." },
        { status: 404 },
      );
    }

    const { jobId, totalRows } = await startGeocodingJob({
      projectId,
      startedByUserId: a.actor.userId,
    });

    if (totalRows > 0) {
      const { headers } = await import("next/headers");
      const hdrs = await headers();
      await triggerWorker(req, hdrs, id, jobId);
    }

    return NextResponse.json({ jobId, totalRows }, { status: 202 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to start geocoding job" },
      { status: 400 },
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(req, id);
  if (!a.ok) return NextResponse.json({ error: a.message }, { status: a.status });

  const projectId = await loadActiveProjectId(id);
  if (!projectId) {
    return NextResponse.json({ active: null, lastCompleted: null });
  }

  const latest = await loadLatestJob(projectId);
  let active = latest;
  // If the most-recent job is terminal, don't surface it as 'active'.
  if (
    latest &&
    (latest.status === "completed" ||
      latest.status === "cancelled" ||
      latest.status === "failed" ||
      latest.status === "paused")
  ) {
    active = null;
  }

  // Watchdog: if active job's heartbeat is stale, re-trigger worker.
  if (active && (await isJobStale(active.id))) {
    const { headers } = await import("next/headers");
    const hdrs = await headers();
    await triggerWorker(req, hdrs, id, active.id);
  }

  const lastCompleted = await loadLatestCompletedJob(projectId);
  return NextResponse.json({ active, lastCompleted });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = await authorize(req, id);
  if (!a.ok) return NextResponse.json({ error: a.message }, { status: a.status });

  const projectId = await loadActiveProjectId(id);
  if (!projectId) {
    return NextResponse.json({ ok: true, cancelled: false });
  }
  const latest = await loadLatestJob(projectId);
  if (!latest || latest.status !== "running") {
    return NextResponse.json({ ok: true, cancelled: false });
  }
  await requestCancel(latest.id);
  return NextResponse.json({ ok: true, cancelled: true });
}
