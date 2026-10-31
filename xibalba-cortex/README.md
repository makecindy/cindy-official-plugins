# Xibalba Cortex for Cindy

Connect Cindy to your own [Xibalba Cortex](https://github.com/XibalbaTechSol/xibalba-cortex) memory backend. This optional plugin provides memory tools and separately enabled recording, read-only saved-history capture, bounded file snapshots, activity metadata, diagnostics, and coverage audits.

See the [comprehensive setup and reference](https://github.com/XibalbaTechSol/cortex-cindy#readme), [source and tests](https://github.com/XibalbaTechSol/cortex-cindy), and [GitHub downloads](https://github.com/XibalbaTechSol/cortex-cindy/releases).

## Setup and data boundaries

- Requires Cindy 0.1.115 or later and a separately installed/configured Cortex backend. Local capture is Linux-tested; Windows and macOS are not verified.
- Local executable and profile paths start empty. Select your own profile and DID, then test the connection. Explicit memory tools also support a user-configured HTTPS MCP endpoint and vault-managed bearer token.
- Recording, history capture, file snapshots, and activity metadata start disabled. Opt in separately. No private model reasoning text is captured.
- History capture reads only an explicitly selected Cindy SQLite database and archives supported saved records to the chosen local Cortex profile. It does not modify the source database. File snapshots follow explicit references without crawling directories; original bytes are not secret-redacted.
- The Node worker launches the configured absolute Cortex executable without a shell, and uses its installed Python interpreter for the bundled capture helpers. It does not install or download executables at runtime. Hosted requests go only to the HTTPS endpoint you configure; redirects are rejected.
- No third-party OAuth scopes or Cindy-host OAuth grants are used. No backend, database, profile, credentials, or third-party Node dependencies are bundled.

Author: Xibalba Solutions LLC. Upstream MIT notice is preserved in `UPSTREAM-LICENSE.txt`; contributions to this official repository follow its Apache-2.0 contribution terms. Marketplace availability requires registry review and release approval.

## Review fixes in 0.3.4

Memory and opt-in capture capabilities remain available. File traversal rejects symlinks at every directory component using held directory descriptors. Explicit memory writes report known or unknown outcomes and require reconciliation before uncertain retries. All plugin-owned settings mutations use the resident writer; versioned page saves reject stale edits, while configuration checks preserve a concurrent pause. Successful snapshots survive later missing/error attempts and remain independently auditable. File work resumes within a message under a cooperative sweep budget and reuses unchanged successful snapshots after a secure metadata check. Individual blocked OS/backend operations cannot be preempted by that cooperative budget.

## Credential coordination in 0.3.5

Settings pages and resident tools use the same origin-wide Web Lock. Settings revisions are checked before any write-only vault change, including token removal; rejected stale windows leave the live token untouched. Hosted calls hold the same lock through credential injection and response, so a waiting settings change commits after an in-flight hosted call settles. No token is sent through KV, BroadcastChannel, or tool arguments. A durable boolean `credentialPending` marker blocks hosted calls if a vault/configuration operation loses confirmation; reload, review the endpoint and explicitly save/remove the token to recover. Missing Web Locks produce an upgrade prompt and fail closed for coordinated writes/hosted calls; configured local memory reads remain usable. The exact package still needs released-Cindy client verification.

In 0.3.6, editable controls and mutation buttons are disabled while a save/removal is queued or running; duplicate handlers do nothing. Controls are restored on success or failure. This keeps the submitted endpoint paired with its token throughout a lock wait. The connection-test button retains its independent read-only busy state.
