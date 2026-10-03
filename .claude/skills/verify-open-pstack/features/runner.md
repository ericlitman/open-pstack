# Runner and provider dispatch

## Sub-features

Strict argument validation, parent/provider routing, external child launch, prompt delivery, output and receipt persistence, and failure reporting; inspect the diff for which branches changed.

## How to get to it (user POV)

Invoke the installed parent workflow (`poteto-mode`, `arena`, or `swarm` as documented by the candidate) in the fresh isolated harness. Have that parent dispatch its documented external-provider lane.

## Driving it with verify-open-pstack

Read the candidate's `pstack-runner --help` and installed mapping through the native skill. Use a run-owned fixture and fresh output/receipt paths. Exercise all changed provider lanes without changing parent routing. Retain the native parent/child transcript, provider receipt, output, and concrete fixture effect. Confirm provider/model/effort/access mode match the requested route and output belongs to this invocation. Exercise changed invalid-input/failure branches as well. Keep direct runner tests in a separately labeled local-CLI artifact, never as the installed-harness result.

## Gotchas

Every external-provider child inherits the OS-enforced macOS sandbox, run-owned `HOME`/`TMPDIR`, and both run-owned `CLAUDE_CONFIG_DIR` and `CODEX_HOME`; never allow Claude→Codex or Codex→Claude to fall back to daily configuration. The trusted parent copies only the explicitly selected caam account credentials, records both emails, and deletes copied credentials in final cleanup. No candidate login, vault activation/writeback, Library/Keychain link, or Keychain/securityd access is allowed. Retain real-filesystem sentinel-denial evidence and observable native API requests for the dispatched lanes. A missing provider or unusable authentication is a failure, not a skip or weaker-model fallback. Do not add implicit timeouts. A model assertion that a child ran is insufficient; inspect the actual receipt and output. Never reuse output from another SHA or run.
