# Shipped CLI tools from installed workflows

## Sub-features

`orch` state transitions, `watch-pr` observations, `check-plan` verdict boundaries, read-only worktree audit, and `show-me-your-work` logging. Exercise every tool and branch touched by selected paths; shared package changes select all tools.

## How to get to it (user POV)

Invoke the installed `poteto-mode` parent for orchestration/watch/plan/audit, or installed `show-me-your-work` for evidence logging, through each harness's native skill surface.

## Driving it with verify-open-pstack

Use the candidate's installed help and documented arguments. Create fixture state/output under the run root; use an explicitly named safe test PR where remote reads are required. Have the native installed workflow drive the changed tool, then inspect its real structured output and persisted state. For the audit assert no mutation; for logging check the written TSV and escaping; for orchestration check the stored transition; for watch/plan preserve the observed result and verdict. Retain native transcripts and these state artifacts. Label any direct helper invocation `local CLI` separately. Document every touched tool and changed branch in the operator-reviewed observation.

## Gotchas

A mock test is not live proof. Never run queue/merge actions or edit daily workflow state as a fixture. Do not infer a successful remote read from an empty response. Candidate tools and descendants stay inside the macOS sandbox with run-owned `HOME`, both isolated provider configurations, and disposable explicitly selected caam session credentials. They cannot read daily home/GitHub/SSH/provider files or access Keychain/securityd; never pass publisher credentials to make a remote read succeed. GitHub evidence/status publication belongs only to the trusted parent. Missing required access fails the feature; preserve its reason without re-drafting an already-ready PR, including PR #111.
