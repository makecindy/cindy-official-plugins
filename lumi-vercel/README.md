# Vercel for Lumi

Manage Vercel from a conversation: projects, deployment status, Git deployments, redeploys, bounded build logs, domains and environment variable metadata or changes.

This is an independent Lumi plugin, not an official Vercel integration. It requires Lumi 0.1.131 or later, the version used for authoring and package validation.

## Connect

1. Import `lumi-vercel-1.0.0.lumi` in Lumi's Plugins area.
2. Open the plugin settings. Follow **Create a token in Vercel**, choose the account/team you intend to manage and an expiration, then paste the access token into the settings password field.
3. Choose **Save token**, then **Test connection**. Saving and verifying are reported separately.
4. Optionally save an exact team ID and default project. Ask Lumi to list your teams if needed. Blank team means personal account. A tool can explicitly use `teamId: ""` to override a saved team with the personal account.

The Vercel token goes directly to Lumi's credential vault and is injected only into requests to `api.vercel.com`. It never enters the AI context, plugin storage, logs or a BroadcastChannel. GitHub login does not grant this plugin Vercel access.

## Ask in a conversation

- “List my Vercel projects.”
- “Show the latest deployment for this project and its build logs.”
- “Is the new deployment READY, and is it the production deployment?”
- “Redeploy this deployment.”
- “Deploy the project's main branch to preview.”
- “List environment variable names and targets without showing their values.”
- “Attach this existing domain to the project.”

Every mutation requires an explicitly named project (or new project name) and a native Lumi confirmation. Deployment mutations verify that the selected deployment belongs to that project. Receipts include the actual team scope, project and deployment ID. A submitted deployment is not reported as completed; a READY build is not assumed to be the active production target.

## Environment values

`manage_env` supports `list`, `upsert`, and `delete`. All result objects omit values, even if Vercel returns them. Listing never requests decryption.

For encrypted/sensitive values, give the tool a `value_file`: a non-hidden, relative path to a UTF-8, value-only file in the task workdir. The plugin reads the bytes through the current Agent call and sends them straight to Vercel, without returning them to the model. The file's bytes are used exactly, including a trailing newline; the file is left in place. Do not paste secret values into chat. Plain public values may use `value` directly. This first release supports Vercel's production, preview and development targets, with optional preview branch scoping; custom environments are not supported.

After a variable change, create a fresh Git deployment using `deploy_git` to build with the project's current environment. Existing deployments are unchanged. `redeploy` retains the source deployment's environment; use `deploy_git` to choose a different target.

## Limits and failure handling

- Pagination is returned explicitly; one page is never called a complete inventory.
- Build logs are finite snapshots (no following stream), capped at 500 events and 24,000 text characters. Common credential patterns are redacted, but application logs can still contain arbitrary private output.
- Only linked GitHub/GitLab projects can use `deploy_git`. This package does not upload a local source directory or install a CLI.
- Domain attachment does not purchase/register a domain or change DNS. Detaching can interrupt traffic and requires confirmation.
- Project deletion, deployment deletion, domain purchases, production promotion and rollback are outside this release.
- No automatic retries: a write timeout, incomplete response or server error can mean the action already happened. Check the target before submitting again.

## Development and verification

In the official repository, run `node --test .tests/lumi-vercel.test.mjs`. In the standalone source directory, run `node --test tests/plugin.test.mjs tests/settings.test.mjs`. The tests execute the actual plugin source in a mocked Host and cover scope selection, project/deployment mismatch, cancellation, unknown write outcomes, secret redaction, native confirmation, metadata-only results and settings credential handling. Tests are not real-account end-to-end validation.

Compatibility: the runtime uses the Lumi host bridge, with the equivalent Cindy bridge as a fallback. `minLumiVersion` records the Lumi target, while `minCindyVersion` preserves the official repository's distribution contract. Host bridge selection is covered by isolated tests; native Cindy compatibility has not been established by these tests. Runtime testing gaps are recorded in the PR verification notes.

A live Vercel account test still requires installation and a user-supplied token. Creating this package does not install it, connect an account or publish it to the marketplace.

## Sources and branding

- [Vercel REST API](https://vercel.com/docs/rest-api)
- [Official OpenAPI schema](https://openapi.vercel.sh)
- [Deployment creation and redeployment](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)
- [Build events](https://vercel.com/docs/rest-api/deployments/get-deployment-events)
- [Environment variable metadata](https://vercel.com/docs/rest-api/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name)
- [Official Vercel brand assets](https://vercel.com/geist/brands)

`assets/icon.png` is the unmodified PNG from `Vercel/icon/dark/vercel-icon-dark.png` in Vercel's official brand asset archive, linked from the page above. Vercel and related names, designs and logos are trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and other countries. Their inclusion does not imply sponsorship or endorsement.
