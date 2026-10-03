---
name: verify-open-pstack
description: Verify an Open Pstack PR's exact head in isolated Claude Code and Codex sessions, retain operator-reviewed real-surface evidence, and publish the live gate.
---

# Verify Open Pstack

## Launch

This repository-local, non-shipped skill is shared with Codex through `.agents/skills/verify-open-pstack`. Run the reviewed verifier from a trusted checkout on the operator's Mac. GitHub publishing belongs exclusively to the trusted parent; never expose its credentials to candidate processes. The helper never queues or merges.

```sh
(cd .claude/skills/verify-open-pstack && bun install --frozen-lockfile)
PR=111 # supplied delivery PR number
CLAUDE_ACCOUNT='selected-claude-account@example.com' # explicit caam vault identity
CODEX_ACCOUNT='selected-codex-account@example.com' # explicit caam vault identity
SESSION="$(mktemp -d "${TMPDIR:-/tmp}/open-pstack-evidence.XXXXXX")"
EVIDENCE="$SESSION/live" # must not exist yet
.claude/skills/verify-open-pstack/scripts/verify.sh doctor --output "$SESSION/probe"
.claude/skills/verify-open-pstack/scripts/verify.sh run --pr "$PR" --self-test \
  --claude-account "$CLAUDE_ACCOUNT" --codex-account "$CODEX_ACCOUNT" --output "$EVIDENCE"
```

Replace both account placeholders with explicitly selected caam 0.1.22 vault identities; no default account or new authentication flow is allowed. Omit `--self-test` for ordinary plugin verification; it is mandatory for this skill's delivery. Use fresh evidence directories for every run. Pin the open, same-repository PR's exact head and base SHAs, classify changes from immutable Git objects, and recheck the PR at phase and publication boundaries. Unknown paths abort; previous evidence never transfers to a new head.

## Doctor

The trusted-parent probe requires Darwin, Bun, gh authentication for publication, both harness CLIs, caam 0.1.22, and supported macOS `sandbox-exec` isolation. It records `doctor.json`; capability checks do not prove installation, authentication, sandbox enforcement, or live behavior. Missing capabilities fail closed.

Claude uses candidate `--plugin-dir`, empty `--settings`, `--setting-sources project`, and run-owned `CLAUDE_CONFIG_DIR`. Codex uses local marketplace/plugin installation and run-owned `CODEX_HOME`. Both sandboxed candidates use run-owned `HOME` and `TMPDIR`, retaining real `USER`/`LOGNAME` only for account identity. Both provider config variables must be isolated for cross-provider children. Do not link the real `Library` or Keychain into candidate state. Deny daily-home, GitHub/SSH/provider configuration, vault, and Keychain/securityd access with an OS-enforced boundary, not environment scrubbing alone. Never create, reset, unlock, or otherwise modify Keychain.

The disposable credential contract replaces the earlier real-HOME/Keychain approach. The trusted parent validates each explicitly named vault identity and copies only `claude/<account>/.credentials.json` into `CLAUDE_CONFIG_DIR` and `codex/<account>/auth.json` into `CODEX_HOME`. It records the selected emails in the receipt, never modifies or activates the vault, and removes copied credential files in final cleanup. Candidates may use these disposable session credentials, but not publisher credentials or daily provider API keys. Missing credentials, identity mismatch, or quota failure stops the run; never log in or fall back to daily state.

Operator-Mac handoff, from the trusted verifier checkout:

```sh
PROOF="$(mktemp -d "${TMPDIR:-/tmp}/open-pstack-isolation-proof.XXXXXX")"
(
  set -e -o pipefail
  test "$(uname -s)" = Darwin
  cd .claude/skills/verify-open-pstack
  PSTACK_OPERATOR_SENTINELS=1 bun test --timeout 0 scripts/isolation.test.ts 2>&1 |
    tee "$PROOF/isolation-proof.txt"
)
```

Runtime `run` now executes this suite automatically in a separate trusted checkout of the pinned SHA, with `PSTACK_OPERATOR_SENTINELS=1`, **before copying disposable credentials**. It retains `mac-isolation-proof.txt` outside candidate state and requires both named Mac tests to report PASS with no skips/failures and a successful exit. The receipt binds its canonical path/hash and the exact SHA; missing or modified proof prevents success/readiness. The operator must review the result and explicitly confirm no Keychain dialog appeared. After **each** native session, review an observable authenticated API request/response in the retained transcript, describe the assertion, and confirm `PASS AUTH claude` or `PASS AUTH codex` plus no Keychain dialog. Model self-reports are not proof. The receipt retains these assertions and their reviewed transcript hashes, revalidated at publication boundaries. Fake unit-driver proof tests the gate only and does not establish OS enforcement.

The explicit sentinel opt-in plants randomized, exclusive-create, non-secret files in the actual operator `HOME`, `~/.config/gh`, `~/.ssh`, `~/.claude`, `~/.codex`, and `~/Library/Keychains`; it never overwrites credential/SSH/Keychain files. Redirected directories fail closed. The trusted test parent removes only its own sentinel files and newly created empty directories in `finally`; if interrupted, inspect the printed cleanup-path list and remove only those named sentinel files, never whole daily directories. Require positive unsandboxed read controls and denied sandboxed reads/writes, aliases, and descendant reads; require positive unsandboxed Keychain-service lookup followed by denial of the same service. The real Mac test also proves pinned workspace/plugin write, unlink, rename, alias-write, and hardlink denial while the three approved dependency leaves remain writable. Preserve `$PROOF/isolation-proof.txt` and require both Mac tests to pass without skips. Linux skips and stubbed commands are not Mac enforcement proof. Then run Launch with fresh probe/live directories. Record that no Keychain dialog appeared and both native sessions made observable authenticated API requests; neither observation can be inferred from sentinel tests. Missing/pending adapter integration or failed proof blocks live verification.

## Drive

Read `features/README.md` and every selected feature document. Runtime instructions, consumed references, and installed assets require live coverage. Shared paths select consumers conservatively. `no runtime change` launches no harness unless the separate self-test is requested.

Create detached exact-head candidate checkouts, run-owned homes/config roots and fixture workspaces. Claude loads the explicit candidate plugin; Codex installs its local marketplace. Verify installed plugin and canonical project-skill sources against immutable pinned Git provenance before and after exercise. Before native exercise, adapters must call `protectSources(profile, home, [workspace, installedPlugin])` and switch all candidate/descendant commands to the returned exercise policy outside candidate-writable state. That policy freezes the workspace and installed plugin, including ancestor rename/unlink, except `.claude/skills/verify-open-pstack/node_modules` and `plugins/pstack/skills/poteto-mode/scripts/node_modules` under the workspace and `skills/poteto-mode/scripts/node_modules` under the installed plugin. Reject source/ancestor symlinks rather than protecting a redirected path. Hash rechecks alone cannot prevent modify-execute-restore. Only those generated dependencies may be excluded; tracked source mutations or redirected skill aliases fail. Version strings alone are insufficient.

Every candidate command and external-provider descendant must remain inside the macOS sandbox, with both isolated provider configurations and no access to trusted-parent credentials. Setup exercises write only fixture run-owned homes, never literal daily user files. No candidate login, vault activation/writeback, implicit timeout, or weaker-model fallback is permitted.

For every selected feature in both fresh native sessions, exercise changed sub-features and retain actual native tool calls and concrete fixture effects. Save redacted transcripts and artifacts outside isolated state. Require operator-reviewed surface, action, expected/observed result, and retained artifact paths. Model self-reports and direct CLI tests are not installed-harness evidence.

For `project-skill`, invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex. Ask the discovered pinned skill to run `verify.sh doctor --candidate --output <fresh-run-owned-directory>`. Candidate-mode doctor must not probe the vault or publisher authentication. Preserve the invocation and canonical-path doctor output; forbid recursive verification or publication. This does not replace required plugin exercises.

## Evidence

Retain probe output, `receipt.json`, selected account emails, immutable source/installation provenance, redacted transcripts, artifacts, sandbox-denial proof, observable native API requests, and credential-cleanup outcome. Never retain copied credentials as evidence. Revalidate retained transcript/artifact hashes immediately before publication and around GitHub writes. Keep full detail in the receipt and bound the published summary.

The trusted parent publishes evidence only in its run's own pinned-SHA comment. It never writes the PR body; `receipt.json` retains `proposedTemplate`, including the proposed `Live evidence:` block with installed version, surface, action, and observed result, for the operator to apply without overwriting unrelated edits. Only complete evidence permits `live-gate=success` targeting that comment. After publication, the helper makes at most one forward, idempotent mark-ready call and makes no call when the PR is already ready. It never reverses, undoes, or compensates draft/ready state. Failure or head movement publishes `live-gate=failure` on the pinned SHA and leaves the PR's draft state untouched; record failed status compensation prominently.

PR #111 is already ready and must not be re-drafted during this review round. Builders do not post the gate, queue, or merge. After Unfret passes, the operator performs fresh exact-head live proof. Mergify queues automatically once required checks pass and the PR is ready; no manual queue submission is required. A queue-created head needs a new run, never a hand-posted replacement status.

## Cleanup

Final cleanup removes copied Claude `.credentials.json` and Codex `auth.json` files on success or failure, including disposable copies created for provider children. Record cleanup outcome without secrets; failed cleanup is a blocker requiring explicit remediation. Never modify the caam vault or daily files. Retain receipts, redacted transcripts, artifacts, and denial proof. Quit native sessions normally; after archiving evidence the operator may remove only named run-owned candidate/state/workspace paths. No unrelated process killing or implicit runtime timeout.

## Helpers

- `scripts/verify.sh doctor --output <fresh-absolute-external-directory>`: trusted-parent capability report, no installation/publication.
- `scripts/verify.sh doctor --candidate --output <fresh-run-owned-directory>`: planned sandboxed self-test probe; no vault or publisher authentication probing.
- `scripts/verify.sh run --pr <positive-number> --claude-account <EMAIL> --codex-account <EMAIL> [--self-test] --output <fresh-absolute-external-directory>`: supervised exact-head verification; mapped exercises require an interactive terminal.
- `bun test scripts/isolation.test.ts` on the operator Mac: required real-filesystem and Keychain/securityd denial proof, not a substitute for live behavior.
- `bun run test` and `bun run typecheck`: independent helper tests and strict types, not live proof.
- `features/registry.json`: maintained path ownership; unknown runtime paths block.

Read receipts as data, never shell input. Do not put secrets in prompts or artifacts.
