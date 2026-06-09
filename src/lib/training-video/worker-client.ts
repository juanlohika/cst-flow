/**
 * Client for the training-render-worker Cloud Run service.
 *
 * The worker requires two auth layers:
 *
 *   1. Cloud Run identity (Bearer token from the GCP service account). Without
 *      this Cloud Run returns 401 since we deploy with --no-allow-unauthenticated.
 *   2. Shared secret header (X-Worker-Secret). Our application-level auth.
 *
 * The service account that calls the worker must have the Cloud Run Invoker
 * role on the worker. We reuse the same `arima-brd-writer@moi-cst-app...`
 * service account that already has Drive access — we just need to grant it
 * roles/run.invoker on the worker service. README has the exact gcloud cmd.
 */
import { GoogleAuth } from "google-auth-library";
import { loadGoogleConfig } from "@/lib/drive-export-helpers";

export interface RenderRequest {
  videoId: string;
  title: string;
  outputFolderId: string;
  aspectRatio: "9:16" | "16:9";
  scenes: Array<{
    order: number;
    title: string;
    narrationScript: string;
    caption: string;
    audioDriveFileId: string;
    audioDurationSec: number;
    slideImageDriveFileId?: string;
    sourceVideoDriveFileId?: string;
    sourceStartSec?: number;
    sourceEndSec?: number;
  }>;
  sourcePptxDriveFileId?: string;
  sourceVideoDriveFileId?: string;
}

export interface RenderResponse {
  ok: boolean;
  mp4DriveFileId?: string;
  mp4DriveUrl?: string;
  durationSec?: number;
  error?: string;
}

export async function callRenderWorker(req: RenderRequest): Promise<RenderResponse> {
  const workerUrl = process.env.TRAINING_RENDER_WORKER_URL;
  const workerSecret = process.env.TRAINING_RENDER_WORKER_SECRET;

  if (!workerUrl) {
    return { ok: false, error: "TRAINING_RENDER_WORKER_URL not configured. See worker/README.md for setup." };
  }
  if (!workerSecret) {
    return { ok: false, error: "TRAINING_RENDER_WORKER_SECRET not configured." };
  }

  const googleConfig = await loadGoogleConfig();
  if (!googleConfig?.serviceAccountJson) {
    return { ok: false, error: "Google service account JSON not configured. See Admin → Auth → Google Integration." };
  }

  // Get a Cloud Run identity token for the worker URL
  const idToken = await fetchCloudRunIdentityToken({
    audience: workerUrl,
    serviceAccountJson: googleConfig.serviceAccountJson,
  });

  // The worker needs the service-account JSON in the payload so it can
  // read/write Drive. We pass it via the request body (not as an env var on
  // the worker) so it stays scoped to the request and never lives on disk.
  const payload = {
    ...req,
    serviceAccountJson: googleConfig.serviceAccountJson,
  };

  const renderUrl = `${workerUrl.replace(/\/$/, "")}/render`;
  try {
    const res = await fetch(renderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": workerSecret,
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error || `Worker HTTP ${res.status}` };
    }
    return data as RenderResponse;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Mint a Google identity token suitable for invoking a Cloud Run service.
 * The "audience" is the worker URL (Cloud Run accepts the bare service URL).
 */
async function fetchCloudRunIdentityToken(args: {
  audience: string;
  serviceAccountJson: string;
}): Promise<string> {
  const credentials = JSON.parse(args.serviceAccountJson);
  const auth = new GoogleAuth({
    credentials,
    // Identity tokens use scope=audience semantics — passed via the client
  });
  // The audience must be the bare base URL (no trailing path)
  const client = await auth.getIdTokenClient(args.audience.replace(/\/+$/, ""));
  const headers: any = await client.getRequestHeaders();
  // Older versions return a plain object; newer versions return Headers.
  const get = typeof headers?.get === "function"
    ? (k: string) => headers.get(k)
    : (k: string) => headers?.[k] || headers?.[k.toLowerCase()] || headers?.[k.toUpperCase()];
  const authHeader = get("authorization") || get("Authorization");
  if (!authHeader) throw new Error("Could not obtain identity token for Cloud Run");
  // The header looks like "Bearer eyJhbGc..." — strip the prefix
  return String(authHeader).replace(/^Bearer\s+/i, "");
}
