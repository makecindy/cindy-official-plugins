# Cleanup After Merge or Close

Read this after a pull request is merged or closed (`SKILL.md` section 6).

Run `node "<skill-dir>/scripts/pr-cleanup-plan.mjs" <PR_URL> --worktree <checkout> --fetch` from the primary checkout and follow its read-only plan:

- Only remove a worktree or local branch the plan says is safe (`canCleanupLocal`). Never delete remote branches or long-lived branches.
- `cindy_managed_worktree`: the worktree belongs to a Cindy task (including one made by `create_task_worktree`); Cindy removes it when that task is archived. Leave it.
- `canFastForwardPrimary` without `canCleanupLocal`: the plan's only command fast-forwards the primary checkout, which is clean and already on the base branch. Run it, so the next change does not start from code that lacks this one.
- A dirty target worktree: list what is uncommitted and let the user decide; never stash or force-delete it.
- Closed without merging: ask the user before removing anything.
