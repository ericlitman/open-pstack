# Upstream synchronization

open-pstack tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack) while adapting Cursor-specific primitives for Claude Code and Codex.

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `12d587dfb20741cafc376c42c696c5f6e2a64487` |
| Upstream version | `0.15.5` |
| open-pstack version | `1.5.0` |

The table above is the current Cursor sync point. Open Pstack 1.5.0 imports this 0.15.5 sync. `README-UPSTREAM.md` preserves the upstream pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance.

## Upstream-only exclusions

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` from `23a56e2`, `889ec4b`, and `70b2dc8` are not applied. Those frequent code-writing roles stay on `codex:gpt-6.1-sol@max`.
- `5bf2b15`'s setup budget question, its `# budget` line, and its step down to a lower detected effort are not applied. Setup already asks one requested effort per assigned family, and the step-down would silently lower a requested effort.
- `12d587d`'s rule that reruns a rejected configured entry on its family default or the closest valid slug is not applied. An unavailable model stays a named dropout per `provider-dispatch.md`.
- The expected-runtime column in `70b2dc8`'s `children.tsv` and its expected-runtime stuck test are not applied. A lane is stuck only on affirmative failure evidence.
- The explicit Grok, Opus, and Sol defaults for the Why and Reflect roles are not applied. Those roles stay on `inherit-parent` because the external runner omits the parent's MCP servers.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.

## Check for changes

The repository already names Cursor's repository as the `cursor` remote in the maintainer checkout. A fresh clone can add it once:

```shell
git remote add cursor https://github.com/cursor/plugins.git
```

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch cursor main
git log --oneline 12d587dfb20741cafc376c42c696c5f6e2a64487..cursor/main -- pstack
git diff --stat 12d587dfb20741cafc376c42c696c5f6e2a64487..cursor/main -- pstack
```

No output means the tracked pstack tree has not changed. This comparison does not need a polling service or generated mirror branch.

## Incorporate a change

1. Create or update a GitHub issue in `ericlitman/open-pstack` and branch from current `main`.
2. Read each upstream pstack commit in order. Bring over its intent and content, then apply only the Claude Code and Codex substitutions documented in `CHANGES.md`.
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and provider routing in `provider-dispatch.md`; do not fork a skill per harness.
4. Update the commit and version in this file, the affected provenance rows in `NOTICE.md`, and `README-UPSTREAM.md` when upstream changes it.
5. Run CI-equivalent checks locally, then run the installed Claude Code and Codex behavioral lanes required by the changed surface. Unit tests alone are not a release gate.
6. Merge the reviewed PR before tagging the next open-pstack release.

Cursor's version and open-pstack's version are independent. Cursor's version identifies the imported content; open-pstack's version identifies the cross-harness distribution.
