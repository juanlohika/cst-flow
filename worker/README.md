# Training Render Worker

A small Docker service that takes a render job from CST OS and produces a final MP4 with burned-in captions, then uploads to Drive.

Designed to run on **Google Cloud Run free tier** — $0/month at internal CST volume.

## Architecture

```
CST OS (/api/training-videos/[id]/render-mp4)
   │  HTTP POST with X-Worker-Secret header
   │  body: { videoId, title, outputFolderId, aspectRatio, scenes[], serviceAccountJson }
   ▼
training-render-worker (this service, on Cloud Run)
   │  Downloads scene audios + source PPTX/MP4 from Drive
   │  Renders each scene as an MP4 segment (ffmpeg)
   │  Burns captions (Quicksand, white + dark outline)
   │  Concatenates + uploads final MP4 to the per-video Drive folder
   ▼
returns { ok, mp4DriveFileId, mp4DriveUrl, durationSec }
```

The worker is stateless. Authentication is a shared secret in the `WORKER_SECRET` env var.

## Tech stack

| Component | Why |
|---|---|
| **Node 20** | Same as CST OS for consistency |
| **Express** | Minimal HTTP server |
| **ffmpeg** | Video encoding + caption burn-in via libass |
| **LibreOffice** (`soffice`) | PPTX → PDF conversion |
| **poppler-utils** (`pdftoppm`) | PDF → per-slide PNG rasterization |
| **Quicksand font** | Matches Tarkie brand (fetched from Google Fonts at build time) |
| **googleapis** | Drive client (uploads MP4, downloads scene audio) |

## Local development

```bash
cd worker
npm install
WORKER_SECRET=dev-secret npm run dev
```

The worker listens on `:8080`. Test with:

```bash
curl http://localhost:8080/healthz
# {"ok":true,"service":"training-render-worker"}
```

To test rendering end-to-end locally you'd need a render job payload — easier to wait until Wave 3 wires CST OS to call it, then iterate from the real flow.

## Deployment (one-time setup)

### Prerequisites

1. A Google Cloud project with billing enabled (free tier is enough — Cloud Run gives you 2M requests + 360k GiB-seconds + 180k vCPU-seconds free per month). For CST OS, this is the `cst-flowdesk` project where Firebase App Hosting already runs.
2. `gcloud` CLI installed locally: <https://cloud.google.com/sdk/docs/install>
3. Authenticated: `gcloud auth login` (sign in as the account that owns `cst-flowdesk`, typically `lestersalesalarcon@gmail.com`) and `gcloud config set project cst-flowdesk`

Note: the worker DEPLOYS to `cst-flowdesk` but USES the service account `arima-brd-writer@moi-cst-app.iam.gserviceaccount.com` (which lives in a different project). The cross-project IAM grant is documented in DEPLOY.md step 4.

### Enable required APIs

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

### Pick a region

Closer to your CST OS deployment = faster Drive transfers. Your CST OS is in `asia-east1` (per `apphosting.yaml`), so use the same region.

### Generate a strong worker secret

```bash
openssl rand -hex 32
# e.g. "8a7c4e2..."  ← save this; you'll paste it twice below
```

### Deploy from the repo

From the repo root:

```bash
gcloud run deploy training-render-worker \
  --source ./worker \
  --region asia-east1 \
  --no-allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 600 \
  --concurrency 1 \
  --max-instances 5 \
  --set-env-vars WORKER_SECRET=YOUR_SECRET_HERE
```

What the flags do:

| Flag | Why |
|---|---|
| `--source ./worker` | Builds from the worker/ folder using Cloud Build |
| `--no-allow-unauthenticated` | Forces auth — only CST OS (with the shared secret) can invoke |
| `--memory 2Gi` `--cpu 2` | ffmpeg + LibreOffice need a bit of headroom |
| `--timeout 600` | 10-minute max per request — enough for ~5-minute videos |
| `--concurrency 1` | One render at a time per instance (CPU-bound) |
| `--max-instances 5` | Cap at 5 parallel renders to control cost spikes |

The first deploy can take 5-10 minutes (Cloud Build pulls the base image, installs ffmpeg + LibreOffice, etc.). Subsequent deploys reuse cached layers and run in 1-3 minutes.

### Set the URL + secret in CST OS

After deploy, `gcloud` prints the worker URL — looks like `https://training-render-worker-xxxx-as.a.run.app`.

In your CST OS environment (apphosting.yaml or App Hosting console), add two env vars:

```yaml
- variable: TRAINING_RENDER_WORKER_URL
  value: "https://training-render-worker-xxxx-as.a.run.app"
- variable: TRAINING_RENDER_WORKER_SECRET
  secret: TRAINING_RENDER_WORKER_SECRET   # same value as WORKER_SECRET above
```

The `TRAINING_RENDER_WORKER_SECRET` is the same value you set in `--set-env-vars WORKER_SECRET=` on Cloud Run. Both ends must match.

### Verify

```bash
curl https://training-render-worker-xxxx-as.a.run.app/healthz
# 401 — expected, /render now requires auth
```

To actually authenticate from outside Cloud Run, use a Google identity token:

```bash
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
     https://training-render-worker-xxxx-as.a.run.app/healthz
# {"ok":true,"service":"training-render-worker"}
```

CST OS will authenticate the same way when calling `/render`.

### Subsequent updates

Just re-run the deploy command. Cloud Build incrementally rebuilds the image and Cloud Run rolls out the new revision atomically.

## Cost expectations

At our internal volume (say 30 videos/month, average 90s output, ~60s render time):
- vCPU time: 30 × 60 × 2 = 3,600 vCPU-seconds. Free tier = 180,000.
- Memory time: 30 × 60 × 2 = 3,600 GiB-seconds. Free tier = 360,000.
- Requests: 30. Free tier = 2,000,000.

You'd need to render **1,500+ videos/month** before hitting any cost. We won't approach that.

## Operational notes

- Cold starts: the first request after idle takes ~10 seconds to spin up (image is ~600MB with LibreOffice). Subsequent requests are warm.
- Logs: `gcloud run services logs read training-render-worker --region asia-east1`
- Errors: failures bubble up as JSON to the calling CST OS request. The TrainingVideo row's `renderError` column captures the message.
- Resource ceiling: 2Gi RAM + 2 vCPU handles 1080×1920 60fps fine. If we go to 4K or longer-than-5-min videos, bump memory.
