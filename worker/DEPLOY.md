# Training Video Worker — One-Time Deploy

This is what you run **once** to bring the Cloud Run worker live. Future updates are a single command.

> Estimated time: **15-20 minutes**.

## Your project setup (verified)

You have two Google accounts / two GCP projects involved:

| What | Where | Account |
|---|---|---|
| **CST OS web app** (Firebase App Hosting + Cloud Run under the hood) | GCP project `cst-flowdesk` | `lestersalesalarcon@gmail.com` |
| **Service account `arima-brd-writer`** (used for Drive access) | GCP project `moi-cst-app` | `lester.alarcon@mobileoptima.com` |

**The worker deploys to `cst-flowdesk`** (same project as CST OS) **but uses the `arima-brd-writer@moi-cst-app...` service account** that already has Drive access. This is a cross-project setup — totally normal and supported.

Throughout these steps you'll be logged in as **`lestersalesalarcon@gmail.com`** for gcloud.

## Before you start

You need:
- The `gcloud` CLI installed: <https://cloud.google.com/sdk/docs/install>
  - On Mac: `brew install --cask google-cloud-sdk`
- Billing enabled on the `cst-flowdesk` project. If your Firebase App Hosting is already deployed (it is), billing is enabled — no action needed.

## Step 1 — gcloud setup

```bash
# Sign in with the account that owns cst-flowdesk (opens browser)
gcloud auth login
# In the browser, pick lestersalesalarcon@gmail.com

# Point gcloud at the right project
gcloud config set project cst-flowdesk

# Enable the APIs the worker needs (free to enable, ~30s)
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Verify you're in the right place:

```bash
gcloud config list
# Should show:
# account = lestersalesalarcon@gmail.com
# project = cst-flowdesk
```

If you see different values, run `gcloud auth login` again and pick the right account.

## Step 2 — Generate a shared secret

```bash
openssl rand -hex 32
```

Prints a 64-character hex string. **Copy it somewhere safe** — you'll paste it twice: once in Step 3 (worker side) and once in Step 5 (CST OS side).

Example: `8a7c4e2b9d3f1a6e0c5b4d2f8e3a1c7b9d2e5f0a8c3b6d4f2e1a9c8b7d3e6f0a`

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

First deploy takes **5-10 minutes** — Cloud Build downloads a Node 20 base image, installs ffmpeg + LibreOffice + poppler, fetches Quicksand. Subsequent deploys are 1-3 minutes (cached layers).

When successful you'll see:

```
Service [training-render-worker] revision [training-render-worker-00001-xyz] has been deployed and is serving 100 percent of traffic.
Service URL: https://training-render-worker-xxxx-as.a.run.app
```

**Copy that Service URL.** You'll paste it in Step 5.

### Common errors

- **"permission denied"** → Run `gcloud auth login` again. You need to be `lestersalesalarcon@gmail.com`.
- **"billing not enabled"** → Unusual since Firebase App Hosting requires billing. Visit <https://console.cloud.google.com/billing?project=cst-flowdesk> to add a billing account.
- **"asia-east1 not available"** → Try `asia-southeast1` (Singapore) instead.

## Step 4 — Grant the service account permission to invoke the worker

This is a **cross-project IAM grant**: we tell the worker (in `cst-flowdesk`) to accept calls from a service account that lives in `moi-cst-app`.

```bash
gcloud run services add-iam-policy-binding training-render-worker \
  --region asia-east1 \
  --member="serviceAccount:arima-brd-writer@moi-cst-app.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

If you get a "service account does not exist" error, double-check the SA email — go to `/admin/google-integration` in CST OS to see exactly what's configured (yours is `arima-brd-writer@moi-cst-app.iam.gserviceaccount.com` per the integration page).

## Step 5 — Tell CST OS about the worker

Add two env vars to your Firebase App Hosting deployment:

- `TRAINING_RENDER_WORKER_URL` = the Service URL from Step 3 (e.g. `https://training-render-worker-xxxx-as.a.run.app`)
- `TRAINING_RENDER_WORKER_SECRET` = the hex secret from Step 2 (same value as `WORKER_SECRET` on the worker)

### How to set them

In Firebase Console (signed in as `lestersalesalarcon@gmail.com`):
1. Go to **App Hosting** → pick the `cst-flow` backend → **Settings** → **Environment variables**
2. Add `TRAINING_RENDER_WORKER_URL` with the worker URL
3. Add `TRAINING_RENDER_WORKER_SECRET` with the hex secret (set as a secret, not plain text)
4. Save → App Hosting will redeploy CST OS automatically (~3-5 min)

Alternative: edit `apphosting.yaml` in the repo and push — but secrets shouldn't be committed, so the Firebase Console path is cleaner for the secret.

## Step 6 — Verify end-to-end

Once CST OS redeploys:

1. Open `/training-videos` in CST OS
2. Pick **PowerPoint** mode and upload a small PPTX (3-5 slides)
3. Wait ~1-2 min for script + voiceover generation
4. Click **Render MP4**
5. Wait ~1-2 min for the render to complete
6. Click **Open MP4** when the status flips to "MP4 ready"

You should see a video in Drive with:
- Tarkie-styled burned-in captions (Quicksand white + dark outline, lower third)
- Charon-voiced narration over each slide
- Vertical 1080×1920 by default

## Future updates

Any code change to `worker/` re-deploys with one command — no need to redo secrets or IAM:

```bash
gcloud run deploy training-render-worker --source ./worker --region asia-east1
```

Cloud Build picks up cached layers, so subsequent deploys are 1-3 minutes.

## Operational commands

```bash
# Tail recent logs (useful when debugging a failed render)
gcloud run services logs read training-render-worker --region asia-east1 --limit 50

# Inspect service config
gcloud run services describe training-render-worker --region asia-east1

# See current revisions
gcloud run revisions list --service training-render-worker --region asia-east1
```

If a render fails, the error message bubbles up to the `/training-videos` UI in a red banner, AND lands in the `renderError` column on the TrainingVideo DB row.

## Cost expectations

Cloud Run free tier per month:
- 180,000 vCPU-seconds
- 360,000 GiB-seconds
- 2,000,000 requests

At 30 videos/month × 60s of vCPU each × 2 vCPU = 3,600 vCPU-seconds (2% of free tier).

You'd need to render **1,500+ videos/month** before any cost. We won't approach that.

## Removing the worker (if ever needed)

```bash
gcloud run services delete training-render-worker --region asia-east1
```

CST OS gracefully falls back — the bundle download still works, just no MP4 render.
