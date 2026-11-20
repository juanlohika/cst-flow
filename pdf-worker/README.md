# PDF Compress Worker

Backs **AI Tools › PDF Compressor** in CST OS. Shrinks scanned PDFs with Ghostscript. No AI and no paid API.
Tested on 32 real scanned contracts: 2.7 GB in total became 40 MB (111 MB → 1.5 MB, about 2 seconds per file).

## How it works

Files are often 100 MB or more. Cloud Run (and so CST OS on App Hosting) rejects request bodies over 32 MiB,
so the file never passes through CST OS:

1. The page asks CST OS for an upload URL. CST OS checks the Google sign-in, then asks the worker, which
   returns a signed `PUT` URL for `gs://cst-flowdesk-pdf-temp/in/<jobId>.pdf` (valid 30 minutes).
2. The browser uploads the PDF straight to that URL, with a progress bar.
3. The page asks CST OS to compress. The worker downloads the file, runs Ghostscript, uploads
   `out/<jobId>.pdf`, **deletes the original**, and returns the sizes plus a signed download URL (30 minutes).
4. The bucket deletes everything older than 1 day.

Phone scans store each page as a photo on a page of about 27 × 45 in. When page 1 is more than 1.3 × A4,
pages are fitted onto A4 so downsampling applies. Normal-size PDFs keep their page size.
Presets: small 100 dpi (default), standard 150 dpi, high 300 dpi.

## Security

- Page and API routes: CST OS Google sign-in (allowed domains only).
- Worker: Cloud Run IAM (`--no-allow-unauthenticated`, invoker = CST OS's service account) plus `X-Worker-Secret`.
- Bucket: private, public access prevention on, uniform access, CORS only for the CST OS origin, 1-day delete.
- Logs hold metadata only (user, file name, sizes, duration), never file contents.
- Ghostscript runs with `-dSAFER`. Ghostscript is AGPL; this internal, unmodified use is fine.

## Deploy

One-time setup and every later update: `cd ~/cst-flow && bash pdf-worker/deploy.sh`.
Then make sure `apphosting.yaml` has `PDF_WORKER_URL` (the printed URL) and `PDF_WORKER_SECRET`
(`secret: pdf-worker-secret`). Pushing to `main` redeploys CST OS.

Logs: `gcloud run services logs read pdf-compress-worker --region asia-east1 --limit 50`
