# Installed skill invocation

## Sub-features

Every registry skill is its own required feature. Include changed arguments, routing, consumed references, helper actions, and removal behavior. Principle leaves are model-invocable, not slash-menu entries. `project-skill` separately verifies this repository-local skill's discovery.

## How to get to it (user POV)

In the fresh isolated Claude session invoke `/pstack:<name>`. In Codex use the installed skill selector or `$<name>`. Invoke principle leaves through the model's native skill tool. For self-test invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex.

## Driving it with verify-open-pstack

Launch the prepared harness with its sandboxed recorded launcher: run-owned `HOME`/`TMPDIR`, both isolated provider config roots, and real `USER`/`LOGNAME`. Use only trusted-parent copies of the explicitly selected caam account credentials; no login, daily-state fallback, vault mutation, or Library/Keychain link. Deny daily-home/GitHub/SSH/provider and Keychain/securityd access for descendants too, and retain operator-Mac sentinel-denial proof plus observable native API requests. Final cleanup deletes copied credentials, not evidence. For each selected name, use a disposable fixture appropriate to its documented input, invoke the installed surface, and exercise every changed sub-feature. Observe native tool/skill loading and a concrete fixture effect, not the assistant saying it passed. Save the transcript and an artifact showing the actual result (diff, generated file, tool receipt, or UI capture). Include input, expected result, observed result, and each changed sub-feature in the operator review.

For `project-skill`, invoke the discovered skill and ask it to run planned `verify.sh doctor --candidate --output <fresh-run-owned-directory>`; candidate mode must not probe the caam vault or publisher authentication. Forbid recursive `run`/publication. Preserve the native invocation transcript plus `doctor.json`, checking the canonical executable path and immutable source provenance belong to the pinned project skill. Revalidate source after exercise, excluding only explicitly permitted generated dependencies. The Codex symlink and Claude canonical directory must both be discovered in fresh sessions. If candidate mode is unavailable, stop; do not substitute trusted-parent doctor.

## Gotchas

A generic prompt about a skill is not native invocation evidence. A list of discovered skills is not behavioral proof. If an invocation would merge, queue, release, or access daily state, use a safe disposable fixture or record failure; do not weaken the gate. Never use the child verifier to publish a status.
