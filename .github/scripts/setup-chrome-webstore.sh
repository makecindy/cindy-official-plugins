#!/usr/bin/env bash
# One-time administrator setup, never run by the release workflow.
set -euo pipefail
project="${1:?Usage: setup-chrome-webstore.sh PROJECT REPOSITORY REPOSITORY_ID OWNER_ID}"
repository="${2:?Missing owner/repository}"
repository_id="${3:?Missing numeric repository ID}"
owner_id="${4:?Missing numeric owner ID}"
[[ "$project" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$repository_id" =~ ^[0-9]+$ && "$owner_id" =~ ^[0-9]+$ ]]
service_account="chrome-webstore@${project}.iam.gserviceaccount.com"
project_number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
[[ "$project_number" =~ ^[0-9]+$ ]]
pool="projects/${project_number}/locations/global/workloadIdentityPools/chrome-webstore"

gcloud services enable chromewebstore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$project" --quiet
gcloud iam service-accounts create chrome-webstore --project="$project" --display-name='Chrome Web Store publisher' --quiet
gcloud iam workload-identity-pools create chrome-webstore --project="$project" --location=global --display-name='Chrome Web Store GitHub' --quiet
gcloud iam workload-identity-pools providers create-oidc github --project="$project" --location=global --workload-identity-pool=chrome-webstore \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref' \
  --attribute-condition="assertion.repository_id == '${repository_id}' && assertion.repository_owner_id == '${owner_id}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '${repository}/.github/workflows/publish-chrome-extension.yml@refs/heads/main' && assertion.sub == 'repo:${repository}:environment:chrome-webstore'" --quiet
# Use the canonical project number; newly created pool reads can lag propagation.
gcloud iam service-accounts add-iam-policy-binding "$service_account" --project="$project" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${pool}/attribute.repository_id/${repository_id}" --quiet
printf 'CWS_SERVICE_ACCOUNT=%s\n' "$service_account"
printf 'CWS_WORKLOAD_IDENTITY_PROVIDER=%s/providers/github\n' "$pool"
