# Chrome Web Store publishing

[中文](./chrome-webstore-publishing.zh-CN.md)

The `Publish Chrome extension` workflow checks the store after relevant merges
to `main`. A newer `my-browser/extension/manifest.json` version is built using
`scripts/build-my-browser.mjs`, uploaded, and submitted for Google review with
automatic publication after approval. Installed Chrome extensions then receive
updates through Chrome's normal update mechanism; this does not force an instant
update or bypass Google review. The Cindy plugin's `ghost.json` version is separate.

An existing pending review is preserved. A six-hour scheduled check submits the
latest main version once the earlier review is finished. Identical/older versions
are skipped. Staged releases, warnings, takedowns, and rejected/cancelled versions
require dashboard attention; a corrected release needs a higher version. Manual
dispatch is supported from `main` only. API write failures are not blindly retried:
inspect the dashboard when the outcome is unknown before rerunning.

## One-time setup

Use a dedicated Google Cloud project. No service account key or OAuth refresh
token is needed. With an administrator signed into `gcloud`, run:

```sh
# A new project need not be linked to a billing account for this setup.
gcloud projects create YOUR_PROJECT_ID --name='Cindy Chrome Publishing'
bash .github/scripts/setup-chrome-webstore.sh YOUR_PROJECT_ID \
  makecindy/cindy-official-plugins 1309858579 306974279
```

The setup script is for first-time provisioning. It stops on failure; if partially
completed, inspect the existing resources and resume the remaining commands.
It enables the APIs and creates a service account plus a Workload Identity
Federation provider. The provider accepts only this numeric repository/owner ID,
the exact publishing workflow on `main`, and the `chrome-webstore` environment.
The service account receives no project-wide resource roles. GitHub can only
impersonate this account using `roles/iam.workloadIdentityUser`.

In Chrome Web Store **publisher Settings → Service account**, add the printed
service account email. This is a publisher-wide permission; Google allows one
service account per publisher. Do not replace an existing account without checking
its consumers. The workflow targets only the configured extension.

Create a GitHub environment named `chrome-webstore`, restrict deployment branches
to `main`, and set these environment variables (not secrets):

| Variable | Value |
| --- | --- |
| `CWS_SERVICE_ACCOUNT` | Setup script output |
| `CWS_WORKLOAD_IDENTITY_PROVIDER` | Setup script output |
| `CWS_PUBLISHER_ID` | Publisher ID from the developer dashboard |
| `CWS_EXTENSION_ID` | Existing 32-character extension ID, matching `my-browser/distribution.json` |

Retain the repository's PR/branch protection. The check/publish jobs use a
short-lived scoped access token. Dependency builds run in a separate job without
OIDC or Google credentials. Only artifacts from the current run are downloaded;
the publisher checks source commit, SHA-256, and the ZIP manifest before upload.
The credentialed jobs run only the trusted release helper, never extension code.

## First run and maintenance

After merging the workflow, manually dispatch it from `main` and inspect the
Actions summary. If the current version is already pending/published, the expected
result is a skip with no upload. Verify the next genuinely newer version in the
developer dashboard as well. Tests use mocked API responses and do not establish
that live Google authorization works.

Bump the extension manifest version whenever its store package changes; bump the
plugin version too when packaged plugin content changes. PR verification enforces
the Chrome version bump for extension source, dependency configuration, license,
and Chrome build-script changes, including the shared `package-plugin.sh` and
`binary-dependencies.py` packagers that generate bundled vendor resources. Store description,
screenshots, privacy declarations, and new permission justifications still need
the developer dashboard. Keep these current before automatic submission. The
workflow does not edit them, cancel a review, or release a deliberately staged item.

References: [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api),
[service accounts](https://developer.chrome.com/docs/webstore/service-accounts),
[Google GitHub authentication](https://github.com/google-github-actions/auth).
