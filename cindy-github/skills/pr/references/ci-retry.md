# Optional recovery when CI rerun permission is denied

This is an Agent workflow using the existing GitHub tools and task shell, not
an autonomous Git worker. The plugin cannot establish branch ownership or
diagnose CI logs by itself. The Agent must establish the facts below. Unknown
facts stop recovery; do not replace them with assumptions or a checklist flag.

## Argument boundary

Treat every ref, remote, URL, node ID, SHA and path read from Git/GitHub as data.
Git ref validation does not escape shell syntax: legal refs can contain `$()`,
backticks, quotes, semicolons and ampersands. This rule applies to every command
in this workflow, including reads, reservation, signature checks and crash recovery.
Prefer the existing task tool's separate executable/argument-list interface with
no shell. Never join these arrays into command text, or use `JSON.stringify` as
shell escaping. Do not interpolate values into JavaScript source either.

If the existing tool accepts shell text only, literal-quote each **complete**
argument for that actual shell, including the whole lease option and refspec.
In POSIX shells use single-quoted literals and encode an embedded single quote
as `'\''`; in PowerShell use single-quoted literals and double embedded single
quotes (`''`). Double-quoting substituted text does not protect `$()` or backticks.
Do not apply those rules to cmd.exe, use eval/Invoke-Expression, or reparse a
constructed command. Stop if the tool/shell cannot preserve an argument exactly.
Native argument forwarding also depends on the shell version; verify the literal
round-trip when using a shell-only interface, including embedded quotes, or stop.
Keep the existing executor and authorization; do not add a Git runner.

The following defines argument data, not an executable recovery script. Bind the
identifiers from verified structured reads; never paste their contents into this
code or an unquoted shell assignment. `gatePath` is the resolved current gate
script, and `diagnosisPath` is the existing diagnosis file. Resolve the current
follower's **effective observation-cache directory** as `observationStateDir`:
its explicit `--state-dir` takes precedence over `CINDY_PR_STATE_DIR` or the
default selection. Carry that same directory in both budget commands and crash
recovery; never substitute the durable receipt directory or a fresh cache.
If the actual follower directory cannot be established, stop before any budget
operation. This preserves discovery of legacy receipts kept in custom caches;
it changes neither the durable data root nor quota. Pass the Git arrays
to `git` and the gate arrays to the already selected Node executable. The `--`
separators prevent remote data from being interpreted as Git options.

```js
// Argument lists for the existing task execution tool.
const exactRef = 'refs/heads/' + verifiedBranch;
const checkRefArgs = ['check-ref-format', exactRef];
const remoteArgs = ['ls-remote', '--heads', '--', verifiedRemote, exactRef];
const reserveArgs = [gatePath, prUrl, '--state-dir', observationStateDir,
  '--reserve-ci-retry', originalRemoteSha,
  '--ci-retry-id', prNodeId, '--ci-retry-failure', diagnosisPath, '--json'];
const statusArgs = [gatePath, prUrl, '--state-dir', observationStateDir, '--ci-retry-status',
  '--ci-retry-id', prNodeId, '--ci-retry-failure', diagnosisPath, '--json'];
const hooksPathArgs = ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'hooks'];
const graftPathArgs = ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'info/grafts'];
const replaceRefsArgs = ['--no-replace-objects', 'for-each-ref', '--format=%(refname)', 'refs/replace/'];
const shallowStateArgs = ['--no-replace-objects', 'rev-parse', '--is-shallow-repository'];
const shallowPathArgs = ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'shallow'];
const originalObjectArgs = ['--no-replace-objects', 'cat-file', 'commit', originalRemoteSha];
const replacementObjectArgs = ['--no-replace-objects', 'cat-file', 'commit', newSha];
const amendArgs = ['--no-replace-objects', 'commit', '--amend', '--no-edit', '--cleanup=verbatim'];
const verifyArgs = ['--no-replace-objects', 'verify-commit', newSha];
const originalSignatureArgs = ['--no-replace-objects', 'show', '--no-patch', '--format=%G?%n%GF%n%GP%n%GS', originalRemoteSha];
const signatureArgs = ['--no-replace-objects', 'show', '--no-patch', '--format=%G?%n%GF%n%GP%n%GS', newSha];
const pushArgs = ['push', '--force-with-lease=' + exactRef + ':' + originalRemoteSha,
  '--no-follow-tags', '--recurse-submodules=no', '--', verifiedRemote, newSha + ':' + exactRef];
```

Bind `newSha` once to the full commit SHA whose tree, parents, author, message
and required signature were verified after amend. Both signed and unsigned
paths use that same value as the push source. Never substitute `HEAD`, a local
branch or a fresh symbolic-ref lookup: the lease only protects the remote.
If local movement is observed before launch, stop and leave that work intact.
If HEAD advances after the final checks, the bound refspec still sends only
the verified object. If that object is unavailable, stop on Git's failure;
do not fall back to a symbolic source or replay the push.

### Transfer scope: the one parent ref only

The single shared `pushArgs` owns the transfer scope for signed and unsigned
recovery. Keep both `--no-follow-tags` and `--recurse-submodules=no` before `--`.
An exact parent refspec and lease do not disable either Git configuration:

| Configuration / event | Required result |
| --- | --- |
| `push.followTags=true`, reachable annotated tags | No tag transfer |
| `push.recurseSubmodules=on-demand` / `only` / `check`, or `submodule.recurse=true` | No recursive child check/push; no child or nested remote write |
| Parent update accepted | Only the verified SHA at `exactRef` is transferred |
| Parent lease rejected, transport error or unknown result | Stop; do not infer that another ref/repository was untouched from the parent result |
| Earlier attempt without either guard | Read-only reconciliation of every suspected destination; no repair push, deletion or replay |

Recursion can act on another remote before the parent lease is evaluated.
Disabling it does not publish a missing child commit: this option authorizes
only the parent PR ref, never a tag, release, submodule or nested repository.
Do not fix missing child objects by pushing them here. Explicit remote/refspec
arguments also avoid default destination/ref selection (`push.default` and
`remote.<name>.push`); require the verified single push URL as below.

This is a bounded Agent workflow, not a sandbox for arbitrary Git extensions.
Before budget status/reservation, inspect the effective push configuration. A
mirrored remote, nonempty `push.pushOption`, custom receive program capable of
extra writes or unknown behavior stops recovery. Do not change configuration
or replace a helper to make it eligible. The existing task tool remains the
only executor; no resolver, hook runner or storage is added.

### Supported checkout: no hooks or history overlays

The same eligibility boundary applies before **any Git status/object work or
budget operation**, immediately before amend, and immediately before push.
First use read-only configuration/path inspection, not a trial commit or hook.
An executable extension or object-view override outside this supported checkout,
or unknown execution effects, stops CI-only recovery; do not run it as a probe.
Any active hook makes this checkout ineligible before quota or amend.
Require the effective hooks directory to be absent or contain only inactive
Git `*.sample` files. Any non-sample entry, dispatcher, symlink, unreadable
path or uncertain activation stops this CI-only route; do not attempt to prove
arbitrary scripts harmless by running them. This covers pre-commit,
prepare-commit-msg, commit-msg, post-commit, post-rewrite, reference-transaction,
pre-push and other hooks, not just the final push hook. Use `hooksPathArgs` to
resolve Git's effective directory, including `core.hooksPath` and linked
worktrees; never assume `.git` is a directory. Require `core.fsmonitor` unset
or false too: a status/monitor command with unknown effects is not supported.
Do not disable, rename, chmod, rewrite or bypass hooks to become eligible.
Ordinary authorized fixes remain governed by their repository rules; this
restriction is for the optional CI-only recovery, not normal contribution.

Any replace ref or legacy graft makes this checkout ineligible before quota.
Require `replaceRefsArgs` to return no entries and the file at `graftPathArgs`
to be absent, including empty or unreadable graft files. A nonstandard history
namespace/file environment (including `GIT_REPLACE_REF_BASE`, `GIT_GRAFT_FILE` or `GIT_SHALLOW_FILE`)
or unknown resolution also stops recovery; do not delete/convert overlays,
change their namespace, or unset user environment to gain eligibility.

Any shallow checkout makes this checkout ineligible before quota or amend.
Require `shallowStateArgs` to succeed with exactly `false` and the Git-resolved
file at `shallowPathArgs` to be absent. `true`, missing/failed/ambiguous output,
an existing/empty/unreadable boundary file or alternate `GIT_SHALLOW_FILE`
environment all stop recovery. This excludes boundaries at HEAD **and at an
ancestor**; do not infer eligibility from one visible parent or clean status.
Recheck this same condition before any budget operation, amend and push.
`--no-replace-objects` does not disable shallow grafts: a shallow HEAD can become
a root after amend, before the later raw-parent check can stop a push. Do not
consume quota first or attempt the amend as a probe. Do not deepen/unshallow,
fetch extra history, remove/rewrite boundary files or unset the user's history
environment to qualify through this CI-only route. Ordinary authorized work
uses its normal repository workflow; this option does not repair shallow clones.

All object reads, signature checks and amend use `--no-replace-objects` with
the pinned full SHA: use the shared original/replacement object and signature
arrays and `amendArgs`. The prefix alone is not a legacy-graft bypass; absence
of all overlays and shallow boundaries is still required. The baseline is the original raw
commit payload. Parse only its header block before the first blank line,
respect continuations, and record tree, the **ordered complete parent list**,
author and message/trailers from that payload. After amend compare the raw new
payload against this same original baseline, not two replacement-aware views
or `%P`/symbolic lookups. Signature identity checks remain mandatory.

| Event | Action |
| --- | --- |
| Any effective hook, overlay, shallow state or unknown inspection before budget | Stop without budget, amend or push |
| Hook/configuration/history facts change before amend | Stop; keep any consumed receipt, no refund |
| Raw tree/parents/author differ, or a history boundary/hook appears after amend | Leave the new local commit unpushed and report; never reset user work |
| Earlier hook may already have written externally | Reconcile all suspected destinations read-only; unknown is not unexecuted |

These are Agent checks in an exclusive checkout, not an atomic filesystem lock
or protection against concurrent adversarial configuration changes. Unknown or
changed facts stop the workflow; no monitor, sandbox or automatic repair is added.

## Eligibility

All conditions must hold:

1. Read `cindy-github` / `pr_follow_settings` now. Require successful
   `settings.ci_retry_repush === true` on the computer hosting this PR task and
   checkout. Missing, false, failed or ambiguous-device reads forbid rewriting.
   Auto-follow alone, an old card event and a saved schedule prompt are not this
   authorization. Never enable the preference on the user's behalf.
2. Refresh the exact PR. Read its immutable `node_id` from `get_pull_request`
   (use `call_tool` with `raw: true`); retain that verified ID for all budget
   operations. Never derive or invent it from owner/repo, URL or PR number.
   Renaming or transferring the repository does not change this PR identity.
   It must still be open, with the same known head
   repository, branch and SHA. Read the failing job logs and identify a confirmed
   transient installation/runner/network/infrastructure failure unrelated to this
   PR's code. An `ERR_PNPM_ENOENT` string alone is insufficient: establish why the
   missing file is an environment failure, not a changed path or dependency.
   Deterministic baseline failures wait for their fix; actual code errors get a
   real fix. Do not treat unknown logs as a flake.
3. Prefer a real fix or required base merge already being prepared: batch the
   recovery with that normal push and verify CI there instead of rewriting solely
   to start another run. Do not add empty commits. Pushing the identical SHA does
   not trigger a new run.
4. Attempt the normal rerun first, once, using the run for the current head.
   Continue only with an explicit permission denial (for example `403 Must have
   admin rights to Repository`). Rate limiting, timeout/unknown outcome, workflow
   approval, `action_required`, environment/maintainer approval and protection-rule
   blocks are not eligible. Verify an unknown rerun outcome rather than retrying
   through a different route. Never bypass GitHub approvals or repository gates.
5. Establish from this task's creation/checkout history and current repository
   rules that the head is a task-owned, exclusive feature branch that may safely
   be rewritten. Shared branches, unknown ownership, `main`/default/base/release
   branches, rewrite bans and another person's commits are ineligible. Confirm
   write permission for the actual head repository (a fork may differ from the
   base), and that neither task permissions nor branch rules prohibit this push.
   A successful fetch is not evidence of write permission.
6. Preserve completed review/merge work. Read the complete current review list
   using the plugin's existing `graphql` tool and cursor pagination of
   `reviews(first: 100, after: $cursor)` (`nodes { state }` and
   `pageInfo { hasNextPage endCursor }`). Read `headRefOid`, `mergeQueueEntry`
   and `autoMergeRequest` on the same PR too; every page must still match the
   verified head. The REST review tool's first 100 entries and snapshot's last
   50 are not proof of completeness. Require no retained
   `APPROVED` review, a successfully read null queue entry, and confirmed disabled
   auto-merge. Do not infer absence from `reviewDecision`, a truncated review
   window, missing fields or a failed/unsupported query. Any approval, queue
   entry, auto-merge request or unknown state stops this CI-only route before
   reservation/amend, even if stale-approval dismissal might be disabled.
   The preference does not authorize dismissing approvals, leaving a queue,
   disabling auto-merge or requesting these changes to make recovery eligible.

If any condition fails, report the specific blocker and record a concrete wait
using the existing follow-up gate. Enabling this option never authorizes merge,
auto-merge, queue operations, direct main pushes, permission changes or bypasses.

## Verify, consume the budget, amend and push

Use the current `<skill-dir>` and this PR's existing observation-cache directory
for the gate. Both budget status and reservation require confirmed filesystem
durability. The single receipt I/O owner syncs file contents and every parent
directory through the filesystem root, including newly created ancestors,
before returning success. New slots, raw exclusive legacy copies, migration
and re-read receipts share this boundary. Only an absent file at open means
unused: a later ENOENT, failed/unsupported sync or unknown outcome stops recovery.
There is no fallback to file-only sync, refund, removal, alternate directory or
automatic retry. Keep observation cache and all receipts on any error; an
unsupported store cannot confirm migration or grant available quota.

The Windows/Node 22.22.3 environment tested here returns EPERM for directory
fsync, so this CI-only recovery is refused there, including budget status;
ordinary PR follow-up remains available. Other platforms/filesystems must
actually support these operations; an OS name alone is not support evidence.
Successful sync calls are OS acknowledgements, not a hardware power-loss test.

Retry receipts are stored separately in durable user data, never
in that cache: `$XDG_STATE_HOME/cindy-pr/ci-retry` when set to an absolute path;
otherwise Windows uses `%LOCALAPPDATA%/Cindy/pr-recovery`, macOS uses
`~/Library/Application Support/Cindy/pr-recovery`, and other systems use
`~/.local/state/Cindy/pr-recovery`. The gate preserves earlier cache receipt
files with exclusive copying, retaining the originals and never overwriting
durable evidence. An unreadable or damaged receipt fails closed. Clearing or
changing observation cache does not reset migrated budgets. Never change the
data-root environment, delete receipts or reset budgets to obtain another try.
Legacy files are copied byte-for-byte with exclusive creation before decoding
or validating them. Missing diagnoses and damaged/unknown identities remain
fail-closed in durable storage even after cache cleanup; they are not discarded
or assigned new diagnoses. Existing durable copies are never overwritten.
This includes the earliest `*.json.ci-retry` URL receipts, which have neither
an immutable PR ID nor a diagnosis. They stop budget operations even for a
different URL: names cannot prove identity after renames/transfers. Preserve
their raw bytes; do not invent an ID or diagnosis to make them usable.
GitHub node IDs are opaque: use the exact verified value, including legacy
base64 IDs; a `PR_` prefix is not required. Do not substitute a URL or number.
Earlier evidence already deleted before migration cannot be reconstructed;
an uncertain prior outcome still stops recovery.
This upgrade cannot reconstruct receipts lost before it. Known power loss or
an uncertain earlier recovery outcome requires reconciliation; absent files
are not authorization for another attempt.

Each PR has a hard total of **two CI-only repush attempts per computer**, with
at most one per diagnosed failure. At two, stop and report regardless of a new
diagnosis; do not amend, push or reset the budget. Before checking/reserving its budget, write a diagnosis JSON
file with exactly four nonempty strings: `workflow` (workflow file path), `job`
(stable job name, not numeric job ID), `step` (failed step name), and `cause`
(normalized root cause supported by the logs). For example:

```json
{"workflow":".github/workflows/verify.yml","job":"verify-checks","step":"install dependencies","cause":"package store unavailable"}
```

Do not put commit SHAs, run/job IDs, attempts, timestamps or transient paths in
the diagnosis. Reuse it when the same fault recurs on a new run/head; a changed
SHA, log wording or symptom alone is not a new cause. A different diagnosis
requires new log evidence, the normal rerun denial and all eligibility checks
again. When unsure whether it is the same fault, stop rather than inventing a
new key. The gate normalizes case/whitespace and hashes these four fields with
the immutable PR ID; it cannot verify the Agent's causal diagnosis.

1. Inspect `git status --porcelain=v1 --untracked-files=all`, the index and
   ongoing merge/rebase/cherry-pick state. Require a clean task checkout. Any WIP
   stops this route; do not stage, stash, reset or overwrite it. Read repository
   rules, `git remote -v`, the actual push URL(s), `git branch --show-current`,
   `git rev-parse HEAD`, and the pinned head's raw tree, parents, author and message
   using `originalObjectArgs`, after the supported-checkout checks above.
   Require a single verified push destination matching the PR head repository.
   Never infer `origin` is the PR's head remote. Use the explicit target ref
   `refs/heads/<PR-head-branch>` throughout; verify it with `git check-ref-format`.
   Inspect that raw payload for a `gpgsig` / `gpgsig-sha256` header.
   Before consuming budget, a signed head requires its original signature to
   verify (`git --no-replace-objects verify-commit` with the pinned original SHA)
   and the existing effective signing setup
   to sign the replacement noninteractively with the same signature identity.
   Record the verified original format, full signing-key fingerprint and signer
   principal (`%GF` and `%GS`, plus `%GP` for formats with a primary key) using
   `originalSignatureArgs` bound to that exact original object. Verification
   must establish the original payload's format, not infer it from today's config.
   Verification success alone is insufficient: two trusted keys can both verify.
   Require `git config --type=bool --get commit.gpgsign` to be `true` and inspect
   the effective signer/key configuration and availability. Resolve the existing
   automatic signer's actual full fingerprint and principal, not just its key
   alias, email or file path, and require the same signature identity **before
   consuming budget**. An original made with one-off key A while automatic
   signing selects trusted key B is ineligible even when both signatures verify.
   If resolution is ambiguous or unavailable, stop without signing a probe,
   changing configuration or choosing a replacement key. An original created
   only with a one-off `git commit -S`, without effective automatic signing,
   is ineligible. Unknown readiness, unavailable keys, required user interaction
   or failed original verification stops recovery before reserve/amend; do not
   enable signing, select another key, weaken verification or silently strip
   the signature. Git's normal signing failure must fail the amend, not fall
   back to an unsigned commit.
2. Read that exact ref using `git` with `remoteArgs` above.
   Its SHA must equal both local HEAD and the current GitHub PR head. Inspect
   the PR commit list and task history for other people's or unknown commits.
   If anything differs, stop and reconcile safely; do not fetch/reset away an
   unknown remote commit. Record the verified remote SHA as the fixed lease.
3. Read live `pr_follow_settings` again and recheck eligibility 6's complete
   review/queue/auto-merge state. If still enabled and all conditions
   hold, consume one of the **two total CI-only repush attempts for this PR/computer**,
   requiring that this diagnosed failure has not consumed one already:

   Use the selected Node executable with `reserveArgs` above, preserving each
   argument boundary. This remains a budget operation, not a Git executor.

   Require exit 0, `reason: "ci-retry-reserved"` and the matching
   `reservation.sourceHead` and normalized `reservation.failure`. The return
   includes `pr_limit: 2`, `pr_consumed` and `pr_remaining`. A status result with
   `available: false` forbids a new reservation, including exhaustion by different
   diagnoses; a successful reserve reports the consumed receipt, not a new available
   attempt. This receipt
   only consumes budget; it does not authorize Git operations.
   The selected Node executable with `statusArgs` reads it without GitHub calls;
   it only writes when adopting earlier receipts into the fixed durable slots.
   The budget survives cache cleanup, changed SHAs, gate acknowledgements,
   follow-up restarts, repository renames/transfers and interrupted operations.
   Two exclusive, append-only slot files are keyed by the immutable PR node ID;
   each records the stable diagnosis, never a mutable URL or run ID as identity.
   Concurrent callers cannot allocate a third slot or reserve the same fault twice.
   A denied, corrupt or uncertain
   reservation means stop: no amend/push. Even a failed push consumes the attempt.
   A different diagnosed failure can consume the second slot without deleting any
   prior receipt; after two total attempts all diagnoses stop. The same failure cannot start an amend/force-push loop by
   changing job/run IDs or head SHA. Earlier development receipts lacking a
   diagnosis stop recovery for reconciliation; do not silently discard them.
   All matching old per-failure receipts in durable data and the current cache
   count toward the two slots, even when querying another diagnosis. Migration
   retains the originals and never overwrites durable evidence. It preserves old
   evidence before validating this parsed budget request or reading its diagnosis.
   Any recognized CI-only parameter (status, reservation, identity or diagnosis),
   including an empty value or identity/diagnosis without a mode, selects this
   preservation path. Exactly one explicit status/reservation mode is required;
   omitted modes never fall through to ordinary observation or implicit status.
   Budget commands require an explicit, non-empty `--state-dir` for this
   follow-up. If it is absent/empty, its history cannot be located reliably:
   reject before storage access, with no environment/default-cache fallback or
   claim of successful preservation. A missing value never consumes the next
   option, including short `-h`: help exits without storage or quota work;
   unknown option tokens fail parsing. Use `./` for literal relative paths
   starting with a dash. Ordinary observation keeps its existing environment/default path.
   A missing diagnosis option/value, missing/invalid ID or source SHA, conflicting
   budget mode, or missing/damaged/invalid diagnosis cannot leave old outcomes
   vulnerable to cache cleanup. The existing entry point uses one completed
   parse to select the effective observation directory, preserves raw receipts,
   then validates the request before adoption, traces or quota allocation.
   Missing CI option values do not consume the following option, so a later
   `--state-dir` is still read. Help and unparseable CLI syntax/targets are not
   budget requests and do not promise automatic migration.
   Such an invocation cannot create a new reservation; adopting a verified older
   attempt only retains its existing consumption. More than two
   older attempts, unreadable receipts or unknown prior identity/outcome stop
   recovery; migration never grants two fresh attempts on top of old history.
4. Recheck eligibility 6 (no approval, queue or auto-merge; all states known),
   the PR is open, the preference is enabled, and local/index/remote
   facts still match, including absence of every effective hook/history overlay.
   Use `git` with `amendArgs` only after those checks. The shared
   `--cleanup=verbatim` argument preserves the raw message regardless
   of local/global cleanup or comment-character settings. Keep it for unsigned
   heads too; never rewrite comments, scissors suffixes or whitespace to obtain
   eligibility. The post-amend raw-message comparison below remains required.
   For a signed head,
   recheck that the effective automatic signer still resolves to the recorded
   signature identity; a changed or unknown signer stops the amend. Preserve the code
   tree, parents, author, commit intent and existing trailers; never use
   `--reset-author`, `--allow-empty`, identity overrides or disable hooks. Follow
   repository DCO rules: preserve matching sign-offs; add `-s` only with the
   configured identity and when valid for this author. If a matching sign-off
   cannot legitimately be supplied, stop. After amend verify a **new** SHA.
   Read `replacementObjectArgs` and compare raw tree, ordered parents and author
   against the recorded original raw payload; compare the message (only required
   DCO additions may differ). A differing raw payload invariant or unchanged SHA
   stops pushing. Recheck hooks/overlays without invoking them.
   If the old head was signed, require a signature header on the new commit and
   successful `git` verification with `verifyArgs`, then read `signatureArgs`
   for the exact `newSha`. Require the same format, full signing-key fingerprint,
   signer principal and applicable primary fingerprint as the recorded original
   signature identity before any push. A valid signature from another trusted
   key still fails this equality check; never infer equality from author/email,
   a valid status or GitHub's badge. A missing, invalid, changed or unknown signature means leave it unpushed
   and report the result; never discard the old provenance silently. Local
   verification is not evidence that GitHub's Verified badge was preserved.
5. Read live `pr_follow_settings` immediately before pushing, and refresh PR
   state, complete reviews, queue entry, auto-merge, head, clean worktree and exact
   remote ref, plus all supported-checkout/transfer-scope assumptions above.
   Eligibility 6 must still hold immediately before push. If an
   approval/queue/auto-merge appears or any read becomes unknown, stop; do not
   push or alter the merge workflow. All must still match the
   original verified state apart from the intended local new SHA. If disabled
   now, leave the local amend unpushed and report it; do not reset it automatically.
   Push exactly once:

   Use `git` with `pushArgs` above: the lease is one complete argument, the remote
   is one argument after `--`, and the complete refspec is one argument with
   the already verified `newSha` as its source and `exactRef` as its destination.
   Keep both transfer guards before `--`; do not inherit tag following or
   recursive submodule pushing. Do not append refspecs or publish child commits.

   Never use bare `--force`, implicit lease expectations, or multiple push URLs.
   A lease failure ends recovery. Do not refresh the expected SHA and push again.
   A network error may mean executed: read back the exact remote ref and original
   PR before deciding what happened, with no automatic second push. The parent
   result alone cannot settle suspected effects in other repositories.

## Verify and report

Check the new SHA appears on the **original PR** and exact remote branch. Check
GitHub Actions/check suites for that SHA and this PR event; a new SHA alone does
not prove CI started (fork workflow rules/path filters may prevent it). Record
old/new SHA, stable diagnosis, failed run and permission-denied evidence, consumed budget, push
outcome and observed CI run/check identifiers in this task's follow-up record.
For a signed recovery, include the original/replacement signature identities
in that same record; do not add a second receipt store. Missing original identity
after a crash means unknown provenance, never permission to infer equality or repush.
Read back review/queue state too. These checks are not an atomic GitHub lock;
if a concurrent change or uncertain push affected approvals or queue state,
report the actual/unknown side effect and stop, without trying to restore,
dismiss, dequeue or re-enqueue anything automatically.
If a prior amend may have invoked a hook, its external effects precede the final
push and cannot be settled by the parent ref/lease alone. Identify suspected
destinations from the original hook/configuration and read them back without
executing the hook again. Report unknown destinations/effects as unknown; do not
replay, refund, delete refs or claim that no final push means no external write.

Report separately: not executed, executed and verified, or unknown pending
read-back. Never call CI passed until its actual results pass. If checks do not
start, investigate/report and wait, without another amend, empty commit or push.
Use the ordinary gate finish/wait procedure; do not change schedule cadence.
If an earlier push omitted a transfer guard, a nonzero exit or rejected parent
branch does not prove tags or submodules were untouched. Identify suspected
child/nested push destinations from the original checkout/configuration and
read their remote refs as well as the parent refs, without fetching, updating
submodules or pushing. If destinations or effects cannot be established, report
them as unknown. Never delete/move refs, publish child commits or replay a push
to repair it. No new allowance or receipt refund follows from a parent failure.

After a crash or ambiguous outcome, read the current PR's verified `node_id`,
reuse the recorded diagnosis and use
the selected Node executable with `statusArgs` (rebound from those verified data) and compare
its `sourceHead` with local history, the remote and original PR. Verify and
report the existing outcome; never consume another attempt or replay the push.
