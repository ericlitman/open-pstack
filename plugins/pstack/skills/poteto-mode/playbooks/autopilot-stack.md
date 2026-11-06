### Autopilot-stack

Run the Autopilot-full playbook, but do not merge.

1. **In place of step 5, stop at verified.** Stop when each PR is verified and green at its current head, then hand the PRs to the operator. After the handoff, nobody pushes without the operator's go. Every loop tick prompt names this file (`skills/poteto-mode/playbooks/autopilot-stack.md` under the installed plugin), so each tick sees the no-merge rule.
2. **Stack a PR only when it builds on another PR.** This is the one exception to step 3. Base the PR on the other PR's branch in place of trunk, per **Size and stacks** in `playbooks/opening-a-pr.md`. Each owner restacks its own branch through the stacked-owner rule in Autopilot-full step 2, with the same disarm-and-confirm rule and captured-SHA lease.

**Reply:** list each PR with its verdict, in place of what merged.
