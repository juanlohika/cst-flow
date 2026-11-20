#!/usr/bin/env bash
# One-time setup + deploy for the PDF Compress Worker (CST OS › AI Tools › PDF Compressor).
# Safe to re-run: every step skips what already exists.
#
#   cd ~/cst-flow && bash pdf-worker/deploy.sh
#
# Needs gcloud signed in as the owner of the cst-flowdesk project.
set -euo pipefail

P=cst-flowdesk
REGION=asia-east1
SVC=pdf-compress-worker
SA="$SVC@$P.iam.gserviceaccount.com"
BUCKET=cst-flowdesk-pdf-temp
SECRET=pdf-worker-secret
CALLER="serviceAccount:arima-brd-writer@moi-cst-app.iam.gserviceaccount.com"   # CST OS's Google service account
APPHOSTING_SA="serviceAccount:firebase-app-hosting-compute@$P.iam.gserviceaccount.com"
ORIGIN="https://cst-flow--cst-flowdesk.asia-east1.hosted.app"
G="${GCLOUD:-gcloud}"

$G config set project "$P" >/dev/null
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "1/6 Service account"
$G iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  $G iam service-accounts create "$SVC" --display-name="PDF Compress Worker (CST OS AI Tools)"

echo "2/6 Private temp bucket (files auto-deleted after 1 day)"
$G storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  $G storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' > "$tmp/lifecycle.json"
echo "[{\"origin\":[\"$ORIGIN\"],\"method\":[\"PUT\",\"GET\"],\"responseHeader\":[\"Content-Type\"],\"maxAgeSeconds\":3600}]" > "$tmp/cors.json"
$G storage buckets update "gs://$BUCKET" --lifecycle-file="$tmp/lifecycle.json" --cors-file="$tmp/cors.json" >/dev/null

echo "3/6 Permissions: worker may use the bucket and sign short-lived URLs"
$G storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin --format=none
$G iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" --role=roles/iam.serviceAccountTokenCreator --format=none

echo "4/6 Shared secret (generated, stored only in Secret Manager)"
if ! $G secrets describe "$SECRET" >/dev/null 2>&1; then
  openssl rand -hex 32 | tr -d '\n' | $G secrets create "$SECRET" --replication-policy=automatic --data-file=-
fi
for m in "serviceAccount:$SA" "$APPHOSTING_SA"; do
  $G secrets add-iam-policy-binding "$SECRET" --member="$m" --role=roles/secretmanager.secretAccessor --format=none
done

echo "5/6 Deploy the worker (first build takes a few minutes)"
$G run deploy "$SVC" \
  --source ./pdf-worker \
  --region "$REGION" \
  --service-account "$SA" \
  --no-allow-unauthenticated \
  --memory 2Gi --cpu 2 --timeout 600 --concurrency 2 --max-instances 3 \
  --set-env-vars "PDF_BUCKET=$BUCKET" \
  --set-secrets "WORKER_SECRET=$SECRET:latest"

echo "6/6 Let CST OS call the worker"
$G run services add-iam-policy-binding "$SVC" --region "$REGION" --member="$CALLER" --role=roles/run.invoker --format=none

URL="$($G run services describe "$SVC" --region "$REGION" --format='value(status.url)')"
echo
echo "Done. Worker URL: $URL"
echo "apphosting.yaml must have PDF_WORKER_URL=$URL and PDF_WORKER_SECRET from secret $SECRET."
