import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { callPdfWorker, type UploadUrlResponse } from "@/lib/pdf-compressor/worker-client";

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

/**
 * POST /api/tools/pdf-compress/upload-url  { fileName, size }
 * Signed-in CST OS users only. Returns a short-lived signed URL so the browser
 * can upload the PDF straight to the private temp bucket (files can be 100 MB+,
 * which cannot pass through this server).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fileName = typeof body?.fileName === "string" ? body.fileName : "";
  const size = typeof body?.size === "number" ? body.size : 0;
  if (!/\.pdf$/i.test(fileName)) return NextResponse.json({ ok: false, error: "Only PDF files are accepted." }, { status: 400 });
  if (size <= 0 || size > MAX_BYTES) return NextResponse.json({ ok: false, error: "The file must be a PDF up to 200 MB." }, { status: 400 });

  const { status, data } = await callPdfWorker<UploadUrlResponse>("/pdf/upload-url", { fileName, size });
  return NextResponse.json(data, { status });
}
