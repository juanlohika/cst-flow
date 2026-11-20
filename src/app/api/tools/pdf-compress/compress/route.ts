import { NextResponse } from "next/server";
import { getPortalUser } from "@/lib/tools-portal/session";
import { callPdfWorker, type CompressResponse } from "@/lib/pdf-compressor/worker-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * POST /api/tools/pdf-compress/compress  { jobId, fileName, quality }
 * Runs Ghostscript on the uploaded file (in the worker) and returns the sizes
 * plus a short-lived signed download URL. The original is deleted right away;
 * the result is deleted by the bucket's 1-day lifecycle rule.
 */
export async function POST(req: Request) {
  // Tools Portal session (any company Google account) or a CST OS session.
  const user = await getPortalUser();
  if (!user) return NextResponse.json({ ok: false, error: "Please sign in with your company Google account." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!JOB_ID.test(jobId)) return NextResponse.json({ ok: false, error: "Invalid job." }, { status: 400 });
  const quality = ["small", "standard", "high"].includes(body?.quality) ? body.quality : "small";
  const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 255) : "document.pdf";

  const started = Date.now();
  const { status, data } = await callPdfWorker<CompressResponse>("/pdf/compress", { jobId, fileName, quality });
  // Metadata only, never file contents.
  console.log(JSON.stringify({
    event: "pdf_compress", user: user.email, via: user.via, fileName, quality, ok: data.ok,
    originalBytes: data.originalBytes, compressedBytes: data.compressedBytes, ms: Date.now() - started,
  }));
  return NextResponse.json(data, { status });
}
