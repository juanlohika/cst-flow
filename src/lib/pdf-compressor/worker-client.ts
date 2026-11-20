/**
 * Client for the pdf-compress-worker Cloud Run service (AI Tools › PDF Compressor).
 *
 * Same two auth layers as the training-render-worker:
 *   1. Cloud Run identity token, minted from the Google service account that
 *      CST OS already uses (it needs roles/run.invoker on the worker).
 *   2. Shared secret header X-Worker-Secret (PDF_WORKER_SECRET).
 *
 * The browser never talks to the worker. It only receives short-lived signed
 * Cloud Storage URLs to upload the original and download the result.
 */
import { GoogleAuth } from "google-auth-library";
import { loadGoogleConfig } from "@/lib/drive-export-helpers";

export type PdfQuality = "small" | "standard" | "high";

export interface UploadUrlResponse {
  ok: boolean;
  jobId?: string;
  uploadUrl?: string;
  error?: string;
}

export interface CompressResponse {
  ok: boolean;
  fileName?: string;
  downloadUrl?: string;
  pages?: number | null;
  originalBytes?: number;
  compressedBytes?: number;
  resizedToA4?: boolean;
  keptOriginal?: boolean;
  error?: string;
}

async function identityToken(audience: string, serviceAccountJson: string): Promise<string> {
  const auth = new GoogleAuth({ credentials: JSON.parse(serviceAccountJson) });
  const client = await auth.getIdTokenClient(audience.replace(/\/+$/, ""));
  const headers: any = await client.getRequestHeaders();
  const get = typeof headers?.get === "function"
    ? (k: string) => headers.get(k)
    : (k: string) => headers?.[k] || headers?.[k.toLowerCase()];
  const authHeader = get("authorization") || get("Authorization");
  if (!authHeader) throw new Error("Could not obtain identity token for Cloud Run");
  return String(authHeader).replace(/^Bearer\s+/i, "");
}

export async function callPdfWorker<T extends { ok: boolean; error?: string }>(
  path: "/pdf/upload-url" | "/pdf/compress",
  body: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  const workerUrl = process.env.PDF_WORKER_URL?.trim();
  const secret = process.env.PDF_WORKER_SECRET?.trim();
  if (!workerUrl || !secret) {
    return { status: 503, data: { ok: false, error: "The PDF Compressor is not set up on this server yet." } as T };
  }
  const google = await loadGoogleConfig();
  if (!google?.serviceAccountJson) {
    return { status: 503, data: { ok: false, error: "Google service account is not configured." } as T };
  }

  const url = `${workerUrl.replace(/\/$/, "")}${path}`;
  try {
    const token = await identityToken(workerUrl, google.serviceAccountJson);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": secret,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const raw = await res.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch {}
    if (!res.ok) {
      console.error(`[pdf-compressor] worker HTTP ${res.status} ${path}: ${raw.substring(0, 300)}`);
      return { status: res.status, data: { ok: false, error: data?.error || "The PDF Compressor failed. Please try again." } as T };
    }
    return { status: 200, data: data as T };
  } catch (e: any) {
    console.error(`[pdf-compressor] worker call threw: ${e?.message}`);
    return { status: 502, data: { ok: false, error: "Could not reach the PDF Compressor. Please try again." } as T };
  }
}
