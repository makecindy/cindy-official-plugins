# Optional recovery when CI rerun permission is denied

This is an Agent workflow using the existing GitHub tools and task shell, not
an autonomous Git worker. The plugin cannot establish branch ownership or
diagnose CI logs by itself. The Agent must establish the facts below. Unknown
facts stop recovery; do not replace them with assumptions or a checklist flag.

## Configuration-source boundary

Any defined GIT_CONFIG, including empty values, stops CI-only recovery. Inspect
the complete actual execution environment before any Git configuration,
status/object or remote read, budget status/reservation, amend and push. Account
for case-insensitive environment names on Windows; inspect the environment of
the existing task executor and its intended child, not a different shell or a
parent-only view. An unavailable or incomplete environment read stops; do not
infer absence. Recheck before every execution boundary, for signed and unsigned
paths alike. GIT_CONFIG changes only `git config`'s file selection, while other
Git commands can still read the actual repository configuration. Thus an empty
config read cannot establish the safety of amend, hooks, signing, URL rules or
encoding when this variable is defined. See [Git config environment](https://git-scm.com/docs/git-config#ENVIRONMENT).

Do not unset GIT_CONFIG, replace its file, or add a config-only scope override to
qualify. Do not change the existing fixed read argv to `--file`, `--blob`, or
scope-limited reads. Shared Git configuration inputs (GLOBAL/SYSTEM/NOSYSTEM,
COUNT/KEY/VALUE and PARAMETERS) still require complete effective reads in the
same unchanged execution environment; they are not an exception for GIT_CONFIG.
After reservation, changed/unknown environment stops with no refund; after amend,
leave work unpushed and reconcile HEAD and suspected effects read-only. Do not
reset, restore or replay to turn an earlier partial execution into success.
This is the existing Agent prerequisite, not a new environment resolver,
executor or mechanical CLI guard. Environment observations are not atomic
against a later concurrent change.

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
const committerIdentArgs = ['--no-replace-objects', 'var', 'GIT_COMMITTER_IDENT'];
const pushSigningConfigArgs = ['--no-replace-objects', 'config', '--includes', '--type=bool', '--get', 'push.gpgSign'];
const urlRewriteConfigArgs = ['--no-replace-objects', 'config', '--includes', '--null', '--show-origin', '--show-scope', '--get-regexp', '^url[.].*[.](pushinsteadof|insteadof)$'];
const hookConfigArgs = ['--no-replace-objects', 'config', '--includes', '--null', '--show-origin', '--show-scope', '--get-regexp', '^hook[.]'];
const notesRewriteConfigArgs = ['--no-replace-objects', 'config', '--includes', '--null', '--show-origin', '--show-scope', '--get-regexp', '^notes[.]rewrite'];
const encodingConfigArgs = ['--no-replace-objects', 'config', '--includes', '--null', '--show-origin', '--show-scope', '--get-regexp', '^i18n[.](commitencoding|logoutputencoding)$'];
const hookListArgs = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'post-rewrite', 'reference-transaction', 'post-index-change', 'pre-auto-gc', 'pre-push']
  .map(event => ['--no-replace-objects', 'hook', 'list', '--show-scope', '-z', event]);
const graftPathArgs = ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'info/grafts'];
const replaceRefsArgs = ['--no-replace-objects', 'for-each-ref', '--format=%(refname)', 'refs/replace/'];
const shallowStateArgs = ['--no-replace-objects', 'rev-parse', '--is-shallow-repository'];
const shallowPathArgs = ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'shallow'];
const refFormatArgs = ['--no-replace-objects', 'rev-parse', '--show-ref-format'];
const mutableGitPathArgs = ['COMMIT_EDITMSG', 'logs/HEAD', 'logs/' + exactRef]
  .map(name => ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', name]);
const commitMessagePathArgs = mutableGitPathArgs[0];
const lockPathArgs = ['index', 'HEAD', exactRef, 'packed-refs']
  .map(name => ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', name]);
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
Only verified GitHub HTTPS URLs are supported by CI-only recovery. SSH URLs,
scp-style remotes and every non-HTTPS transport stop before any remote read or
budget operation. Require the independently verified head repository's canonical
HTTPS Git URL at each boundary, before reserve/amend and immediately before push.
Do not contact an SSH remote even to check its SHA: GIT_SSH_COMMAND, GIT_SSH,
core.sshCommand or OpenSSH host/proxy rules can redirect both reads and writes,
so a matching SHA and successful lease cannot establish the original receiver.
This entire SSH family is outside the route, even when overrides appear absent.
Do not parse SSH configuration, probe a receiver, replace a helper, clear an
override or change the user's remote to qualify. Ordinary authorized work keeps
its own transport choices. If an earlier SSH attempt is unknown, reconcile all
suspected receivers read-only within existing authorization; the original PR
remaining unchanged is not proof that nothing was pushed. Do not restore refs,
replay or refund. This scope exclusion adds no transport resolver or executor.

Any effective url.*.pushInsteadOf or url.*.insteadOf entry stops this route,
including empty or nonmatching values. Read `urlRewriteConfigArgs` in the actual
checkout/environment before any remote read, budget status/reservation, amend and push.
Inspect complete output from all effective scopes, includes/conditional includes,
worktree and command/environment configuration. Only exit 1 with empty stdout
and no error output proves no matching keys; exit 0 means a rule exists, and
any failed, partial or ambiguous result stops. Do not parse applicability,
longest-prefix precedence or an apparently already-expanded URL to grant an
exception. A push-only rule can redirect a literal URL while ls-remote still
reads the original; insteadOf can redirect both. The exact lease protects a ref
value at whichever receiver Git actually selects, not receiver identity.

For a named remote, read the complete `remote get-url --all` and
`remote get-url --push --all` results using separate arguments, and require
exactly one identical fetch/push URL matching the independently verified PR
head repository. Divergence, multiple push destinations or unknown mappings
stop. Bind `verifiedRemote` to that one literal verified URL for subsequent
remoteArgs/pushArgs, not a remote name with separate fetch/push semantics.
Reject ambiguity with any configured remote having that exact URL as its name.
Re-read rules and the original remote mappings at each execution boundary;
changed/unknown facts stop, without refund after reservation or push after amend.
Never unset or override URL rules, change remote URLs, invoke a probe push or
contact a rewritten destination to qualify. This is existing Agent verification,
not a new URL resolver, transport helper or configuration repair path.

Before budget status/reservation, inspect the effective push configuration. A
mirrored remote, nonempty `push.pushOption`, custom receive program capable of
extra writes or unknown behavior stops recovery. Do not change configuration
or replace a helper to make it eligible. The existing task tool remains the
only executor; no resolver, hook runner or storage is added.

Before quota or amend, require push.gpgSign unset or false. Read the effective
value with `pushSigningConfigArgs` in the same checkout/environment, following
includes and normal Git scope precedence. Only a confirmed missing key (exit 1,
no output/diagnostics) or successful `false` result is eligible. `true`,
`if-asked`, invalid/unknown values or failed reads stop recovery before budget
status/reservation, amend and push. Recheck at all three boundaries. A signed
commit does not imply a usable signed-push capability or signer. Do not change
configuration, pass `--no-signed`, sign a probe or query/execute a new transport
to gain eligibility; an ordinary authorized contribution uses its own workflow.

### Supported checkout: no effective hooks, notes rewriting or history overlays

Any effective notes.rewrite configuration stops CI-only recovery, including
notes.rewriteRef (single, multiple, glob, empty or nonmatching), notes.rewriteMode
and notes.rewrite.amend=false. Read `notesRewriteConfigArgs` in the actual
checkout/environment before any Git status/object work or budget status/reservation,
amend and push. Require a complete effective read covering every scope,
includes/conditional includes, worktree and command/environment configuration.
Only exit 1 with empty stdout and stderr establishes no matching keys; exit 0,
failed/partial reads or unknown results stop. Also require complete inspection of
the actual execution environment: any defined GIT_NOTES_REWRITE_REF or
GIT_NOTES_REWRITE_MODE, including empty values, stops. An unavailable environment
read is unknown, not absence. Recheck the same facts at every boundary.

Do not infer safety from notes.rewrite.amend=false, an apparently unmatched glob,
missing notes on the original commit, or presently unlocked notes refs. The
environment can override the selected notes refs and rewrite mode. Do not parse/expand the selected refs,
unset/override configuration or environment, add --no-post-rewrite, or run a
probe amend to qualify. This excludes the whole notes-rewrite side-effect family
without adding another ref resolver, lock owner or executor. See
[Git notes configuration and environment](https://git-scm.com/docs/git-notes#CONFIGURATION).

An amend may move HEAD before a notes update fails; a nonzero exit does not mean
unexecuted. After reservation, changed/unknown facts stop with no refund; after
amend, leave local work unpushed. If an earlier amend may have copied notes,
read back HEAD and every suspected notes ref from its original configuration and
environment without repeating the amend. Unknown destinations/effects remain
unknown; do not restore/delete refs, replay notes, reset user work or refund quota.

COMMIT_EDITMSG must be absent or a private regular file. Apply one private-file
predicate to every mutableGitPathArgs target: COMMIT_EDITMSG, logs/HEAD and
logs/ plus the exact branch ref. Even --no-edit amend overwrites the message
helper and can append to both reflogs. Resolve every argument list in the actual
Git environment, including linked worktrees and the branch's common metadata,
before any budget status/reservation, amend and push. `commitMessagePathArgs`
is only the first member of this one inventory, not a separate check owner.
Do not construct `.git/...` or assume `.git` is a directory. Confirm each
absolute path belongs to this verified repository's Git metadata. Inspect the
existing parent chain with lstat: every component must be a real directory with
known, stable lossless device/inode identity. Any symlink/junction, missing parent,
non-directory or unreadable/unknown component stops; ENOENT at the leaf alone is
not proof of safe absence.

Use lstat without following the leaf. An existing file must be regular, have
known `nlink === 1n`, and nonzero inode plus lossless BigInt device/inode IDs;
signed high-bit representations are valid. Any symlink (including dangling),
multiple hard links, directory, special file, missing/unreadable identity or
unknown result stops before quota or amend. Keep these observations only in the
current Agent verification, not a new cache or receipt. Re-read the same Git path,
parents, type, link count and identity at every boundary: a changed path/parent,
file replacement or absence becoming presence before amend stops without refund.
Both signed and unsigned paths share this prerequisite.

After amend, every existing private target must retain its pinned identity.
An absent COMMIT_EDITMSG must become a private regular file; an absent reflog may
remain absent or become a private regular file. Pin the observed state and any
new identity for the final pre-push recheck. Missing parents still stop; disabled
logging is not an exception to inspect only one reflog or skip its parents.
Unexpected, changed or unknown state leaves the local commit unpushed.
Never remove, replace or relink this file to qualify, change Git
environment/configuration, or run a probe amend. These checks are not an atomic
binding of Git to the inspected file; they rely on the required exclusive
checkout and do not prevent a later concurrent swap. No lock owner or executor
is added. [Git commit's file contract](https://git-scm.com/docs/git-commit#FILES)
describes the overwrite; [Git repository logs](https://git-scm.com/docs/gitrepository-layout#Documentation/gitrepository-layout.txt-logs)
identifies HEAD/worktree and common branch reflogs. These are one shared
overwrite/append eligibility predicate, not duplicate per-path guard systems.

If an earlier amend may have followed an alias, a failure or unchanged HEAD does
not prove that outside files were untouched. Read back HEAD and account for every
suspected aliased output read-only within existing authorization. Unknown effects
remain unknown; do not restore outside bytes, replay, reset user work or refund
quota. The receipt I/O owner is not used to inspect or repair Git helper files.

Any occupied or unreadable Git lock path stops before budget status/reservation,
amend and push. First require `refFormatArgs` to succeed with exactly `files`;
other/unknown ref backends are outside this route. Resolve every `lockPathArgs`
path in the actual amend environment and append `.lock` as literal path data.
This covers the effective index (including GIT_INDEX_FILE), worktree HEAD,
the exact branch ref in its common directory, and packed refs. Require complete
absolute paths and confirmed absence of every lock with read-only file inspection;
any file, directory, symlink, failed/unknown inspection stops. Do not assume `.git`
is a directory or use the main worktree's index for a linked checkout.
Never delete, replace or wait out a lock, change environment/configuration or use
a probe amend to qualify. Recheck all paths at every boundary; after reservation
stop without refund, after amend leave unpushed. Absence now does not prevent a
concurrent process acquiring a lock later; this adds no lock owner or retry.

The same eligibility boundary applies before **any Git status/object work or
budget operation**, immediately before amend, and immediately before push.
First use read-only configuration/path inspection, not a trial commit or hook.
An executable extension or object-view override with unknown execution effects
stops CI-only recovery; do not run it as a probe.
Any effective Git hook, including standard Git LFS and DCO, stops recovery before quota or amend.
Keep the original commit and retry count unchanged; do not invoke a hook to
probe its behavior. This applies even when its complete content is trusted,
the message already has a sign-off, or LFS objects were previously uploaded.
No body inspection grants an exception for this CI-only recovery.

Use `hooksPathArgs` to resolve Git's effective directory, including
`core.hooksPath` and linked worktrees; never assume `.git` is a directory.
Inspect every non-sample entry for activation without executing it. Symlinks,
unreadable paths or uncertain activation stop recovery. This covers pre-commit,
prepare-commit-msg, commit-msg, post-commit, post-rewrite, reference-transaction,
post-index-change, pre-auto-gc and pre-push, plus any other event the operation
can trigger. Require `core.fsmonitor` unset or false too: a status/monitor
command with unknown effects is not supported. Do not disable, rename, chmod,
rewrite or bypass hooks to become eligible. Ordinary authorized contributions
remain governed by their repository rules.

The effective hook set includes configuration-registered hooks, not only files.
Before quota/reservation, amend and push, read `hookConfigArgs` using the same
checkout/environment as the intended Git operation. Preserve origin, scope and
all multi-values, including conditional includes, worktree/global/system config
and command-scope settings. With Git 2.54+, use every `hookListArgs` event to have
Git resolve effective registration order, last-command-wins, event resets and
disabled entries. Any active listed command stops recovery without execution.
Git list returns 1 for a known event with no hooks and its explicit no-hooks
diagnostic; that differs from an unsupported command, config parse failure
or unreadable include. Do not eval commands or use `git hook run` as a probe.
If enumeration is unsupported, continue with legacy directory inspection only
when the full successful config read establishes no registered hooks; otherwise
stop before quota/amend/push. Never unset configuration to gain eligibility.
Recheck the effective lists and configuration at every execution boundary;
new/changed/unverifiable facts stop recovery. Reports use hashes and redacted
origin/scope; never retain embedded credentials.
[Git hook 2.54](https://git-scm.com/docs/git-hook/2.54.0) defines these semantics.

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

Before quota or amend, resolve the committer identity with committerIdentArgs
in exactly the environment and checkout intended for amend. Require exit zero
and one valid Git committer-ident line, including a usable date; record its
resolved name/email as the intended committer. This reads effective config and
environment, including user.useConfigOnly and GIT_COMMITTER_*; original author
or user.name/user.email lookups alone do not prove it is usable. Missing, failed
or ambiguous output stops before budget status/reservation. Never set config,
identity variables or dates, and never create a probe commit, to gain eligibility.
Recheck immediately before amend/push; changed or unknown identity stops without
refund or repair. Compare the replacement's raw committer name/email with the
recorded identity too (its timestamp may change); retain the original author.

Require the complete resolved committer line to differ from the original raw committer header before quota or amend.
Compare the whole original header value (before the first blank line), including
name, email, epoch seconds and timezone, with Git's resolved ident. Equality is
ineligible even when the identity/date is valid: unchanged unsigned metadata can
reproduce the same object. Apply this conservative rule to signed heads too;
do not rely on re-signing randomness. Recheck at each execution boundary, keep
name/email stable, and allow the date to advance naturally. Never change a
pinned date/configuration, inject a nonce or probe an amend to qualify. The later
new-SHA and raw-payload checks remain mandatory.

Before quota or amend, reject an empty or whitespace-only original raw message.
Also reject any NUL (U+0000/0x00) anywhere in the original raw message, including
leading, embedded and trailing NUL. Valid UTF-8 and non-whitespace content alone
do not establish Git round-trip preservation: amend can truncate at NUL and
still exit zero. Never strip, replace or truncate a NUL to qualify; keep the
original head and quota unchanged. Apply this raw-byte condition at the same
budget status/reservation, amend and push boundaries as the message check below,
including signed heads and paths that would otherwise add a DCO trailer.
After the strict UTF-8 validation below, require at least one non-whitespace
character in the complete original message, even when DCO trailers would be added.
This applies to roots, single-parent and merge heads, signed or unsigned.
Missing, truncated or unknown raw-message reads also stop. Do not use a rendered
subject, strip comment lines or rely on `--no-edit` to retain the original
`--allow-empty-message` permission. The fixed amend argv does not retain permission for an empty message;
whitespace-only messages do not qualify either. Do not add `--allow-empty-message`,
invent a subject, append a nonce/trailer solely to qualify or amend as a probe.
Recheck the pinned raw message before budget status/reservation, amend and push.
The existing post-amend raw-message/trailer comparison remains required for
supported messages, including literal comment lines preserved by verbatim cleanup.

Before quota or amend, reject an empty root or single-parent head. Use the
original raw parent count, never a replacement-aware or shallow view. For one
parent, read that pinned parent's raw commit with the same argument boundary
as `originalObjectArgs`; reject when the sole parent's raw tree equals the
original head tree. For a root, read the verified original tree with separate
argv `['--no-replace-objects', 'cat-file', '-t', verifiedOriginalTreeSha]` and
`['--no-replace-objects', 'cat-file', '-s', verifiedOriginalTreeSha]`; require
type `tree` and a positive size. A zero size is an empty root. Failed/unknown
reads stop before reservation; do not amend as a probe or add `--allow-empty`
to qualify. A genuine multi-parent merge is not excluded merely because its
tree matches the first parent; the existing complete-parent checks still apply.

For an unsigned original, require commit.gpgSign unset or false before quota or amend.
Read `['--no-replace-objects', 'config', '--includes', '--type=bool', '--get',
'commit.gpgSign']` in the actual checkout/environment with the same missing-key
and error handling as `pushSigningConfigArgs`. True, invalid or unknown values
stop without a signing probe, configuration change or `--no-gpg-sign` bypass.
Recheck before amend/push. An unsigned original requires the replacement to
remain unsigned: a new `gpgsig` or `gpgsig-sha256` header means stop and leave it
unpushed. For a signed original, keep the existing pre-reservation signer and
post-amend identity/verification requirements; no silent provenance change.

Before consuming quota or amending, reject any encoding header in the original
raw header block. Require a strictly valid UTF-8 raw message and complete reads
of `encodingConfigArgs`: i18n.commitEncoding and i18n.logOutputEncoding must both
be unset or the known UTF-8/UTF8 aliases (case-insensitive). Non-UTF-8, conflicting,
unreadable or ambiguous encoding settings stop before reservation. Read through
conditional includes and all effective scopes; do not infer the source encoding
from a displayed/replacement-decoded string. The existing executor must preserve
raw bytes for validation. Do not change configuration, pass a one-off encoding
override or amend as a probe to make an incompatible head qualify. Recheck the
same raw header and encoding configuration immediately before amend and push.
`--no-edit` and `--cleanup=verbatim` do not stop Git recoding an existing message;
the later raw-message comparison remains required for supported UTF-8 inputs.

| Event | Action |
| --- | --- |
| Any effective hook, overlay, shallow state or unknown inspection before budget | Stop without budget, amend or push |
| Hook/configuration/history facts change before amend | Stop; keep any consumed receipt, no refund |
| Raw tree/parents/author differ, or a history boundary/unverified hook appears after amend | Leave the new local commit unpushed and report; never reset user work |
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
2. Refresh the exact PR. Read its current opaque `node_id` from `get_pull_request`
   (use `call_tool` with `raw: true`); retain that verified ID for all budget
   operations. Never derive or invent it from owner/repo, URL or PR number.
   Complete the historical-ID checks below before using that serialized ID as
   a budget key; a different encoding must never be treated as a fresh PR.
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

   Only the current PR may be an open consumer of the exact head repository/ref.
   Branch ownership and an exact lease do not limit which PRs a ref update affects.
   Use the existing `graphql` tool to read the **head repository's Ref**, with
   structured variables from the verified PR, not a base-repository PR list,
   commit association, search result or branch-name-only comparison:

   ```graphql
   query HeadConsumers($headOwner: String!, $headRepo: String!, $headRef: String!, $cursor: String) {
     repository(owner: $headOwner, name: $headRepo) {
       id
       ref(qualifiedName: $headRef) {
         name prefix target { oid }
         associatedPullRequests(first: 100, after: $cursor, states: [OPEN]) {
           totalCount
           pageInfo { hasNextPage endCursor }
           nodes { id state headRefName headRefOid headRepository { id } }
         }
       }
     }
   }
   ```

   Bind `$headRef` to the complete `refs/heads/<verified-branch>`. On every page,
   require the verified immutable head repository ID, prefix/name and original
   remote SHA, and require the original PR still open at that same head. Follow
   every cursor until `hasNextPage` is false; require a stable totalCount equal
   to the distinct returned IDs, exactly one result, the verified current PR ID,
   and matching OPEN state/head repository ID/name/SHA. Do not filter by base,
   labels or current target repository: other bases and target repositories are
   consumers too. Another open PR always stops recovery, regardless of its
   approval/queue/auto-merge state; do not reserve its budget or operate on it.
   Incomplete visibility, GraphQL errors or partial data, missing/duplicate IDs,
   repeated/missing cursors, moved heads or unknown/mismatched fields stop too.
   Zero results do not prove exclusivity when the current PR must be present.
   Re-read all consumer pages before budget status/reservation, amend and push.
   A consumer appearing after reservation stops without refund; after amend,
   leave the local commit unpushed. This is a conservative single-PR scope,
   not a new cross-PR coordinator or atomic GitHub lock. Do not close/retarget
   another PR, change permissions or create a fresh branch to gain eligibility.
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

### Identity scope: no serialized-ID migration

Inventory every existing durable slot and legacy receipt in the selected data
root and effective observation cache, using the existing task's read-only file
tools. Require a complete, unchanged inventory with readable raw identities;
missing/unknown identity (including URL-only evidence), malformed/unreadable
records or an uncertain earlier root stops before any budget command. Keep the
raw files and cache; do not infer a different PR from different opaque strings.

Use the existing GraphQL tool and structured variables to resolve each distinct
stored input ID against the freshly verified current PR ID. This fixed query
keeps each historical input associated with its response without decoding IDs:

```graphql
query VerifyHistoricalPr($currentId: ID!, $storedId: ID!) {
  current: node(id: $currentId) {
    __typename
    ... on PullRequest { id fullDatabaseId headRefOid }
  }
  historical: node(id: $storedId) {
    __typename
    ... on PullRequest { id fullDatabaseId }
  }
}
```

Require complete error-free results, PullRequest types and nonempty decimal
`fullDatabaseId` strings, compared losslessly (never via Number), with the current
node matching this PR's independently read database ID and pinned head. A stored
ID resolving to the same fullDatabaseId but a different opaque ID (stored input
versus currentId) means an ID representation change: stop before any budget command. Any null, unresolved,
partial or conflicting result also stops; only verified different database
identities may be excluded as other PRs. Both old and new formats remain opaque;
only an unchanged, verified identity epoch is supported for this recovery route.
Re-read the current identity and complete receipt inventory before budget
status/reservation, amend and push; changed/unknown facts stop without refund or
repair. The receipt CLI does not discover aliases and its successful status is
not identity proof. Do not decode IDs, create an alias registry, rename/merge receipts,
switch keys or migrate counts to qualify. This conservative scope excludes node-ID
migration; no new database identity is substituted as a storage key. Use ordinary
authorized work or maintainer rerun while identity history needs reconciliation.
[GitHub's migration guide](https://docs.github.com/en/graphql/guides/migrating-graphql-global-node-ids)
explains why legacy and new node ID strings can represent the same object.

If any condition fails, report the specific blocker and record a concrete wait
using the existing follow-up gate. Enabling this option never authorizes merge,
auto-merge, queue operations, direct main pushes, permission changes or bypasses.

## Verify, consume the budget, amend and push

Use the current `<skill-dir>` and this PR's existing observation-cache directory
for the gate. Both budget status and reservation use the platform's receipt I/O
boundary. The single receipt I/O owner syncs file contents and every parent
directory through the filesystem root, including newly created ancestors,
before returning success. New slots, raw exclusive legacy copies, migration
and re-read receipts share this boundary. A missing file at open means unused only after rechecking its parents. The
existing I/O owner remembers each observed directory's lossless device/inode
identity in this process. Both pathname stats and opened directory handles must
match that identity at confirmation/sync; the target is checked again after its
ancestor flushes. Device/inode BigInts are opaque: signed high-bit values remain
valid and compare exactly, without a positivity check or Number conversion.
Missing/non-BigInt identity, zero inode or a changed directory stops rather than
accepting a same-path replacement. This replaces the existing path-only facts,
not a new durable registry or a cached quota. Every check still reads the real
filesystem;
if any such directory disappears, read and preparation fail closed rather than
walking above it, returning null or recreating it. Preparation never calls
recursive mkdir: an already-existing target needs no mkdir; only a confirmed
ancestor's missing suffix is created one component at a time with non-recursive
mkdir, synchronizing each new link. If that parent disappears before creation,
ENOENT stops instead of rebuilding it. Occupied fixed slots must form a contiguous prefix. A surviving higher slot
proves that earlier attempts were consumed: a missing earlier slot stops status,
reservation and legacy adoption before any slot can be refilled or quota
reported available. Keep all surviving/raw evidence and reconcile the lost
receipt; do not repair the hole or refund attempts. This is validated by the
existing slot reader, without a new ledger or marker. It cannot reconstruct
external erasure that leaves no surviving evidence before the invocation.

Exclusive slot/copy writes still stop
if their confirmed parent disappears after preparation. Never-created storage may
still return unused after confirming the nearest existing ancestor, without
creating a probe. These are transient observations, not a receipt cache, lock
or persistent marker; they do not make filesystem checks atomic or reconstruct
external erasure before the invocation. Known lost/uncertain history still stops.
A later ENOENT, failed/unsupported sync or unknown outcome also stops recovery.
There is no error-swallowing fallback, refund, removal, alternate directory or
automatic retry. Keep observation cache and all receipts on any error; an
unsupported store cannot confirm migration or grant available quota.

The same file-and-complete-parent-chain requirement applies on every platform.
When Node or the filesystem cannot confirm directory synchronization (including
Windows configurations returning EPERM), stop before claiming available quota
or reserving an attempt, even when no receipt or quota directory exists yet.
There is no Windows write-through/file-only fallback. Do not change storage,
configuration or credentials to make this route eligible. Process-restart
checks and successful OS acknowledgements are not hardware power-loss evidence.

Status separates unused quota from confirmed receipt I/O. `available: true`
means a quota slot is unused after required directory confirmation; it does
not establish receipt-file flush capability.
`receipt_flush_confirmed: false` with empty slots means no receipt-file flush
has been exercised, even if an ancestor directory exists. Status creates no
probe file or directory. A true value means stored receipt evidence was read
and flushed successfully, not that a future write is guaranteed. A reservation
must itself return `receipt_flush_confirmed: true` and its matching receipt
after successful file flush before any Git operation; any failure still stops
recovery without a refund, alternate store or automatic retry.

Retry receipts are stored separately in durable user data, never
in that cache: `$XDG_STATE_HOME/Cindy/pr-recovery` when set to an absolute path;
otherwise Windows uses `%LOCALAPPDATA%/Cindy/pr-recovery`, macOS uses
`~/Library/Application Support/Cindy/pr-recovery`, and other systems use
`~/.local/state/Cindy/pr-recovery`. The relative suffix is always `Cindy/pr-recovery`, so an explicit XDG value
that equals the platform's default base does not select another budget. Before
preservation or validation of any CI budget request, check the earlier
`<selected-base>/cindy-pr/ci-retry` root read-only. Any existing entry there,
even an empty directory, symlink or malformed file, stops for reconciliation
without moving, deleting or allocating anything. Unreadable/unknown roots also
stop. A leaf ENOENT is not absence proof: lstat each missing component upward
to the nearest existing ancestor, and require that entry to be a real directory.
A visible symlink/junction at that boundary, including a dangling intermediate
link, or an unknown/non-directory result stops before preservation or budget
evaluation; never follow, remove, repair or wait for that link to qualify. Repeat on the next
invocation; storage becoming available does not authorize migration or new quota.
This is a read-only observation, not atomic protection against later path changes.
This does not scan arbitrary past custom roots: changing the selected
base still requires establishing prior outcomes and never grants fresh quota.

The gate preserves earlier cache receipt
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
GitHub node IDs are opaque: after the identity-scope checks, use the exact verified value, including legacy
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
3. Read live `pr_follow_settings` again and recheck eligibility 5's sole open
   head-ref consumer and eligibility 6's complete
   review/queue/auto-merge state. If still enabled and all conditions
   hold, consume one of the **two total CI-only repush attempts for this PR/computer**,
   requiring that this diagnosed failure has not consumed one already:

   Use the selected Node executable with `reserveArgs` above, preserving each
   argument boundary. This remains a budget operation, not a Git executor.

   Require exit 0, `reason: "ci-retry-reserved"`, `receipt_flush_confirmed: true` and the matching
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
   Two exclusive, append-only slot files are keyed by the verified PR ID serialization;
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
4. Recheck eligibility 5's sole open head-ref consumer and eligibility 6
   (no approval, queue or auto-merge; all states known),
   the PR is open, the preference is enabled, and local/index/remote
   facts still match, including absence of any effective hook and every history overlay.
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
   Eligibility 5's sole open head-ref consumer and eligibility 6 must still hold
   immediately before push. If an
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
   PR before deciding what happened, with no automatic second push. Re-enumerate
   the exact head ref's open PR consumers; any newly discovered or unreadable
   consumer makes its possible review/queue/auto-merge effects unknown until
   reconciled read-only. Never restore, dismiss or operate on those PRs. The parent
   result alone cannot settle suspected effects in other repositories. If any
   earlier push may have used a URL rewrite or divergent push URL, identify every
   suspected receiver from the original configuration and reconcile it read-only;
   an unchanged original PR/ref does not mean no external write. Unknown receivers
   or effects stay unknown; never replay, repair, delete refs or reset quota.

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
