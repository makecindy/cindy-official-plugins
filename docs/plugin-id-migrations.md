# Published plugin ID migrations

[简体中文](./plugin-id-migrations.zh-CN.md)

Published plugin deletion and ID changes remain rejected by the release-diff
gate unless an exact pair is registered in [`plugin-id-migrations.json`](../plugin-id-migrations.json).
Each entry names `from`, `to`, and the corresponding `serverPr`. Maintainers
review the registration in a separate PR before the rename PR uses it.

The gate reads registrations from the **base commit**, not from the rename PR.
The old directory/ID must exist in the base and disappear in the target; the new
directory/ID must be absent in the base and appear in the target. Manifest IDs
must match the pair. The new version must exceed the old version, and all
existing manifest, package, localization, provisioning and publication checks
still apply. Unregistered deletions/renames, in-place ID edits, coexistence of
both IDs, and replacing an existing target are rejected. A registration may
remain after migration; ordinary updates to the new ID use the normal gates.

The Server PR link records the implementation for review. CI neither fetches
the Server repository nor proves deployment, client availability, or a real
installation migration. The registry does not perform any migration or publish
a package.

For `baguette-simulator` → `cindy-simulator`, see the
[maintainer's sequencing decision](https://github.com/makecindy/cindy-official-plugins/pull/213#issuecomment-6389936450):
deploy [Server #1048](https://github.com/xindong/cindy-server/pull/1048) to all
replicas and release the client containing [#7014](https://github.com/makecindy/cindy/pull/7014),
then rebase plugin #213 onto main containing the reviewed registration, verify
the resulting package and CI, and obtain the maintainer's review before merging.
New package activation still requires the existing marketplace review.
