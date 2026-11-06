# Codex tool mapping for pstack

pstack skills retain Claude Code tool language (`Skill`, `Agent`, `AskUserQuestion`) in shared prose. On Codex the files are the same; only those tool names resolve differently. Model execution is not translated here. Read [`provider-dispatch.md`](provider-dispatch.md) for the parent-owned Claude/Codex/Grok route table and provider-qualified descriptors. In a T3 Code session under either app, its [T3 host](provider-dispatch.md#t3-host) section routes each lane. This file's subagent, background, and wait mappings apply only to a lane it gives the standalone route.

## Harness config homes

Resolve the current parent's config home once: Claude Code uses nonempty `CLAUDE_CONFIG_DIR`, otherwise `$HOME/.claude`; Codex uses nonempty `CODEX_HOME`, otherwise `$HOME/.codex`. The equivalent quoted shell expressions are:

```bash
"${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
"${CODEX_HOME:-$HOME/.codex}"
```

Empty and unset variables both select the default. Preserve spaces in the resolved path by quoting shell file operands. In shared instructions, `<config-home>` means this resolved parent-specific directory, not literal text to write. Use that same home for setup's sheet and integration writes, snapshots, restoration, and readback.

The Claude integration is the one `@` import line in `<config-home>/CLAUDE.md` whose target's basename is `pstack-models.md`, regardless of its existing directory or path spelling. Select current state using [setup-pstack step 2](../../setup-pstack/SKILL.md#2-load-current-state). When `<config-home>` is the default home, render exactly the legacy line:

```text
@~/.claude/pstack-models.md
```

Only when `CLAUDE_CONFIG_DIR` redirects the home, render exactly `@./pstack-models.md`. This relative import resolves from the importing file's directory, where the sheet also lives, so the import line contains no config-directory characters. On a rerun, replace that one line in place, preserving all unrelated bytes. If zero matching import lines exist, append one. If more than one exists, stop and report inconsistent state before either write; do not append another import or guess which one to replace.

## Active transcripts

Reflect passes reviewers this conversation's transcript only after the parent verifies it. Metadata records can come before the first user message in either harness, so never assume the first JSONL record is the opening message.

**Claude Code.** Look only in the per-project directory that the system prompt names under `<config-home>/projects/<encoded-cwd>/`. Do not glob across `<config-home>/projects/`, because that reads private chats from unrelated workspaces. Three layouts exist in that directory: flat (`<id>.jsonl`), nested (`<id>/<id>.jsonl`), and subagent (`<parent>/subagents/<child>.jsonl`). Inspect at most ten candidates, newest first. Read each with a line limit of at most 500. Stop scanning a candidate at 500 records, 2 MiB in total, or a 256 KiB record. Take the candidate whose first actual user message is this conversation's opening prompt.

**Codex.** Run the read-only resolver with the parent's known chat ID. Substitute the absolute plugin root and the chat UUID:

```bash
"<plugin-root>/skills/poteto-mode/scripts/resolve-codex-transcript" "<chat-id>"
```

The resolver reads the [Codex config home](#harness-config-homes) and looks up that exact ID in the `threads` table of its `state_*.sqlite` index. It checks that the rollout is inside `<config-home>/sessions/` and belongs to that chat. It then scans at most 500 records, 2 MiB in total, or a 256 KiB record for the first user message, skipping injected AGENTS.md and environment context. On success it exits 0 and prints the chat ID, the rollout path, and the opening message's line, record type, character count, and SHA-256. It never prints message text. If it cannot verify the transcript, it exits 1 and prints an `unresolved` reason. Before passing the path, compare the character count and SHA-256 with this conversation's opening prompt. Do not search by chat title or by time.

**Fallback.** If the chat ID, index, ownership, path, or opening prompt cannot be verified within these limits, pass a tight session digest instead. Keep it to at most 2,000 words and include only relevant decisions, corrections, evidence paths, and unresolved work. Do not widen transcript discovery to replace missing evidence.

## Reflect skill copies

Reflect never edits a skill inside the plugin cache, `<config-home>/plugins/cache/` in both harnesses. It copies the skill folder to one of these folders and edits the copy:

| Harness | Project | User |
| --- | --- | --- |
| Claude Code | `.claude/skills/<skill>/` | `<config-home>/skills/<skill>/` |
| Codex | `.agents/skills/<skill>/` | `$HOME/.agents/skills/<skill>/` |

The copy registers under its plain name beside the plugin's `pstack:<skill>`, and does not replace it. In the copy, rewrite each relative link that leaves the skill folder, such as `../poteto-mode/`, to the absolute path of that folder in the installed plugin.

## Tool actions

| pstack / Claude action | Codex equivalent |
|------------------------|------------------|
| Read a file | `shell` (`cat`, `head`, `tail`) |
| Create / edit / delete a file | `apply_patch` |
| Run a shell command | `shell` |
| Search file contents / find files | `shell` (`rg`, `grep`, `find`, `ls`) |
| Fetch a URL | `shell` with `curl` / `wget` |
| Search the web | `web_search` |
| Invoke a skill (the `Skill` tool, `/command`) | Skills load natively. Follow the instructions presented. |
| `paths` frontmatter scopes automatic loading | Claude Code only. On Codex, invoke `pstack:typescript-best-practices` by name. |
| Dispatch a subagent (the `Agent`/`Task` tool) | `spawn_agent` |
| Dispatch N parallel subagents in one turn | N `spawn_agent` calls in one response |
| Wait for a subagent result | `wait_agent` |
| Free a finished subagent slot | `close_agent` |
| Track tasks (the todolist / `TodoWrite`) | `update_plan` |
| Ask the human a fixed-choice question (`AskUserQuestion`) | Ask in plain text and let the user answer. Codex has no structured-choice tool. |

Subagent dispatch needs `multi_agent` enabled. Add to `<config-home>/config.toml`, using Codex's [config-home rule](#harness-config-homes):

```toml
[features]
multi_agent = true
```

Without it, the native Codex lane is a named dropout. Independent external lanes still run, and the parent records the reduced provider count. Never collapse a panel into a sequential single-model pass.

## Subagent policy

poteto-mode's Subagents section sets the Claude-specific default `subagent_type: "poteto-agent"`. Claude Code waits follow [Waits on Claude Code](#waits-on-claude-code). On Codex:

- There is no `poteto-agent` subagent type. Route an ad-hoc subagent through poteto-mode's style by dispatching a `spawn_agent` whose instructions tell it to read the `poteto-mode` skill in full first.
- `spawn_agent` calls already run concurrently with your turn, so `run_in_background: true` has no separate flag. Issue the dispatch and continue.
- There is no `comment-sicko` subagent type either. The **no-comments** skill spawns it on Claude Code; on Codex dispatch a `spawn_agent` whose instructions tell it to read `agents/comment-sicko.md` in full first.
- A Claude Code native lane cannot start agents: each `agents/pstack-*.md` lane disallows `Agent` and `Task`.
- Claude Code runs every subagent on this machine, so the **swarm** skill's workers and the fan-out playbooks (`orchestrate`, `autopilot-full`, `autopilot-stack`) isolate writers with worktrees. The same holds on Codex.
- Keep the rest of the policy unchanged. Pass file pointers not inlined context, give each worker its own worktree or branch when they write, review every subagent's diff yourself.

## Waits on Claude Code

- The main session launches long commands, such as the `watch-pr` watcher and the external launcher, and lane fan-outs with `run_in_background: true`. It keeps their handles and acts on completion notices. Babysit's main-session `/loop` still handles watcher progress verdicts that do not exit, such as `WAITING/merge-queue`.
- A subagent that needs a native lane's report before its next step dispatches the lane with `run_in_background: false` and reads the report from the `Agent` result. It puts independent dispatches in one message.
- A subagent cannot run `/loop`. On GitHub, it runs `watch-pr` in the foreground with Bash `timeout: 600000` and `--timeout 240`, and acts on the verdict. It runs the watcher again after a `TIMEOUT` exit (5), and after every push or verdict it acts on, as babysit step 6 says. On another forge, it follows that forge's commands in babysit step 6 instead. If Bash moved the watcher to the background, the subagent supervises that task and starts no second watcher.
- To wait on a background task it already started, such as an external lane, a subagent makes one foreground Bash call with `timeout: 600000` that returns within 540 seconds and checks for the task's final outcome. For a runner lane, the final outcome is a receipt that parses as JSON with a `status` field. The runner reserves the output and receipt files empty before the lane finishes, so an existing receipt file is not an outcome. If the task is still running, the subagent repeats the wait on the same task.
- A subagent with an outstanding result does not end its turn to wait for a notice, and does not poll an output file in short calls.
- These windows bound one observation call. They are never a lane or runner deadline, and never go to `pstack-runner --timeout`.
- Codex is unaffected: `spawn_agent` runs concurrently, `wait_agent` blocks, and exec sessions return a handle.

## Models and providers

Do not replace every configured entry with a Codex model. `/setup-pstack` writes portable descriptors, such as the [role defaults](model-catalog.md#role-defaults). In a Codex parent, only `codex:*` is native. Route Claude and Grok descriptors through the external launcher exactly as `provider-dispatch.md` specifies. The default panel runs one model from each of three providers and contains no older GPT or Claude substitute.

## Claude built-in skills pstack references

Some triggers name skills that ship with Claude Code, not pstack. They do not exist on Codex. Substitute the behavior:

| Claude built-in named in pstack | On Codex |
|---------------------------------|----------|
| `run` (drive a CLI/TUI to see a change work) | Run the app yourself via `shell` and observe the real output. |
| `verify` (drive a UI to confirm a fix) | Drive the UI with whatever automation you have, or hand the user a concrete manual check. Do not claim done without observing the artifact. |
| `plugin-dev:skill-development` (Claude's SKILL.md authoring guidance) | Follow your platform's skill-authoring guidance; the `writing-skills` skill if present. Keep `name` + `description` frontmatter and progressive disclosure. |
| `loop` (recurring/self-paced re-invocation, used by `babysit`) | Codex has no `loop` skill. Re-run the step yourself on a cadence, or use a Codex scheduled task if available. |

## Vendored scripts

`skills/poteto-mode/scripts/` ships the `watch-pr` PR watcher, `worktree-audit.sh`, and `runner/pstack-runner`. They are plain bun and bash, so they run the same on Codex; invoke them through `shell`. The external runner additionally needs the assigned `claude`, `codex`, or `grok` executable already authenticated. It rejects a Codex provider when Codex is the parent because that lane belongs on native `spawn_agent`. The other scripts need `bun`, `gh` (or Origin's `origin` CLI where the playbook resolves it), and (for `worktree-audit.sh`) `jq` and `rg`. `worktree-audit.sh` reads Claude Code transcripts under `~/.claude/projects/`; point it at your runtime's transcript directory instead when you run it elsewhere.

## Instructions file

Where a pstack skill says "your instructions file", on Codex that is `AGENTS.md` (project root, plus `<config-home>/AGENTS.md` global). On Claude Code it is `CLAUDE.md` (project root, plus `<config-home>/CLAUDE.md` global). Resolve the global directory with the [config-home rule](#harness-config-homes).
