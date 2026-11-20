/**
 * PDF Compress Worker — HTTP entrypoint (Cloud Run, --no-allow-unauthenticated).
 *
 * Big uploads (100 MB+) cannot pass through CST OS or Cloud Run request bodies
 * (32 MiB limit), so files travel through a private, short-lived GCS bucket:
 *
 *   1. POST /pdf/upload-url  -> signed PUT URL (browser uploads straight to GCS)
 *   2. POST /pdf/compress    -> download, Ghostscript, upload result, delete
 *                               input, return sizes + a signed download URL
 *
 * Auth: Cloud Run IAM (identity token) + X-Worker-Secret, same as the
 * training-render-worker. The bucket also has a 1-day lifecycle delete rule.
 */
import express from "express";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { compressFile, QUALITY_PRESETS, UserFacingError, type Quality } from "./compress.js";

const PORT = Number(process.env.PORT) || 8080;
const BUCKET = process.env.PDF_BUCKET || "cst-flowdesk-pdf-temp";
const MAX_BYTES = 200 * 1024 * 1024;
const URL_TTL_MS = 30 * 60 * 1000;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const storage = new Storage();
const bucket = storage.bucket(BUCKET);
const app = express();
app.use(express.json({ limit: "100kb" }));

function requireSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expected = process.env.WORKER_SECRET;
  if (!expected) return void res.status(500).json({ ok: false, error: "Worker not configured (WORKER_SECRET missing)" });
  if (req.header("x-worker-secret") !== expected) return void res.status(401).json({ ok: false, error: "Invalid worker secret" });
  next();
}

function outputName(original: string, quality: Quality) {
  const base = path.basename(original || "document.pdf").replace(/\.pdf$/i, "").replace(/[\s.]+$/, "");
  const safe = base.replace(/[^\w.\- ()&,']+/g, "_").slice(0, 150) || "document";
  return `${safe}_compressed_${QUALITY_PRESETS[quality].dpi}dpi.pdf`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "pdf-compress-worker" });
});

app.post("/pdf/upload-url", requireSecret, async (req, res) => {
  const { fileName, size } = req.body || {};
  if (typeof fileName !== "string" || !/\.pdf$/i.test(fileName)) {
    return void res.status(400).json({ ok: false, error: "Only PDF files are accepted." });
  }
  if (typeof size !== "number" || size <= 0 || size > MAX_BYTES) {
    return void res.status(400).json({ ok: false, error: "The file must be a PDF up to 200 MB." });
  }
  const jobId = randomUUID();
  try {
    const [uploadUrl] = await bucket.file(`in/${jobId}.pdf`).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + URL_TTL_MS,
      contentType: "application/pdf",
    });
    res.json({ ok: true, jobId, uploadUrl });
  } catch (e: any) {
    console.error("[pdf] sign upload url failed:", e?.message);
    res.status(500).json({ ok: false, error: "Could not prepare the upload. Please try again." });
  }
});

app.post("/pdf/compress", requireSecret, async (req, res) => {
  const { jobId, fileName } = req.body || {};
  const quality: Quality = req.body?.quality in QUALITY_PRESETS ? req.body.quality : "small";
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) {
    return void res.status(400).json({ ok: false, error: "Invalid job." });
  }
  const inFile = bucket.file(`in/${jobId}.pdf`);
  const outFile = bucket.file(`out/${jobId}.pdf`);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-"));
  const input = path.join(workDir, "in.pdf");
  const output = path.join(workDir, "out.pdf");
  const started = Date.now();
  try {
    const [exists] = await inFile.exists();
    if (!exists) return void res.status(404).json({ ok: false, error: "The upload was not found. Please upload the file again." });
    const [meta] = await inFile.getMetadata();
    if (Number(meta.size) > MAX_BYTES) throw new UserFacingError("The file must be a PDF up to 200 MB.");

    await inFile.download({ destination: input });
    const fh = await fs.open(input, "r");
    const head = Buffer.alloc(5);
    await fh.read(head, 0, 5, 0);
    await fh.close();
    if (head.toString("latin1") !== "%PDF-") throw new UserFacingError("This file is not a valid PDF.");

    const originalBytes = (await fs.stat(input)).size;
    const { pages, resizedToA4 } = await compressFile(input, output, quality);
    let compressedBytes = (await fs.stat(output)).size;
    const keptOriginal = compressedBytes >= originalBytes;
    const resultPath = keptOriginal ? input : output;
    if (keptOriginal) compressedBytes = originalBytes;

    const name = outputName(String(fileName || "document.pdf"), quality);
    await bucket.upload(resultPath, { destination: outFile.name, contentType: "application/pdf", resumable: false });
    const [downloadUrl] = await outFile.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + URL_TTL_MS,
      responseDisposition: `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      responseType: "application/pdf",
    });

    console.log(JSON.stringify({
      event: "pdf_compress", jobId, quality, pages, originalBytes, compressedBytes,
      resizedToA4: resizedToA4 && !keptOriginal, keptOriginal, ms: Date.now() - started,
    }));
    res.json({
      ok: true, fileName: name, downloadUrl, pages, originalBytes, compressedBytes,
      resizedToA4: resizedToA4 && !keptOriginal, keptOriginal,
    });
  } catch (e: any) {
    const userMsg = e instanceof UserFacingError ? e.message : "Compression failed. Please try again.";
    if (!(e instanceof UserFacingError)) console.error(`[pdf] job=${jobId} failed:`, e?.message);
    res.status(e instanceof UserFacingError ? 422 : 500).json({ ok: false, error: userMsg });
  } finally {
    await inFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

app.listen(PORT, () => console.log(`pdf-compress-worker listening on ${PORT} (bucket ${BUCKET})`));
