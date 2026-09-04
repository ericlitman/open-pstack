# open-pstack technical reference

This page contains the full skill, dependency, runtime, and porting reference. For the plain-English introduction and quick start, see the [main README](../README.md).

[Poteto](https://x.com/poteto)'s [pstack](https://github.com/cursor/plugins/tree/main/pstack), adapted to run in Claude Code and Codex without Cursor. One shared skill tree serves both harnesses; Grok remains available as a model-provider lane. Version 1.3.0 is synced to Cursor pstack v0.14.7 at `efa2a531985e0a8084d36ff3cf87233be8a9f34b`. See [UPSTREAM.md](../UPSTREAM.md) for the exact sync contract.

Original by Lauren Tan. This distribution builds on Michael Denyer's [pstack-claude](https://github.com/michael-denyer/pstack-claude) port and retains its history and MIT attribution. It imports seven MIT-licensed skills from [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit): `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, `what-did-i-get-done`.

> if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence.

This is not a verbatim copy. Skill bodies have been edited so every Cursor-specific primitive resolves to its Claude Code or Codex equivalent — see [Differences from upstream](#differences-from-upstream) for the full list. The exhaustive per-skill audit lives in [CHANGES.md](../CHANGES.md); license attribution lives in [NOTICE.md](../NOTICE.md); the upstream README is preserved verbatim at [README-UPSTREAM.md](../README-UPSTREAM.md).

## Install

### Claude Code

This repo ships as a Claude Code marketplace containing one plugin (`pstack`).

```text
/plugin marketplace add ericlitman/open-pstack
/plugin install pstack@open-pstack
/reload-plugins
```

The plugin auto-fires through a `SessionStart` hook on startup, `/clear`, and post-compact. The hook injects a small mandate that routes non-trivial engineering work into `poteto-mode`; the full skill loads only when invoked. Dispatched subagents ignore the mandate, and explicit user instructions take precedence. To opt out, delete `hooks/hooks.json` from the installed copy at `~/.claude/plugins/cache/open-pstack/pstack/<version>/hooks/hooks.json`; a plugin update restores it.

### Codex

The same plugin carries a `.codex-plugin/plugin.json` manifest and a root `.agents/plugins/marketplace.json`. Install it through the Codex marketplace:

```shell
codex plugin marketplace add ericlitman/open-pstack --ref main
codex plugin add pstack@open-pstack
```

Codex discovers the plugin skills under the `pstack` namespace, so they list as `pstack:poteto-mode`, `pstack:tdd`, and so on. The namespace comes from `plugins/pstack/.codex-plugin/plugin.json`. To enable the multi-model and parallel-subagent skills (`interrogate`, `arena`, `how`, `why`, `reflect`, `architect`), turn on subagents in `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

For local plugin development, you can clone the repository and link its skills directly:

```shell
git clone https://github.com/ericlitman/open-pstack
cd open-pstack
for s in plugins/pstack/skills/*/; do ln -s "$PWD/$s" ~/.agents/skills/"$(basename "$s")"; done
```

The marketplace install is the normal user path. Direct links are only for testing a checkout before publishing it. Remove the linked skill directories when the test is over.

## Layout

```text
.
├── .claude-plugin/marketplace.json   # Claude Code marketplace manifest (repo root)
├── .agents/plugins/marketplace.json  # Codex marketplace manifest (repo root)
├── plugins/pstack/                   # the plugin itself
│   ├── .claude-plugin/plugin.json    # Claude Code manifest
│   ├── .codex-plugin/plugin.json     # Codex manifest (skills: ./skills/)
│   ├── skills/                       # 52 skills shared by Claude Code and Codex
│   │   ├── poteto-mode/references/{codex-tools,provider-dispatch}.md  # tool + provider routing
│   │   └── poteto-mode/scripts/      # bun/bash/node tooling: watch-pr, orch, runner, check-plan.mjs, worktree-audit.sh
│   ├── hooks/                        # SessionStart auto-fire: injects the poteto-mode mandate (Claude Code only)
│   └── agents/                       # Claude subagents, including native Fable and Opus lanes at each selectable effort
├── tests/skill-collision-repro.sh    # native-skill package invariants and Claude invocation checks
├── LICENSE                           # pstack upstream MIT
├── LICENSE-cursor-team-kit           # cursor-team-kit upstream MIT
├── LICENSE-superpowers               # superpowers upstream MIT (hook runner)
├── NOTICE.md                         # attribution table
├── UPSTREAM.md                       # current Cursor sync point and update procedure
├── CHANGES.md                        # per-skill substitution audit
├── README.md                         # plain-English introduction and quick start
└── docs/reference.md                 # this technical reference
```

Plugin-internal `skills/<name>/` path references in the docs below are relative to `plugins/pstack/`.

## Running on Codex

The Codex build shares one `skills/` tree with the Claude Code build. Nothing is forked or generated. Two narrow references keep runtime translation separate: `codex-tools.md` maps harness primitives and `provider-dispatch.md` maps model providers. pstack otherwise keeps the upstream Claude-native prose and adds a one-line Platform note to each skill that names a Claude primitive, so the port stays in lockstep with upstream sync.

- **Skill invocation.** Codex loads `SKILL.md` natively. There is no `Skill` tool. You invoke a skill by name (ask for it, or pick `pstack:poteto-mode` from the list).
- **Package surface.** The native `skills/` tree is the only workflow source. The plugin ships no `commands/` layer and does not link prompts into `~/.codex/prompts/`. Codex would migrate such files into duplicate source-command skills while loading the native skill tree. The 21 `principle-*` leaves declare `user-invocable: false`. Claude keeps them out of its user picker; Codex 0.149.0 currently shows them despite that metadata ([#8](https://github.com/ericlitman/open-pstack/issues/8)).
- **Tool and built-in mapping.** Claude tool names and built-in skills resolve through [`codex-tools.md`](../plugins/pstack/skills/poteto-mode/references/codex-tools.md). Model execution resolves separately through [`provider-dispatch.md`](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md), so Codex can keep Sol native while invoking Claude and Grok externally.
- **Subagents.** The `Agent` tool maps to Codex `spawn_agent` / `wait_agent`, enabled by `multi_agent = true`. Parallel fan-out is multiple `spawn_agent` calls in one turn. If the native Codex lane is unavailable, record that lane as a dropout; external Claude and Grok lanes still run, and no provider is silently substituted. There is no `poteto-agent` subagent type on Codex; route ad-hoc subagents by dispatching a `spawn_agent` told to read `poteto-mode` first.
- **Auto-fire.** The `hooks/` SessionStart injection is Claude Code-only; Codex has no plugin hook runtime. Enter `pstack:poteto-mode` by name, or add a standing instruction to `~/.codex/AGENTS.md` if you want the same always-on routing.
- **Models.** `/setup-pstack` writes provider-qualified descriptors and asks one requested effort per frontier family (`low`, `medium`, `high`, `xhigh`, `max`). The first-run panel is Fable max, GPT-5.6 Sol max, Grok 4.6 xhigh, and Opus xhigh. Fable and Opus use Claude's rolling aliases. Runtime dispatch normalizes older versioned descriptors in memory, so an installed sheet stops pinning immediately. A setup rerun persists that migration while keeping each role's family and effort. In Codex, Sol uses native `spawn_agent`; Claude and Grok use the deterministic external runner. In Claude Code, Fable and Opus use native agents; Sol and Grok use the runner. Children never detect the parent or reroute themselves. The `bug-fix`, `perf-issue`, and `hillclimb` roles stay on GPT-5.6 Sol max instead of upstream's Fable default because Sol costs less for these frequent delegated code roles.

Verified in fresh installed Claude Code and Codex sessions: the user-facing skills are discovered and namespaced under `pstack`; both parents fan out the frontier quad through the documented native/external route table, retain long-running handles without a default timeout, and cross-judge only after every candidate is terminal. The `principle-*` leaves remain available for `poteto-mode` to read by path. Claude honors their `user-invocable: false` metadata; Codex 0.149.0 does not ([#8](https://github.com/ericlitman/open-pstack/issues/8)).

## Dependencies

Nothing is declared in `plugin.json`. Install the one companion plugin yourself:

- **`plugin-dev`** (from the `claude-plugins-official` marketplace) — the rewiring routes skill-authoring tasks (in `automate-me`, `reflect`, `poteto-mode`) to the `plugin-dev:skill-development` skill:

  ```shell
  /plugin marketplace add anthropics/claude-plugins-official
  /plugin install plugin-dev@claude-plugins-official
  ```

  Until 0.9.2 this was a `dependencies` entry in `plugin.json`. The desktop app's `--plugin-dir` load mode can never resolve cross-marketplace dependencies and hard-disables the whole plugin, so 0.9.3 removed the declaration — full mechanism in the 0.9.3 entry of [CHANGES.md](../CHANGES.md). Without `plugin-dev` installed, only the skill-authoring routes degrade; everything else works.

Not declared as deps, but referenced in skill bodies:

- **`run`, `verify`, `loop`** — Claude Code CLI built-ins (ship with the binary, always available).
- **`gh` (GitHub CLI).** This is the default forge for every stack playbook and a system-level requirement of the standalone `babysit` skill. Install it with [`brew install gh`](https://cli.github.com) and authenticate with `gh auth login`. If Origin's `origin` CLI is installed and can resolve the repository, the stack playbooks use it instead. Only the Orchestrate playbook and its `scripts/orch` frontier tooling still require `gt`.
- **`bun`** — runs the vendored `skills/poteto-mode/scripts/` tooling (`watch-pr`, `orch`, `runner`). Install via [`brew install oven-sh/bun/bun`](https://bun.sh). `bootstrap.ts` installs dependencies for `watch-pr` and `orch`; the runner uses only Bun and Node built-ins, so it launches directly without an install/re-exec layer.
- **`node`** — runs `skills/poteto-mode/scripts/check-plan.mjs`. The checker uses only Node built-ins and does not need Bun.
- **Claude Code, Codex, and Grok Build CLIs** — the external runner uses the assigned subscribed CLI directly. Install and authenticate only the providers present in your model sheet. Same-provider work stays native; the runner refuses it.
- **`jq` and `rg` (ripgrep)** — only for `scripts/worktree-audit.sh` (the Worktree cleanup playbook). Without them the audit still runs but blanks its PR and LAST_CHAT columns, so it warns on stderr rather than returning a table that looks complete.

No third-party plugins. The harsher-critique escape hatch lives in the bundled `thermo-nuclear-code-quality-review` skill (imported from cursor-team-kit), not in an external plugin.

## Skills

The table uses the short upstream names. Claude Code exposes each native skill with a `/pstack:` prefix, such as `/pstack:poteto-mode`. In Codex, ask for the namespaced skill, such as `pstack:poteto-mode`.

| skill | use it when |
| --- | --- |
| `/poteto-mode` | default entry point for any non-trivial task |
| `/how` | walk through how a subsystem works |
| `/why` | investigate why something was built this way (parallel multi-MCP evidence) |
| `/architect` | settle types and module shape before writing code that crosses a function boundary |
| `/arena` | run N parallel attempts at the same task and pick the best parts |
| `/interrogate` | have four different models try to break a diff |
| `/automate-me` | draft your own personal -mode skill from recent transcripts |
| `/reflect` | capture a long task's lessons as a skill edit |
| `/tdd` | fix a bug by writing the failing test first, then the fix |
| `/typescript-best-practices` | ground type-system discipline in TypeScript syntax |
| `/teach` | understand a change or subsystem for real: `how` + `why` woven into one plain explanation |
| `/swarm` | fan out N parallel workers across slices or races, then one aggregated report |
| `/technical-writing` | write docs, RFCs, readmes, PR descriptions, and commit messages to one layered standard |
| `/bro` | restate the last message in plain human language, no jargon |
| `/figure-it-out` | design a rigorous, auditable playbook for a task no bundled playbook fits |
| `/show-me-your-work` | log decisions to a reviewable tsv decision trail |
| `/blast-radius` | find what a change could break beyond the diff and prove safety by running code |
| `/recall` | catch up on recent working context from chat history, live state, and the shared record |
| `/setup-pstack` | configure pstack per-role model choices and per-family requested effort |
| `/unslop` | clean up writing by removing AI tells |
| `/no-comments` | strip comments before review via the `comment-sicko` subagent, then fix what it finds |
| `/create-verification-skill` | generate a project-local verification skill and feature map |
| `/maintain-verification-skill` | re-sync a drifted verification skill and its feature map |
| `/deslop` | deslop a diff before commit |
| `/babysit` | monitor an open PR, fix CI/comments, keep it merge-ready |
| `/thermo-nuclear-code-quality-review` | extremely strict maintainability audit |
| `/make-pr-easy-to-review` | clean noisy history and improve PR description before review |
| `/fix-ci` | find failing PR checks, inspect logs, apply focused fixes |
| `/fix-merge-conflicts` | non-interactively resolve merge conflicts, validate, finalize |
| `/get-pr-comments` | fetch and summarize review comments from the active PR |
| `/what-did-i-get-done` | summarize authored commits over a user-chosen period |

## Subagents

`poteto-agent` ships unchanged. Spawn from a parent with `subagent_type: "poteto-agent"`.

`comment-sicko` is the read-only comment reviewer the `no-comments` skill spawns. Upstream names it `Comment Sicko`; the port renames it to `comment-sicko` so the name is a valid `subagent_type`. Invoke it through `/no-comments`, not directly.

Fable and Opus each ship at `low`, `medium`, `high`, `xhigh`, and `max`. Names are `pstack-<stem>-<effort>`. `pstack-fable-max` and `pstack-opus-xhigh` remain. Each file selects the rolling family alias and requested effort, runs in the background, and denies nested Agent/Task dispatch. pstack dispatches them from provider-qualified descriptors; they are not user-facing workflows.

## Differences from upstream

The port is editorial, not mechanical. Anywhere upstream pstack assumed Cursor-specific primitives, this port substitutes the Claude Code equivalent so refs actually resolve. Two prior ports ([v1truv1us/ai-eng-system](https://github.com/v1truv1us/ai-eng-system), [Evan-Kim2028/agent-fleet](https://github.com/Evan-Kim2028/agent-fleet)) stop at namespacing — they vendor pstack under `pstack/` and leave the Cursor refs intact. This port does the content surgery.

### What's added

- **`skills/babysit/`** — Claude Code analog of Cursor's closed-source `/babysit` built-in. Wraps `gh pr view` / `gh pr checks` / `gh run view --log-failed` plus the `loop` skill for pacing. Independently authored; workflow informed by Cursor's public `/babysit` behavior — not a copy of Cursor's implementation. Since the v0.14.2 sync, poteto-mode routes PR-status requests to the ported `playbooks/babysit.md` instead, and this skill is the standalone `/babysit` entry point.
- **`skills/deslop/`** — imported verbatim from `cursor-team-kit`. Cleans AI tells out of diffs before commit.
- **`skills/thermo-nuclear-code-quality-review/`** — imported verbatim from `cursor-team-kit`. Used as the harsher-critique escape hatch in `arena`, `interrogate`, `architect`, and `how` (replaces the Cursor-original cross-vendor bridge).
- **`skills/make-pr-easy-to-review/`** — imported verbatim from `cursor-team-kit`. Composes with `opening-a-pr` and `babysit`.
- **`skills/fix-ci/`** — imported verbatim from `cursor-team-kit`. Narrower CI-fix primitive that `babysit` can route to.
- **`skills/fix-merge-conflicts/`** — imported verbatim from `cursor-team-kit`. Pairs with `babysit` step 5.
- **`skills/get-pr-comments/`** — imported verbatim from `cursor-team-kit`. Primitive for `babysit` step 4 and `reflect`.
- **`skills/what-did-i-get-done/`** — imported verbatim from `cursor-team-kit`. Commit summary over a chosen period.

### What's substituted in skill bodies

| Upstream (Cursor) | This port (Claude Code) |
| --- | --- |
| `Task` tool, `subagent_type: generalPurpose`, `readonly: false/true` | `Agent` tool with model selection, requested effort, and `disallowedTools`; access mode is assigned by the parent, with writers isolated in worktrees |
| `AskQuestion` tool | `AskUserQuestion` tool |
| Cursor's built-in `/loop` | Claude Code's built-in `loop` skill |
| Cursor's built-in `/babysit` | `babysit` skill bundled in this plugin. From v0.14.0 upstream routes PR-status requests inside poteto-mode to `playbooks/babysit.md` instead; the port does the same, and `/babysit` stays the standalone entry point |
| Cursor's built-in `/create-skill` | `plugin-dev:skill-development` skill |
| `cursor-team-kit` `control-cli` (CLI/TUI driver) | Claude Code's `run` skill |
| `cursor-team-kit` `control-ui` (browser/Electron driver) | Claude Code's `verify` skill |
| Transcripts at `~/.cursor/projects/*/` or `agent-transcripts/` | `~/.claude/projects/<encoded-cwd>/*.jsonl` (where `<encoded-cwd>` is the workspace cwd with `/` → `-`) |
| Skill paths `.cursor/skills/`, `~/.cursor/plugins/` | `.claude/skills/`, `~/.claude/plugins/` |
| MCP discovery via Cursor's `mcps/` directory | Tool list at top of system prompt (`mcp__<server>__<name>` entries), or `.mcp.json`, or `claude mcp list` |
| Cursor cloud agents (`environment: "cloud"`, `cloud_base_branch`) | Local background subagents (`run_in_background: true`), isolated by git worktree |
| Cursor's `/goal` (standing objective across turns) | The program objective written into the run's standing orders and restated in the todolist |
| The Cursor agent store (path in the system prompt) | `~/.claude/orchestrate/<project-slug>/`, which survives the session restarts a multi-day program expects |
| Model rule `~/.cursor/rules/pstack-models.mdc` | Override sheet `~/.claude/pstack-models.md`, included from `CLAUDE.md` |
| Multi-model panels (arena, architect, interrogate, how-critics) | Provider dispatch restores the upstream frontier quad: `claude:fable@max`, `codex:gpt-5.6-sol@max`, `grok:grok-4.6@xhigh`, `claude:opus@xhigh`. Same-provider lanes stay native; external lanes use the bundled runner. |

### Cross-vendor dispatch

The earlier port collapsed panels to Claude-only models. The bundled runner restores upstream's cross-provider judgment signal without adding a daemon or model-router service. Claude Code shells out to Codex and Grok; Codex shells out to Claude and Grok. The top-level parent chooses every route and each external process receives a complete task directly, so there is no supervising model invocation and no child-side harness detection.

### What's deliberately kept

- The `poteto-agent` subagent ID and all references to it.
- `run_in_background: true` on Agent calls (Claude Code supports it).
- `/loop`, `/deslop`, `/babysit` slash references in skill bodies — they all resolve in Claude Code now.
- The principle/playbook structure and every word of the principles themselves.

### What's deliberately not ported

- **`automations/benny/`** (upstream `0452e08`, the only pstack change between `e46364b` and v0.10.0) — a dormant Slack issue-triage and reproduce-and-fix automation pack built on Cursor's event-triggered automations. It registers no slash skills even upstream, so excluding it changes nothing about the ported plugin's behavior. Porting it would require Cursor's event-trigger runtime, Slack, and tracker plumbing that Open Pstack does not provide.
- **`docs/guide/`** (upstream `02c03a9`, `0b7ef5b`, `424829e`) — the ten-chapter usage tutorial and its six screenshots (2.3 MB). It teaches pstack through Cursor's UI, sticky mode, and cloud agents, so a faithful port would be a rewrite rather than a sync, and none of it ships as skill content. Read it upstream at [cursor/plugins/pstack/docs/guide](https://github.com/cursor/plugins/tree/main/pstack/docs/guide); the concepts map through the substitution table above.
- **`make-bot-ui`** (upstream `799151d`, relocated by `6fecddb`) uses Cursor routines, webhook events, hosted bot state, and Cursor UI primitives that have no shared Claude Code and Codex mapping. A provider-specific rewrite would be a separate feature, not an upstream sync.
- **Fable solo code defaults** (upstream `23a56e2`) move `bug-fix`, `perf-issue`, and `hillclimb` from GPT-5.6 Sol to Fable. Open Pstack keeps these frequent delegated code roles on `codex:gpt-5.6-sol@max` because Fable costs much more per task.
- **Sticky mode** (upstream `#144`) — Cursor-only `mode`/`icon`/`color`/`reminder` frontmatter with no Claude Code equivalent. The port's 0.9.5 SessionStart hook is the analog and already carries the non-trivial / trivial / opt-out logic.
- **`is_background: true` on `poteto-agent`** (upstream `99559f2`) — Cursor names this key differently. Claude-native frontier definitions use `background: true`; ad-hoc `poteto-agent` calls remain background dispatches at the call site.
- **`cursor-team-kit` beyond the seven imported skills** — the rest either duplicate Claude Code built-ins (`verify-this` → the `verify` skill and built-in verification discipline; `check-compiler-errors` → LSP diagnostics; `control-cli`/`control-ui` → `run`/`verify`, already the substitution targets) or overlap skills this port ships (`loop-on-ci`, `review-and-ship`, `weekly-review` vs `babysit`, `fix-ci`, `make-pr-easy-to-review`, `what-did-i-get-done`). `pr-review-canvas` is Cursor-UI-specific.

### Forking note

Editing skill bodies forks this from upstream. Re-syncing to a future pstack release means re-applying the substitution table. The full re-port recipe is in [CHANGES.md](../CHANGES.md).

## License

MIT. Three upstream LICENSE files are preserved:

- [LICENSE](../LICENSE) — pstack (Lauren Tan)
- [LICENSE-cursor-team-kit](../LICENSE-cursor-team-kit) — Cursor (covers the `deslop` and `thermo-nuclear-code-quality-review` skills)
- [LICENSE-superpowers](../LICENSE-superpowers) — superpowers, Jesse Vincent (covers the vendored `hooks/run-hook.cmd`)
