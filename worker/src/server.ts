/**
 * Training Render Worker — HTTP entrypoint.
 *
 * Endpoints:
 *   GET  /healthz       — health check for Cloud Run
 *   POST /render        — accepts a RenderJob, returns a RenderResult
 *
 * Auth: every POST requires X-Worker-Secret header matching WORKER_SECRET.
 *
 * Render is synchronous (HTTP request stays open while rendering). For a
 * 60-90 second video this typically completes in 30-90 seconds. Cloud Run's
 * default request timeout is 5 minutes which fits our use case.
 */
import express from "express";
import { requireSharedSecret } from "./auth.js";
import { renderJob } from "./render.js";
import { extractFrames } from "./frames.js";
import type { RenderJob } from "./types.js";

const PORT = Number(process.env.PORT) || 8080;

const app = express();
// Render jobs include service-account JSON and Drive ids — keep it tight.
// Frame extraction RESPONSES can be large (base64 JPEGs), but request bodies
// stay small — 10mb on the input side is plenty.
app.use(express.json({ limit: "10mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "training-render-worker" });
});

app.post("/render", requireSharedSecret, async (req, res) => {
  const job = req.body as RenderJob;
  if (!job || !job.videoId || !Array.isArray(job.scenes)) {
    res.status(400).json({ ok: false, error: "Invalid job payload" });
    return;
  }
  if (!job.serviceAccountJson) {
    res.status(400).json({ ok: false, error: "serviceAccountJson required" });
    return;
  }
  if (!job.outputFolderId) {
    res.status(400).json({ ok: false, error: "outputFolderId required" });
    return;
  }

  const startedAt = Date.now();
  console.log(`[render] starting job=${job.videoId} scenes=${job.scenes.length} aspectRatio=${job.aspectRatio}`);
  try {
    const result = await renderJob(job);
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[render] done job=${job.videoId} ok=${result.ok} elapsed=${elapsedSec}s`);
    res.json(result);
  } catch (e: any) {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.error(`[render] threw job=${job.videoId} elapsed=${elapsedSec}s err=`, e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * POST /extract-frames
 * Pulls keyframes from a Drive MP4 for AI vision analysis.
 * Body: { sourceVideoDriveFileId, intervalSec?, serviceAccountJson }
 */
app.post("/extract-frames", requireSharedSecret, async (req, res) => {
  const body = req.body || {};
  if (!body.sourceVideoDriveFileId || !body.serviceAccountJson) {
    res.status(400).json({ ok: false, error: "sourceVideoDriveFileId and serviceAccountJson required" });
    return;
  }
  const startedAt = Date.now();
  console.log(`[frames] starting extraction sourceFile=${body.sourceVideoDriveFileId}`);
  try {
    const result = await extractFrames({
      sourceVideoDriveFileId: body.sourceVideoDriveFileId,
      intervalSec: body.intervalSec,
      serviceAccountJson: body.serviceAccountJson,
    });
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[frames] done ok=${result.ok} frames=${result.frames?.length || 0} elapsed=${elapsedSec}s`);
    // Don't echo frames count back if it's large — but the actual frames go in the body
    res.json(result);
  } catch (e: any) {
    console.error("[frames] threw:", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`[server] training-render-worker listening on :${PORT}`);
});
