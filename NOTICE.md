# NOTICE

This plugin is a port of upstream MIT-licensed work. All upstream copyright notices and license terms are preserved. The open-pstack history begins from `michael-denyer/pstack-claude` through proven import commit `053ed78732e3b71826933170eafe7f7782dda844`.

## Upstream sources

| Component | Upstream | Copyright | License | License file |
| --- | --- | --- | --- | --- |
| `plugins/pstack/skills/poteto-mode/`, `plugins/pstack/skills/architect/`, `plugins/pstack/skills/arena/`, `plugins/pstack/skills/automate-me/`, `plugins/pstack/skills/figure-it-out/`, `plugins/pstack/skills/how/`, `plugins/pstack/skills/interrogate/`, `plugins/pstack/skills/reflect/`, `plugins/pstack/skills/show-me-your-work/`, `plugins/pstack/skills/tdd/`, `plugins/pstack/skills/typescript-best-practices/`, `plugins/pstack/skills/unslop/`, `plugins/pstack/skills/why/`, `plugins/pstack/skills/principle-*/`, `plugins/pstack/agents/poteto-agent.md` | [cursor/plugins/pstack @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |
| `plugins/pstack/skills/deslop/` | [cursor/plugins/cursor-team-kit/skills/deslop @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/deslop) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/thermo-nuclear-code-quality-review/` | [cursor/plugins/cursor-team-kit/skills/thermo-nuclear-code-quality-review @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/thermo-nuclear-code-quality-review) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/make-pr-easy-to-review/` | [cursor/plugins/cursor-team-kit/skills/make-pr-easy-to-review @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/make-pr-easy-to-review) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/fix-ci/` | [cursor/plugins/cursor-team-kit/skills/fix-ci @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/fix-ci) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/fix-merge-conflicts/` | [cursor/plugins/cursor-team-kit/skills/fix-merge-conflicts @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/fix-merge-conflicts) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/get-pr-comments/` | [cursor/plugins/cursor-team-kit/skills/get-pr-comments @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/get-pr-comments) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/hooks/run-hook.cmd` (near-verbatim) | [anthropics/claude-plugins-official → superpowers @ 6.1.0](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/superpowers) (originally obra/superpowers) | (c) 2025 Jesse Vincent | MIT | [LICENSE-superpowers](LICENSE-superpowers) |
| `plugins/pstack/skills/what-did-i-get-done/` | [cursor/plugins/cursor-team-kit/skills/what-did-i-get-done @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/what-did-i-get-done) | (c) 2026 Cursor | MIT | [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) |
| `plugins/pstack/skills/teach/`, `plugins/pstack/skills/principle-model-the-domain/`, `plugins/pstack/skills/create-verification-skill/`, `plugins/pstack/skills/maintain-verification-skill/` (v0.11.3 additions) | [cursor/plugins/pstack @ 3fe2823](https://github.com/cursor/plugins/tree/3fe2823ce17c1656c222d4b7c59d3f82fbf20143/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |
| `plugins/pstack/skills/{swarm,no-comments,technical-writing,bro}/`, `plugins/pstack/agents/comment-sicko.md`, `plugins/pstack/skills/poteto-mode/playbooks/{babysit,shipping,orchestrate,autopilot-full,autopilot-stack,worktree-cleanup,multi-phase-plan}.md`, `plugins/pstack/skills/poteto-mode/references/bugbot-triage.md`, `plugins/pstack/skills/poteto-mode/scripts/`, `plugins/pstack/skills/architect/references/design-red-flags.md`, `plugins/pstack/skills/create-verification-skill/references/feature-map-example/` (v0.14.2 additions, v0.14.3 checklist) | [cursor/plugins/pstack @ bdf7aa3](https://github.com/cursor/plugins/tree/bdf7aa355337897f167153e05069aca505dae17c/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |
| `plugins/pstack/skills/poteto-mode/playbooks/{shipping,babysit,autopilot-full,autopilot-stack,opening-a-pr,multi-phase-plan}.md`, `plugins/pstack/skills/poteto-mode/references/bugbot-triage.md`, `plugins/pstack/skills/poteto-mode/SKILL.md`, `plugins/pstack/skills/typescript-best-practices/{SKILL.md,references/patterns.md}`, `plugins/pstack/assets/logo.png` (v0.14.6 and v0.14.7 changes) | [cursor/plugins/pstack @ efa2a53](https://github.com/cursor/plugins/tree/efa2a531985e0a8084d36ff3cf87233be8a9f34b/pstack) | (c) 2026 Lauren Tan | MIT | [LICENSE](LICENSE) |

## What changed in the port

The port is editorial, not mechanical. See [CHANGES.md](CHANGES.md) for the full per-skill audit of substitutions applied.

Summary of structural changes:

- Plugin content lives at `plugins/pstack/` (with its own `.claude-plugin/plugin.json`). The repo root holds `.claude-plugin/marketplace.json` and the LICENSE / NOTICE / README / CHANGES docs.
- `.claude-plugin/marketplace.json` added at repo root so the repo is installable via `/plugin marketplace add`. The marketplace's single plugin entry sources from `./plugins/pstack`.
- The native `plugins/pstack/skills/` tree is the only user-facing workflow surface. Claude Code and Codex invoke those skills directly.
- Seven skills imported from `cursor-team-kit`: `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, `what-did-i-get-done`. All copied verbatim — no rewiring needed.
- `plugins/pstack/skills/babysit/` is independently authored as the Claude Code analog of Cursor's `/babysit` built-in. It has no upstream pstack equivalent; its workflow is informed by Cursor's public `/babysit` behavior. No code or prose was copied from any source.
- `plugins/pstack/skills/poteto-mode/scripts/` is vendored from upstream (`watch-pr`, `orch`, `bootstrap.ts`, `worktree-audit.sh`, `package.json`, `bun.lock`) with these port edits: `worktree-audit.sh` reads `~/.claude/projects/` instead of Cursor's transcript directory and warns when `jq` or `rg` is missing (their absence silently blanks the columns the prune decision reads), the private workspace package is named `@open-pstack/poteto-mode-tools`, `bootstrap.ts` rejects Node before it reads Bun-only APIs, and `package.json` includes the port-authored tests in `bun run test`. `check-plan.mjs` is the Cursor 0.14.3 checker adapted for the shared Claude Code and Codex skeleton. `bootstrap.test.ts` and `check-plan.test.ts` are authored for this port.
- `plugins/pstack/agents/comment-sicko.md` is upstream's `Comment Sicko` agent, renamed to `comment-sicko` so the name works as a Claude Code `subagent_type`. The body is verbatim.
- Claude-native Fable and Opus lanes are port-authored agent definitions. They select the rolling family alias plus requested effort for every selectable Claude-native pair in the provider-dispatch model matrix.
- A Codex build shares the same `skills/` tree. It adds `plugins/pstack/.codex-plugin/plugin.json`, a root `.agents/plugins/marketplace.json`, and `plugins/pstack/skills/poteto-mode/references/codex-tools.md` (the Claude-to-Codex tool, model, and built-in map), plus a one-line Platform note in the skills that name a Claude primitive. The skill content itself is unchanged. See [CHANGES.md](CHANGES.md#codex-port).

## Modifications

Per the MIT license, modifications are permitted. Skill bodies have been edited to substitute Cursor-specific primitives with their Claude Code equivalents (the full substitution table is in [CHANGES.md](CHANGES.md)). All upstream copyright notices in source files (where present) are preserved.

Files authored for this port (not derived from upstream):

- `plugins/pstack/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` (repo root)
- `plugins/pstack/.codex-plugin/plugin.json`
- `.agents/plugins/marketplace.json` (repo root)
- `plugins/pstack/skills/poteto-mode/references/codex-tools.md`
- `plugins/pstack/skills/poteto-mode/scripts/bootstrap.test.ts`
- `plugins/pstack/skills/poteto-mode/scripts/check-plan.test.ts`
- `plugins/pstack/skills/babysit/SKILL.md` (independently authored; workflow informed by Cursor's public `/babysit` behavior)
- `plugins/pstack/agents/pstack-fable-*.md` and `plugins/pstack/agents/pstack-opus-*.md` (Claude-native frontier lanes at each selectable effort)
- `plugins/pstack/hooks/hooks.json`, `plugins/pstack/hooks/session-start`, and `plugins/pstack/hooks/session-start-context.md` (the auto-fire hook and its mandate)
- `NOTICE.md` (this file)
- `README.md`
- `CHANGES.md`
- `LICENSE-cursor-team-kit` (copied verbatim from upstream cursor-team-kit MIT)
