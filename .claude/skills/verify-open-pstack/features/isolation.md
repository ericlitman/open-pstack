# Native login and run-state contract

Reuse the operator's existing Claude Code and Codex logins. No extra login, credential source flags, credential reading/copying/parsing, token registration, or exact-secret public-comment check. This is operational state separation, not an OS security boundary.

## Trusted parent

Verifier-changing PRs run from their reviewed candidate head, with publisher revision equal to candidate SHA; all other PRs run from trusted `main`. Record publisher revision separately. GitHub authentication and publication remain exclusively in the parent; candidate processes never receive publisher credentials.

## Candidate process state

- Preserve real `HOME`, `USER`, and `LOGNAME`.
- Claude uses normal operator login/config with `claude --plugin-dir <exact-head checkout>/plugins/pstack --settings '{"enabledPlugins":{"pstack@open-pstack":false}}'`. These flags load only the candidate for that session, without persistent installation or settings changes.
- Codex installs the exact-head marketplace with `codex plugin marketplace add … --ref <sha>` and `codex plugin add` in a run-owned `CODEX_HOME`. Symlink its `auth.json` to the operator's `${CODEX_HOME:-$HOME/.codex}/auth.json`, resolving the daily home before overriding the environment.
- If the daily home has no `auth.json`, fail closed: this tool needs file-based Codex auth. Do not read credentials, copy them, or start login. Native refresh writes through the symlink to the single existing login file.
- Symlink each of `settings.json` and `auth.json` that exists in the operator's `${XDG_CONFIG_HOME:-$HOME/.config}/muse/` into the run-owned `.config/muse/`, so Muse lanes keep the operator's transport and login; removing the run state removes only the links.
- Keep temporary, GitHub, and fixture state run-owned; disable global/system Git configuration and credential helpers for candidate commands. Provider descendants use the same native-login arrangement, never publisher credentials.

Do not claim Seatbelt enforcement, source-write protection, Keychain denial, daily-home denial, or OS-backed secrecy. Provenance rechecks detect changed candidate/installed files but are not prevention.

## Setup boundary

For setup only, snapshot `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/pstack-models.md` and `CLAUDE.md` before exercise, including original absence. Restore exact bytes or absence afterwards, on success or failure, and verify restoration before any publication. Failed restoration stops the run and publishes nothing. Do not substitute a mock or generated configuration alone for installed-surface evidence.

## Private evidence and cleanup

Use a fresh external mode-0700 run root. Retain raw transcripts, artifacts, receipts, and restoration results privately through merge. Quit native sessions normally. Removing the Codex run home removes its auth symlink, never the operator's target file. No copied-credential cleanup or separate `~/.pstack-verify` login directories are needed.

After merge, archive retained evidence and let the operator delete only the named run root. Never recursively delete an operator directory or kill unrelated processes.

## Native verification

Confirm a real Mac session loads only the candidate in Claude, Codex authenticates through the symlink, daily Codex still works after any refresh, and setup restoration is byte-exact. If Codex replaces the symlink or installed pstack leaks into Claude's candidate session, stop and reopen the design rather than improvise.

## Headless

Headless sessions use the same candidate environment. `recipes.ts` describes each case; the trusted parent records the session streams under `sessions/` in the private run root.
