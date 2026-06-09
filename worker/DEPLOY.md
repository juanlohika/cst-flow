# Training Video Worker — One-Time Deploy

This is what you run **once** to bring the Cloud Run worker live. Future updates are a single command (`gcloud run deploy` again).

> Estimated time: **15-20 minutes**.

## Before you start

You need:
- A Mac/Windows machine with terminal access
- Your existing Google Cloud project `moi-cst-app` (or whatever your `arima-brd-writer@...` service account lives in)
- The service account credentials are already configured in CST OS (you set them up for BRD)
- The `gcloud` CLI installed: <https://cloud.google.com/sdk/docs/install> (5-min install)

## Step 1 — gcloud setup (one-time)

```bash
# Sign in (opens a browser tab)
gcloud auth login

# Pick the project
gcloud config set project moi-cst-app

# Enable the required APIs (free, takes ~30s)
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

If you see permission errors at any step, you need the **Cloud Run Admin** + **Cloud Build Editor** + **Service Account User** roles on the project. Ask whoever owns the GCP project to grant them.

## Step 2 — Generate a shared secret

```bash
openssl rand -hex 32
```

This prints a 64-character hex string. **Copy it somewhere safe** — you'll paste it twice in Step 3 and Step 5.

Example output: `8a7c4e2b9d3f1a6e0c5b4d2f8e3a1c7b9d2e5f0a8c3b6d4f2e1a9c8b7d3e6f0a`

## Step 3 — Deploy the worker

From the repo root (`cd /Users/tarkielester/cst-flow`):

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
  --set-env-vars WORKER_SECRET=PASTE_YOUR_SECRET_HERE
```

Replace `PASTE_YOUR_SECRET_HERE` with the hex string from Step 2.

The first deploy takes **5-10 minutes** (Cloud Build pulls a Node base image, installs ffmpeg + LibreOffice + poppler-utils, fetches Quicksand, etc.). When it succeeds you'll see something like:

```
Service [training-render-worker] revision [training-render-worker-00001-xyz] has been deployed and is serving 100 percent of traffic.
Service URL: https://training-render-worker-xxxx-as.a.run.app
```

**Copy that Service URL.** You need it for Step 5.

## Step 4 — Grant the service account permission to invoke the worker

CST OS calls the worker using its existing Drive service account. We need to grant that account the `Cloud Run Invoker` role on the new worker so Cloud Run accepts the calls.

```bash
gcloud run services add-iam-policy-binding training-render-worker \
  --region asia-east1 \
  --member="serviceAccount:arima-brd-writer@moi-cst-app.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

(Replace the service account email if yours is different.)

## Step 5 — Tell CST OS about the worker

CST OS reads two env vars to know where the worker is and how to authenticate:

- `TRAINING_RENDER_WORKER_URL` — the Service URL from Step 3
- `TRAINING_RENDER_WORKER_SECRET` — the secret from Step 2 (same value as `WORKER_SECRET` on the worker)

### Set them via Firebase App Hosting

In the Firebase console:
1. App Hosting → your backend → Settings → Environment
2. Add two variables:
   - `TRAINING_RENDER_WORKER_URL` = `https://training-render-worker-xxxx-as.a.run.app` (paste your Service URL)
   - `TRAINING_RENDER_WORKER_SECRET` = the hex secret

Save. App Hosting will redeploy CST OS with the new env vars (~3-5 min).

### Or via apphosting.yaml + push

Alternative: add them to `apphosting.yaml` in the repo. The secret should go in Secret Manager (not committed). Either approach works.

## Step 6 — Verify

Once CST OS has redeployed:

1. Open `/training-videos` in your browser
2. Upload a small PPTX (3-5 slides — start tiny so the test is fast)
3. Wait for generation to finish (~1-2 min)
4. Click **Render MP4**
5. Wait ~1-2 min (the worker downloads scene audios + slides, renders, uploads)
6. Click **Open MP4** when the status flips to "MP4 ready"

You should see the final video in Drive with:
- Tarkie-style burned-in captions (Quicksand, white, dark outline, lower-third)
- Charon-voiced narration over each slide
- Vertical or horizontal aspect based on what you picked

## Future updates

After any change to `worker/` code, run the same deploy command (no need to redo secrets or IAM):

```bash
gcloud run deploy training-render-worker --source ./worker --region asia-east1
```

Cloud Build incrementally rebuilds. Usually 1-3 min for subsequent deploys.

## Logs and debugging

```bash
# Tail recent logs
gcloud run services logs read training-render-worker --region asia-east1 --limit 50

# Service health
gcloud run services describe training-render-worker --region asia-east1
```

If a render fails, the error message bubbles up to the `/training-videos` UI (red banner under the top bar) AND lands in the `renderError` column on the TrainingVideo row.

## Cost expectations

Cloud Run free tier per month:
- 180,000 vCPU-seconds
- 360,000 GiB-seconds
- 2,000,000 requests

At 30 videos/month × 60s of vCPU each × 2 vCPU = 3,600 vCPU-seconds (2% of free tier).

You'd need to render **1,500+ videos/month** before any cost. We're not going to hit that.

## Removing the worker (if you ever need to)

```bash
gcloud run services delete training-render-worker --region asia-east1
```

The CST OS side gracefully falls back to "no rendering available" — the bundle download still works.
