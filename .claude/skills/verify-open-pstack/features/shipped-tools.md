# Shipped CLI tools from installed workflows

## Sub-features

`watch-pr` observations, `check-plan` verdict boundaries, read-only worktree audit, `statechart` charts and reports, and `show-me-your-work` logging. Exercise every tool and branch touched by selected paths; shared package changes select all tools.

## How to get to it (user POV)

Invoke the installed `poteto-mode` parent for watch/plan/audit, installed `statechart` for a chart and report, or installed `show-me-your-work` for evidence logging, through each harness's native skill surface.

## Driving it with verify-open-pstack

Use the candidate's installed help and documented arguments. Create fixture state/output under the private run root; use an explicitly named safe test PR where remote reads are required. Have the native installed workflow drive the changed tool, then inspect its real structured output and persisted state. For the audit assert no mutation; for logging check the written TSV and escaping; for statechart check the written chart and report; for watch/plan preserve the observed result and verdict. Retain native transcripts and these state artifacts. Label any direct helper invocation `local CLI` separately. Name every touched tool and changed branch in the recipe.

`bootstrap.ts` changes require its real shipped-tool consumer, `watch-pr`, including its clean dependency bootstrap path. They do not select the unrelated external runner.

## Gotchas

A mock test is not live proof. Never perform PR writes from a candidate process or edit daily workflow state as a fixture. Do not infer a successful remote read from an empty response. Candidates retain real identity and reuse normal Claude login/config and Codex's symlinked daily auth as described in `isolation.md`; GitHub and temporary state remain run-owned. No credential contents are read or copied and no extra login is started. Candidates never receive publisher credentials. This does not claim OS denial of daily-home or Keychain access. Missing access fails the feature; preserve its private reason and publish only the bounded exact-SHA result, never after failed setup restoration.

## Headless

The `shipped-tools` recipe in `recipes.ts` has the installed `show-me-your-work` workflow run its `log.sh` against a fixture TSV. It asserts the helper command ran from the installed plugin and the persisted row, including formula escaping. `watch-pr`, `check-plan`, the worktree audit, and `statechart` have no case yet.
