# Disposable credential isolation contract

The October 2 probe (issue #90 comment 5961645184) reported Darwin, Claude Code 2.1.283, codex-cli 0.160.0, Bun 1.4.0, and gh 2.97.0. This is capability evidence, not candidate isolation proof. The October 3 operator-selected caam 0.1.22 contract (issue #112 comments 5968857062 and 5969996999) supersedes the real-HOME/Keychain login approach.

## Trusted parent

Require explicit `--claude-account EMAIL` and `--codex-account EMAIL`. Validate selected vault identities once per run; record their emails in receipts. Copy only `claude/<account>/.credentials.json` into run-owned `CLAUDE_CONFIG_DIR` and `codex/<account>/auth.json` into run-owned `CODEX_HOME`. Never activate accounts, modify/write back to the vault, copy daily configuration, or introduce login. Missing/mismatched credentials and quota exhaustion fail closed. GitHub authentication and publication remain exclusively in the trusted parent.

## Candidate boundary

- Use run-owned `HOME`, `TMPDIR`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME` for both parent harnesses and cross-provider descendants. Preserve real `USER`/`LOGNAME`; scrub publisher tokens and daily API credentials.
- Claude: candidate `--plugin-dir`, empty `--settings`, and `--setting-sources project`. This loads pinned project skills/settings while excluding user settings.
- Codex: pinned local marketplace/plugin installation, then a fresh native session. Validate installed identity, enabled state, contained path, and pinned source provenance; unknown schemas fail closed.
- Enforce candidate filesystem and credential isolation with macOS `sandbox-exec`, inherited by descendants. Deny daily home, `~/.config/gh`, `~/.ssh`, real `~/.claude`, real `~/.codex`, caam vault, and Keychain/securityd access. Do not link any real Library/Keychain path into run-owned state. Environment scrubbing alone is insufficient.
- Never invoke candidate login, create/reset/unlock Keychain, or use daily auth as fallback. Only copied disposable credentials may authenticate native API requests.

Verify tracked plugin/project-skill provenance against immutable pinned Git objects before and after exercise. Before launching a native session, call `protectSources(profile, home, sources, run?)` with canonical workspace and installed-plugin roots, then use its returned exercise policy for every candidate command. The policy is an exclusive-create mode-0600 file beside the original policy, outside candidate-writable state. Source roots and all ancestors must be canonical directories, not symlinks. Source/plugin writes and ancestor rename/unlink are denied except workspace `.claude/skills/verify-open-pstack/node_modules`, workspace `plugins/pstack/skills/poteto-mode/scripts/node_modules`, and installed-plugin `skills/poteto-mode/scripts/node_modules`. No broader write allowance is added; the original daily-home/vault/Keychain denies remain in force. Generated directories are established before freezing their parents. Rehashes alone cannot prevent modify-execute-restore, so pending adapter integration is a blocker. Candidate self-test uses `doctor --candidate` without vault/publisher probing.

## Operator-Mac proof

Runtime `run` automatically executes the pinned `scripts/isolation.test.ts` from a separate trusted exact-SHA checkout, with `PSTACK_OPERATOR_SENTINELS=1`, before copying disposable credentials. It retains `mac-isolation-proof.txt` outside candidate state, validates both named Mac tests passed without skips/failures and a successful exit, and requires explicit operator review of no Keychain dialog. The receipt binds SHA, canonical proof path/hash, and the review. Each native session then requires an operator-observed authenticated API request/response assertion bound to its reviewed transcript hash and `PASS AUTH <harness>` confirming no Keychain dialog. Both harnesses are mandatory. Missing, mismatched, overwritten, skipped, or rejected proof blocks success/readiness at publication boundaries. Fake unit-driver proof exercises validation without claiming Mac enforcement.

For a separate diagnostic check, from the trusted verifier checkout run:

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

The actual-HOME test requires explicit opt-in. It exclusively creates randomized `.pstack-denial-<UUID>` non-secret files in the real daily home, `~/.config/gh`, `~/.ssh`, `~/.claude`, `~/.codex`, and `~/Library/Keychains`; no existing daily file or actual Keychain database is opened for writing. Noncanonical/symlinked daily directories fail before sentinel creation. It removes only its own files and directories it created that remain empty; cleanup paths are printed for safe recovery after interruption. Never recursively remove daily directories.

Require both Mac tests to pass without skips. Positive unsandboxed reads prove sentinels exist; sandboxed direct reads, aliases, descendants, and writes must be denied and sentinel content preserved. Keychain Mach-service denial requires a reachable unsandboxed control for the same service; a missing service is not proof. Exercise-policy tests require protected source writes/unlinks/renames, ancestor moves, alias writes, hardlinks, and policy replacement to fail while all three generated dependency leaves remain writable. Record the emitted denial proof in `$PROOF/isolation-proof.txt` alongside the exact-head receipt. Linux skips or stubbed wrappers cannot establish Seatbelt enforcement. No Keychain dialog and authenticated API requests in both harnesses still require operator observation during native live sessions, not inference from these tests. Missing adapter integration or failed tests block delivery. After Unfret passes, use explicit-account Launch commands with fresh probe/live directories; leave PR #111 ready.

## Cleanup

Delete all copied session credential files in final cleanup on success or failure, including child-provider copies; record the outcome and block on cleanup failure. Keep redacted receipts/transcripts/artifacts and sentinel-denial proof. Never modify vault/daily files or delete evidence as credential cleanup. Subsequent operator removal is limited to named run-owned state.
