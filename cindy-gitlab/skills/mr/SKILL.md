---
name: mr
description: Publish, display and follow GitLab merge requests using Cindy's GitLab plugin and the current task's MR card. Use for /mr, GitLab MR links and requests to prepare, open, follow, or stop following a merge request.
---

# GitLab merge requests

Use the public cindy-gitlab plugin. Its list_tools and call_tool provide the GitLab operations. mr_card and mr_follow_settings are top-level tools. A project is identified by instance and full namespace/project, including subgroups.

- **Prepare.** Inspect the repository, current branch, remote, base, commits and working tree. Before publication, call mr_card with project_path, instance, head and base. Wait for the card click or an explicit publication request. Reuse an existing MR for the same source and target. Respect draft requests.
- **Publish.** Push only the intended branch and open the MR through create_merge_request. Return its verified full HTTPS URL. Call mr_card with mr set to that URL, published=true and the original card_id when available. For an existing MR omit published. When asked only to publish, pass following=false.
- **Rename.** Apply a rename todo using set_current_session_title for this task. Start the title with !IID and summarize the subject. Confirm the title before reporting renamed=true on the same card.
- **Follow.** The card owns its schedule and selected model. Use its controls to start or stop following. Respect existing_task, paused, failed and unverified results. Never create a second schedule to compensate for one of these results. On compatible older hosts that explicitly return a follow todo without follow_state, claim ownership with claim_follow, verify the claim, then use Cindy's scheduler for this task and verify the resulting schedule before reporting following=true. Draft MRs do not start automatic follow-up.
- **Background rounds.** Read the MR status, latest pipeline, failed jobs and unresolved discussions on the same instance. Inspect new feedback in context, address actionable items within the user's scope, test changes, and push only when authorized. Recheck current head, conflicts, approvals and CI before any authorized merge. Follow the user's merge policy. When input is needed, surface the decision. An idle check stays quiet.
- **Finish.** Refresh the original mr_card on merge or close. Its managed follow-up stops after verification. Keep the MR URL in the task so the title bar and card share the same association. Manual and automatic archiving use Cindy's task-wide eligibility and the card preference.
