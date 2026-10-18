# CHANGES — applied substitutions

Mergify auto-queue is live: ready PRs to main require passing verify, Unfret and exact-head live-gate, and no unresolved review thread; workflow changes require operator queueing.
This port applies the Cursor → Claude Code substitutions in skill bodies. Earlier drafts left them flagged; this revision resolves them. A later pass added a Codex build that shares the same skills; see [Codex port](#codex-port) below.

## Unreleased

Local adaptation (#228): bug-fix step 5 and the sequencing principle use repro/baseline-then-fix proof without a new unit test or failing-test commit. Refactoring step 1 uses the flow's existing deterministic E2E, adding only that flow's one E2E when uncovered. The type-checked build remains a build step. Session-start no longer suggests direct TDD entry. Other test guidance is unchanged.

## 1.15.0 runs Devin, agy and dsh lanes in any repository

Open Pstack 1.15.0 keeps the Cursor pstack 0.15.25 sync. It ships PR #215, merged after 1.14.0. Default roles and panels are unchanged.

**No repository refusals.** A read-only lane means the read-only settings pstack passes to each CLI; the operator's host, account, repository and organization configuration applies as they set it up, and the runner adds no refusal, guard or account check because of it (#203). The runner no longer refuses a Devin lane in a repository holding `.devin/`, an agy lane in one holding `.agents/`, `.agent/`, `_agents/` or `_agent/`, or a dsh lane whose working directory holds `.env`, and the home-directory rule that came with those checks is gone. Every provider now runs in any directory (#204).

**What still loads.** The catalog notes say what each CLI loads from the working directory and its parents up to the git root, or up to `/` outside a repository: Devin's `.devin/` hooks, permissions and MCP servers; agy's hooks, MCP servers, rules and skills in its four directories, with no trust check; dsh's working-directory `.env`, whose values other than dsh's own bootstrap names reach its bash tool. Outside a repository under the home directory, Devin and agy also load the home directory's own `~/.devin/` and `~/.agents/`. dsh still refuses any version except the measured `0.2.0-rc.2`, because dsh ignores a patch row it does not have.

## 1.14.0 adds a read-only Cursor CLI provider

Open Pstack 1.14.0 keeps the Cursor pstack 0.15.25 sync. It ships PR #211, merged after 1.13.0. Default roles and panels are unchanged. No role uses the new provider by default, and setup refuses it for every role that writes files.

**Read-only Cursor CLI provider.** The runner dispatches `cursor:composer-2.5` at the `default` effort and `cursor:gemini-3.7-flash` at `low`, `medium` or `high` through the signed-in `cursor-agent` CLI from either parent; `high` is Gemini's default, and the effort selects the CLI model ID, such as `gemini-3.7-flash-high`. Gemini 3.7 Flash is the model #37 asked for, which Antigravity did not serve for the measured account. Each lane runs `cursor-agent -p --mode ask --sandbox enabled --trust` with a run-owned `CURSOR_CONFIG_DIR` whose config denies writes, shell commands and every MCP call, and approves no web tool. The login check is `cursor-agent models`, never `cursor-agent status`, and empty output is inconclusive, never unauthenticated (#94). Cursor reports only a display label for the model, so receipts record `pinned-argv` evidence. Sign in with `env -u CURSOR_API_KEY cursor-agent login`: a login made while `CURSOR_API_KEY` was set could not make model calls on the measured Mac (#71).

**Read-only means pstack's own settings.** The runner refuses no repository and adds no pre-launch check because of the operator's own Cursor configuration (#203). Every turn starts Cursor's language-server worker, which runs `npx -y typescript-language-server --stdio` in the workspace and uses a repository's own copy when it has one; the worker stays running for a few idle minutes after the turn. Enterprise, team, user and repository hooks run unsandboxed in every lane, and a repository's `.cursor/cli.json` replaces the run-owned deny list. A lane can start a Task subagent, which ran on the lane's own model under the same limits; Cursor's CLI has no setting that removes Task (#212). The catalog's Cursor notes say what each was measured to do.

## 1.13.0 adds a read-only Amp provider

Open Pstack 1.13.0 keeps the Cursor pstack 0.15.25 sync. It ships PR #208, merged after 1.12.0. Default roles and panels are unchanged. No role uses the new provider by default, and setup refuses it for every role that writes files.

**Read-only Amp provider.** The runner dispatches `amp:deepseek-v4.1-flash`, Amp's official DeepSeek V4.1 Flash mode, at the `default` effort through the signed-in Amp CLI from either parent. Each lane passes Amp a run-owned settings file that enables only the `Read` tool and rejects every other tool, and turns off MCP servers, Claude Code and `~/.agents` skills, updates and notifications. The lane ignores `AGENTS.md` guidance files, runs as a private ampcode.com thread labelled `pstack-runner`, and spends Amp credits. `amp usage` is the login check. Failures and cancellations can exit 0, so the stream's `result` event decides the outcome. Amp's stream never names the served model, so receipts record `pinned-argv` evidence (#158).

**Read-only means pstack's own settings.** The runner refuses no repository and adds no pre-launch check because of the operator's own Amp configuration (#203). Amp's own `official-modes` plugin, system plugins, personal and workspace plugins, machine and workspace managed settings, and a repository's `.amp/` settings and plugins still load in every lane, and they can enable tools, change modes or run code. The catalog's Amp notes say what each was measured to do.

## 1.12.0 adds a read-only OpenCode provider

Open Pstack 1.12.0 keeps the Cursor pstack 0.15.25 sync. It ships PR #202, merged after 1.11.0. Default roles and panels are unchanged. No role uses the new provider by default, and setup refuses it for every role that writes files.

**Read-only OpenCode provider.** The runner dispatches `opencode:opencode/deepseek-v4.1-flash-free`, OpenCode Zen's free DeepSeek V4.1 Flash, which needs no key, at `low`, `high` or `max` through the OpenCode CLI from either parent. `max` is the default. Other OpenCode models run unchanged as unregistered pairs and authenticate through OpenCode's stored logins. Each lane runs OpenCode's `build` agent with a run-owned config whose permissions allow only `read`, `glob`, `grep`, `list` and `todowrite`, with `--pure`, a fixed session title, and OpenCode's switches that turn off project config, Claude Code files and external skills. A turn that ends on a rejected tool call is `child-failed`. Neither the event stream nor any other OpenCode output names the served model, so receipts record `pinned-argv` evidence (#68).

**Read-only means pstack's own settings.** The runner refuses no repository and adds no pre-launch check because of the operator's own OpenCode configuration (#203). A managed config, the macOS managed-preferences profile, remote config from a stored well-known login or console organization, and a repository's `.opencode/plugins/` still load in every lane, and they can add MCP servers, language servers, plugins, provider routing or agent changes. The catalog's OpenCode notes say what each was measured to do with OpenCode 1.19.1.

## 1.11.0 adds read-only DeepSeek Harness and Antigravity providers

Open Pstack 1.11.0 keeps the Cursor pstack 0.15.25 sync. It ships PR #196, merged after 1.10.0. Default roles and panels are unchanged. No role uses the new providers by default, and setup refuses both for every role that writes files.

**Read-only DeepSeek Harness provider.** The runner dispatches `dsh:deepseek-flash` and `dsh:deepseek-v4-pro`, each at `low`, `high` or `max`, through the signed-in DeepSeek Harness CLI from either parent. `max` is the default. Each lane runs dsh with its own `DSH_HOME`, the lane's private 0700 provider directory, so the operator's dsh profile does not load. A run-owned `--patch` file pins the model, the effort, a read-only sandbox rooted at the lane's working directory and approval `ask`. It reads the stored login in place and turns off host and project rule files, skills, the web, subagent and workflow tools, the plugin inventory, the session-title call and the session-log upload. In read-only mode dsh's bash tool keeps network access, and its `read` tool is not confined to the working directory; the catalog says so. The runner checks `dsh --version` before launch and refuses any version except the measured `0.2.0-rc.2` as `unavailable-cli`, because dsh ignores a patch row it does not have. It refuses a lane whose working directory holds a `.env` file, because dsh loads that file into its bash tool at boot. The preflight proves only that a key is stored or exported, not that the key works. A key kept only in the operator's dsh `.env` does not authenticate a lane: store it with dsh or export `DEEPSEEK_API_KEY` (#159).

**Read-only Antigravity provider.** The runner dispatches `agy:gemini-3.8-flash` at `low`, `medium` or `high` through the signed-in Antigravity CLI from either parent. `high` is the default, and the effort selects the model ID, such as `gemini-3.8-flash-high`. The prompt goes to agy as one JSON line on stdin. Each lane runs a run-owned agent that allows only `view_file`, so the lane has no web search, URL reads, subagents, scheduling, messaging or browser. A turn that ends on a denied tool is `child-failed`, even after a reply preamble. The runner refuses a lane whose working directory, or any parent up to the git root, holds `.agents/`, `.agent/`, `_agents/` or `_agent/`, because agy runs the hooks and MCP servers there with no trust check. The operator's own `~/.gemini/GEMINI.md`, host skills and agy plugin hooks still load in every lane, and no flag turns them off. Plugin hooks the operator installs are trusted operator configuration (#197). Issue #37 asked for Gemini 3.7 Flash, which Antigravity did not list for the measured account. The runner registers Gemini 3.8 Flash and never maps a 3.7 request to it (#37).

**Model proof.** Neither CLI reports the model it served, so both receipts record `pinned-argv` evidence. `provider-dispatch.md` now accepts pinned-argv evidence for any provider whose catalog Model proof cell says so, not only for Codex.

**Home-directory rule.** The runner refuses a DeepSeek Harness, Antigravity or Devin lane whose project-config walk would reach the home directory. That covers a working directory under the home outside any git repository, a repository rooted at the home, and the home itself. Inside a repository below the home, the walk stops at the repository root. Claude, Codex and Grok lanes are unchanged.

## 1.10.0 syncs to Cursor pstack 0.15.25

Open Pstack 1.10.0 tracks Cursor pstack 0.15.25 at `99743e9c151c8537cbbf1f98bb38f34ef3368453`. Seventeen upstream commits since 0.15.20 touch pstack. Thirteen change content, and all thirteen are applied with the port adaptations below. The other four bump only the Cursor manifests, which stay out.

**New skills.** `/in-your-own-words` restates the user's goal and the problem before work starts. `/sharpen` approaches a task the way a top expert would, aimed at what the user is really after, without overspecifying it. Both run only when typed. soulmachine ported them in PR #188, and this release carries that work (#187).

**Effort per spawn.** Before each subagent starts, poteto-mode and the skills it routes to start from the role's configured effort and move it for the job: one step up, never past `max`, for the hardest work, one step down for judgment, and two or more steps down for routine work. Verification lanes keep the `swarm workers` descriptor. The provider and model stay as configured, so a panel keeps its three providers. An effort the model's catalog row does not list moves to the nearest one it lists, and a configured `ultra` stays `ultra`. If a route rejects the adjusted effort, the lane runs on the configured descriptor and says so. Any other failure is a dropout, as before.

**Changed behavior.** Autopilot-full, Autopilot-stack and the multi-phase plan run one full swarm at the code-ready head, and a rebase, a conflict fix or a minor fix gets one verifier at the new head. A defect that trunk shows without the PR does not gate the PR. Loosening a gate needs a verifier's proof and the root's countersign, and a disabled or soft-failed check always comes out. Autopilot owners run off trunk and never hold a private stack, and they stop and report a push they did not make. Autopilot-stack owners branch from the branch of the item they depend on. An audit tick or a reply that changed something catches the operator up through `/ketchup`. Orchestrate's `orch frontier set` reads the pull request base chain through `gh`, or through Origin with `--forge origin`, instead of Graphite. `watch-pr` treats a Code Review Gate that waits on an owner approval as the gate, not a failed check. `worktree-audit.sh` reads Origin pull requests when Origin can read the repository, and a draft pull request holds its worktree. `/ketchup` keeps its reply under 150 words in `/bro`'s voice, shows screenshots, videos and diagrams where a picture explains better, and lists action items as plain bullets. `principle-fix-root-causes` proposes a cheap always-on signal after a deep debugging dig. poteto-mode tells delegates where bundled skills live and passes its own path to each `poteto-agent`.

**Restated principles.** `principle-test-behavior-not-implementation`, `principle-fix-root-causes`, `principle-attack-the-premise` and `principle-make-operations-idempotent` now state the reasoning instead of naming matchers, guards, a census or locks. `correct` step 3 asks whether a test fails when the behavior breaks and passes when only the internals change. These rewrites keep absence assertions that a contract promises, relational invariants and compile-time checks, so the port's 0.15.0 local corrections and the `00b14f1` and `9511e60` exclusions retire.

**Shorter prompts.** Upstream cuts sections from Interrogate's lead-judgment reference, Swarm, and the type-system and migrate-callers principles.

**Port adaptations.** The effort rule drops upstream's fast and standard speed sentences, because the port's descriptors carry no speed selector, and reads its starting effort from the model sheet or role default instead of the excluded setup budget. Arena, Interrogate and the other routed skills keep their dispatch contracts and dropout rule, without upstream's `cursor-grok-*` and `composer-*` fallback. Shipping keeps its nine landing steps and takes upstream's new rules and reasons. Autopilot-full takes upstream's seven steps, with the guarded rebase and push in step 2. Autopilot-stack takes upstream's four steps, with the fork and topology rules in step 2. The landing invariants follow the moved text. `poteto-agent` keeps the `pstack:poteto-mode` preload and takes the parent's path instead of searching `~/.cursor/plugins/`. `/ketchup` draws charts with the harness's own renderer instead of Cursor's `/visualize`. `docs/reference.md` and `codex-tools.md` no longer list Graphite as a requirement.

**Not applied.** See `UPSTREAM.md`: Autopilot-full step 5's trunk-move rule as `ce649c0` revised it, the stuck-after runtime and first-tick stuck test, the `composer-*` fallback, the Cursor plugin search in `poteto-agent`, and the Cursor manifests and `docs/guide/`. `README-UPSTREAM.md` is the verbatim upstream README.
## 1.9.0 adds Luna, Sonnet, an exact Opus 5.5 pin, a read-only Devin provider and full-access Codex writers

Open Pstack 1.9.0 keeps the Cursor pstack 0.15.20 sync. It ships registry units U4 to U7, merged after 1.8.0. Default roles and panels are unchanged.

**New model families.** `codex:gpt-6-luna`, `claude:sonnet` and `claude:claude-opus-5-5` are registry entries. Luna takes `low` to `max` and defaults to `max`. Sonnet is Claude's rolling Sonnet alias. `claude-opus-5-5` is an exact pin that keeps Opus 5.5 when the `opus` alias moves. The model catalog lists all three, and Claude Code gets native `pstack-sonnet-<effort>` and `pstack-opus-5-5-<effort>` agents. Luna and Sonnet reject `ultra`, which stays on Sol only. Setup probes a new family only when one of your roles uses it. `gpt-5.6-luna` and `gpt-5.6-terra` get no entries, because Codex describes both as older and no released sheet used them (#54).

**Model matching order.** Setup and dispatch now match a descriptor against an exact catalog row first, then a kept predecessor, then a rolling alias's revision. Before this release they normalized every versioned Fable and Opus descriptor to its alias first, which would have turned the pin into `opus`. An older versioned Opus, such as `claude:claude-opus-5`, still normalizes to `opus`, and a versioned Sonnet, such as `claude:claude-sonnet-5-5`, normalizes to `sonnet`. A setup rerun writes those migrations to the sheet and keeps Luna and the pin. The runner rejects an external Claude lane whose provider report names another model: the pin accepts only `claude-opus-5-5`, and Sonnet only a Sonnet revision (#54).

**Read-only Devin provider.** The runner dispatches `devin:swe-2@<medium|high|max>` and `devin:swe-1.6@default` through the signed-in Devin CLI from either parent. The effort selects the Devin model ID, such as `swe-2-medium`. The reply and the model proof come from Devin's `--export` file, not stdout. Devin lanes are read-only: a lane runs `--permission-mode auto` without `--sandbox`, because Devin's `--sandbox` lets shell commands write in the working directory. The runner refuses an `isolated-write` Devin lane before launch. Setup refuses Devin for every role that writes files: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `hardest tasks`, `arena runners`, `architect runners` and `swarm workers`. Each lane gets a run-owned `--config` file in a private 0700 directory. That file turns off subagents, host rule files such as `CLAUDE.md` and MCP tools, and denies web search and the fetch tools. The runner refuses a Devin lane whose working directory, or any parent up to the git root, holds `.devin/`, because Devin would load that repository's hooks, permissions and MCP servers. Devin gets the shared environment allowlist, without `DEVIN_PERMISSION_MODE`, `DEVIN_SANDBOX`, `DEVIN_MODEL` or `DEVIN_REFUSAL_FALLBACK`. No role uses Devin by default. Network isolation for a Devin lane is not established, and the catalog says so (#69).

**Full access for Codex writer lanes.** The model sheet line `codex writer sandbox: full-access` runs Codex `isolated-write` lanes that the external runner launches with `--sandbox danger-full-access`. Such a writer can launch a browser and write dot-folders such as `.agents/`. Full access removes every Codex sandbox limit, including confinement to the worktree. Without the line, or with `codex writer sandbox: bounded`, writers keep `workspace-write`. Setup asks once, says what full access removes, writes `bounded` on a decline and keeps the line on reruns. The receipt records `writerSandbox` as `bounded` or `full-access`, and as null for a read-only lane. The runner refuses `--writer-sandbox full-access` on a read-only lane and on Claude, Grok and Devin. Native writers are unchanged: a Claude `Agent` writer stays native, and a Codex parent's `spawn_agent` writer keeps the parent's sandbox. Nothing turns full access on after a sandbox failure (#80).

**Repository checks.** A root `package.json` runs CI's checks as `bun run test`, `bun run typecheck` and `bun run static`, so CI and reviewers run one definition. The plugin is unchanged (#185).

## 1.8.0 adds a generated model catalog and fixes the Windows SessionStart hook

Open Pstack 1.8.0 keeps the Cursor pstack 0.15.20 sync. It ships registry units U2 and U3 and the Windows hook fix, merged after 1.7.0, and adds the note for registry unit U1, which shipped in 1.7.0.

**Model catalog.** Model facts live in the runner registry, `skills/poteto-mode/scripts/runner/registry/`. Its `render.ts` generates `references/model-catalog.md` and the Claude-native `pstack-<family>-<effort>` agents. The catalog holds the model matrix, kept predecessors and rolling aliases, each provider's route from each parent, provider notes and the role defaults. `provider-dispatch.md` keeps the hand-written dispatch rules and links to the catalog. A hand edit of a generated file fails the tests and prints the write command (#156).

**Role pointers.** Arena, Architect, How, Interrogate, Swarm, poteto-mode and the bug-fix, feature, hillclimb, perf-issue and refactoring playbooks point at the catalog's role defaults instead of naming models, so a default-model change edits no Cursor-derived file. Interrogate's reviewer table is gone. A sheet that lacks a role uses that role's default from the catalog (#157).

**Setup reads the catalog.** `setup-pstack` seeds a first run from the catalog's role defaults. On a rerun it treats every kept predecessor the way it treated the earlier Sol default: it proposes the family's current model at the same effort, and keeps the old one if you decline. `grok:grok-4.6` is now a kept predecessor of Grok 4.7. Setup probes a native route with a one-turn native probe and an external route with one `pstack-runner` call (#156, #157).

**Provider adapter contract.** Claude, Codex and Grok each run behind one adapter module in the registry, and the runner's per-provider switches are gone. Argv, receipts and behavior for a valid model sheet are unchanged. This shipped in 1.7.0 without a note (#155).

**Windows SessionStart hook in Codex.** Codex on Windows runs a plugin hook through the session's shell, usually PowerShell. The hook's `commandWindows` now starts `C:\Windows\System32\cmd.exe` by full path with delayed expansion, so the same command works in PowerShell and cmd, and a plugin path with a space, `&`, `%` or `!` stays intact. Before this release, Windows Codex sessions got no pstack context. `hooks/run-hook.cmd` is superpowers 7.0.0's wrapper, which finds Git for Windows' Bash in its system-wide and per-user locations and on `PATH`. `docs/reference.md` lists Bash and a Windows installed in `C:\Windows` as requirements. Coldsun1 reported the failure and confirmed the fix in the Codex desktop app and CLI (#127).

**README.** The README now opens with what Open Pstack adds beyond Lauren's pstack, each item linked to its source (#167).

## 1.7.0 syncs to Cursor pstack 0.15.20

Open Pstack 1.7.0 tracks Cursor pstack 0.15.20 at `1b6d44ff26d4e242f4e8f68c391e6d2f7ca16def`. Eleven upstream commits since 0.15.17 touch pstack. Nine are applied, four of them with port adaptations. Two are excluded: the root Agent Plugins v1 manifest and the version bump that touches only manifests.

**Changed behavior.** `ketchup` shows each action item as a before and after, side by side, and makes a visual from what it already has or says plainly that none exists. The chat that receives `/poteto-mode` runs the playbook and never spawns a `poteto-agent` to run it, and `poteto-agent` is described as a delegate for code-writing and helper tasks during a run. `create-verification-skill` defines ready as usable from an empty data dir, makes a journey that the seed data cannot satisfy report a failure, and keeps setup that a stand-in did unverified until a run on the real target covers it. The plan checker treats fences by CommonMark rules: indented openers up to three spaces, backtick and tilde fences, closers of the same character and at least the opening length, and no backtick in a backtick info string. `watch-pr` reads every page of review threads, so an unresolved thread past the first 100 blocks readiness, and it counts Bugbot passes across all pages. `worktree-audit.sh` takes `-b <ref>` for the `MERGED` column, falls back to `origin/HEAD`, then `origin/main`, then `origin/master`, and prints the base it used. The `unslop` description drops "Must always apply."

**Shorter prompts.** Upstream's cuts remove restated rules, generic search steps and return-format blocks from the `how` explorer prompt, the `why` source references, the Babysit playbook's Reply block, the Worktree cleanup introduction, and the `principle-encode-lessons-in-structure`, `principle-laziness-protocol`, `principle-exhaust-the-design-space` and `principle-guard-the-context-window` leaves.

**Port adaptations.** `poteto-agent` keeps `general-purpose`, the `Agent` tool name and the `pstack:poteto-mode` preload. Poteto-mode's Subagents line keeps the provider-dispatch routing and adds upstream's runner rule. Babysit keeps the port's merge-safety paragraph with explicit repository arguments. Worktree cleanup runs the audit from the installed plugin with the new `-b` argument and keeps the session-list wording, and `worktree-audit.sh` keeps the Claude transcript directory. `create-verification-skill` keeps `.claude/skills/` paths. The plan checker's fence handling lives in the port's typed `toLines`, and the port's suite adds upstream's fence cases against the extracted plan skeleton. `no-comments` already spawned `comment-sicko` through `Agent`, so the agent rename needs no port change. `package.json` keeps the port's test and typecheck lists, which already run the checker tests and its strict typecheck.

**Not applied.** See the 0.15.20 rows in `UPSTREAM.md`: the `is_background` field on `poteto-agent`, the root Agent Plugins v1 `plugin.json` (revisited with #13), and the `disable-model-invocation` line that `unslop` and the principle leaves still carry upstream. The Cursor manifest stays out. `README-UPSTREAM.md` is the verbatim upstream README.

## 1.6.2 ships the runner and Reflect fixes merged after 1.6.1

Open Pstack 1.6.2 keeps the Cursor pstack 0.15.17 sync. It ships the runner and Reflect fixes that merged after 1.6.1 was tagged.

**Claude write lanes run in the Bash sandbox.** A Claude `isolated-write` lane now runs with `acceptEdits` and the Claude Code Bash sandbox enabled, with unsandboxed commands disallowed. Its shell commands run without prompts, and its writes stay inside the cwd and the per-user temp directory. The lane refuses to start when the sandbox is unavailable. In a linked worktree, the runner asks `git rev-parse --git-common-dir` for the shared `.git` and adds its literal path to the sandbox's write denials. If git fails, the cwd lies inside the shared directory, or the path contains a glob or control character, the runner refuses the lane with a `child-failed` receipt before any provider process starts. Claude writer children no longer inherit `GIT_*` variables. The denial also blocks `git add` and `git commit` in a linked worktree. Read-only Claude lanes, Grok and Codex lanes, and Claude Code parents are unchanged (#118).

**Grok environment allowlist.** A Grok lane inherits only an allowlisted environment, in both modes and for both the preflight and the model call. The allowlist holds `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `TERM`, `COLORTERM`, `TZ`, the proxy variables in both cases, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `LC_*`, `XDG_*`, `GROK_*` and `XAI_*`. Before this change, a Grok lane with a shell inherited the parent's full environment, secrets included. A Grok setup that needs another variable now fails with a receipt-bearing dropout (#141).

**Authentication from the preflight only.** The runner classifies a lane as `unauthenticated` only from the preflight probe. A nonzero exit after the model call, without a provider-reported reason, is `child-failed`/70, or `unavailable-model`/69 when the model-error text matches, even when the child's output mentions authentication. A provider-reported cancellation stays `cancelled` (#142).

**Grok login and model listing.** Grok preflight accepts a deployment-key login. It accepts a model only when the model appears on a line under `Available models:` in `grok models` output (#131).

**Invalid Grok terminal data.** `provider-dispatch.md` now states that invalid or incomplete Grok terminal data is `malformed-output`/65 only after a zero exit. After a nonzero exit, it takes the ordinary failure classification (#132).

**Git 2.25 or later.** `docs/reference.md` now names git 2.25 or later as a requirement. The runner reads `git rev-parse --git-common-dir`, and `worktree-audit.sh` reads `git worktree list --porcelain` (#153).

**Reflect finds Codex transcripts.** Reflect step 1 resolves and verifies the current conversation's transcript through the active-transcript mapping in `codex-tools.md`, or passes a session digest of at most 2,000 words. On Codex, `resolve-codex-transcript.ts` looks up a known chat in the Codex state index, read-only and within fixed limits, and prints bounded metadata, never message text. On Claude, the lookup stays in the per-project transcript directory. Neither harness searches wider (#140).

## 1.6.1 adds a release script

Open Pstack 1.6.1 keeps the Cursor pstack 0.15.17 sync and changes no skill.

**Release script.** `python3 scripts/release.py notes` prints the release body for the manifest version: its `CHANGES.md` section and a link to that section at the tag. `python3 scripts/release.py publish` tags the PR head whose live gate passed, pushes the tag, and creates the GitHub release with that body. The tag goes on that PR head, not on the merge commit, because merge commits never carry a `live-gate` status. Before it writes anything, it refuses on a dirty checkout, a `HEAD` other than `origin/main`, an `Unreleased` section, a missing or empty version section, or an existing tag. It also refuses unless `HEAD` is a merge commit whose PR head has `live-gate` success and the same tree. It runs on Python 3.9 and later, including macOS's `/usr/bin/python3`. The static invariants run its tests and build the notes for the current version (#147).

## 1.6.0 syncs to Cursor pstack 0.15.17

Open Pstack 1.6.0 tracks Cursor pstack 0.15.17 at `978ca6e9c0e012047cd5058b8e829240336e704e`. Eleven upstream commits since 0.15.5 touch skill content. Ten are applied with the usual substitutions, and one is excluded.

**New skills.** `benchmark-checklist` vets a measured performance number before an agent reports or acts on it, and poteto-mode, Perf issue, and Hillclimb route to it. `principle-explain-the-number` joins the Verification principles. `correct` turns mistakes that agents keep repeating into checks that make them impossible. `ketchup` catches the user up on everything since their last message. `poteto-help` answers questions about pstack and routes them to the right skill, playbook, or principle. `correct`, `ketchup`, and `poteto-help` run only when typed.

**Changed behavior.** Poteto-mode gives new work to a fresh subagent by default and resumes one only when the work needs state that lives in that agent. A full-autonomy default now says in plain words what the operator could ask for instead, never a shorthand token. Autopilot-full, Autopilot-stack, and the Multi-phase plan program arm an hourly audit tick, which is `/loop 1h` on Claude Code. Owners push after every verifiable unit. A fresh owner takes each next queue item. Opening a PR puts each body section under a `##` heading and adds `## What changed`. Perf issue step 2 lists the performance mantras in place of the eight strategy families. Architect judges each candidate by how an agent contributor would change it, and its red flags add split ownership, two ways to do one thing, importable internals, and hand-synced lists. TypeScript best practices uses a schema-first Zod example.

**Shorter prompts.** Upstream's distillation pass shortens most skills. Poteto-mode's principle and playbook index entries now omit the slug and file path and give one kebab-case naming rule instead; every one of the 47 entries resolves to an existing skill or playbook. How, Why, Interrogate, Arena, and Reflect keep the provider-dispatch contract, the configured descriptors, and the no-fallback dropout rule in place of upstream's Task-tool model lines.

**Port adaptations.** The poteto-agent preload stays. The Claude Code tool names, the `run` and `verify` drivers, the bundled `babysit` skill, `plugin-dev:skill-development`, and the Claude transcript paths replace their Cursor counterparts as before. The audit ticks reread the playbook from the installed plugin rather than `git show origin/main:pstack/...`, and stand a lane down only on affirmative failure evidence. The removed `/goal` step also removes the standing-objective substitute the port used for it. The plan checker now requires `hourly` and no longer requires `standing orders` or `30-minute`, and the copied plan skeleton still contains no `/loop`. `poteto-help` uses Claude Code and Codex install steps, the model sheet in the active harness's config home, the requested-effort setup, and absolute links to the upstream guide, and it drops the Cursor Custom Mode, cloud-agent, and `make-bot-ui` advice. `correct` sends its test step to `principle-test-behavior-not-implementation`, so it keeps the useful negative-path tests that the port's test principle keeps.

**Not applied.** See the 0.15.17 rows in `UPSTREAM.md`. In short: the `df58112` Sol removal, the `disable-model-invocation` flag on principle leaves, `figure-it-out`, and `benchmark-checklist`, the Cursor built-in PR tool, the shorter test principle, the 40-line squash-body cutoff, and Autopilot-full's merge without a rebase after trunk moves. `docs/guide/` and the Cursor manifest stay out. `README-UPSTREAM.md` is the verbatim upstream README.

**Other changes since 1.5.0.** These landed on `main` after the 1.5.0 release and first ship in 1.6.0, together with the config-home port correction (#120) below.

**Claude poteto-agent preload.** The Claude Code agent definition preloads `pstack:poteto-mode` through its `skills` frontmatter. Claude subagents start with isolated context, so the upstream prompt alone exposed the skill name but not its body. The shared skill tree and the Codex path are unchanged. The static invariants preserve the binding, and the behavioral check proves that the packaged agent can read a named principle without invoking `Skill` or reading a file.

**GPT-6.1 Sol default and the `ultra` effort.** The Sol row now uses `gpt-6.1-sol`, so the first-run `bug-fix`, `perf-issue`, and `hillclimb` roles and the arena, architect, and interrogate panels name `codex:gpt-6.1-sol@max`. The effort universe adds `ultra`. A row offers it only when its CLI's model entry lists it: Codex lists `ultra` for `gpt-6.1-sol` but not for the Luna models, so only the Sol row offers it. Setup rejects `ultra` on any other row, and the runner passes it to Codex unchanged. An existing sheet that names `codex:gpt-5.6-sol@<effort>` keeps running that model. `/setup-pstack` proposes `gpt-6.1-sol` on the next rerun and keeps the old model if the operator declines. `UPSTREAM.md` keeps the exclusion that leaves these three roles on Sol.

The shipped `pstack-runner` no longer loads the caller project's environment files or `bunfig.toml` at startup. Its POSIX shell launcher clears inherited `BUN_OPTIONS` and `NODE_OPTIONS`, then executes Bun with env-file loading disabled and project Bun configuration ignored while preserving ordinary parent-provided environment variables. It needs no `env -S` or directory-resolution helpers. The TypeScript entry keeps the first-statement deadline capture, and `exec` preserves signal behavior. Direct-executable regressions cover startup isolation, inherited environment, and preflight cancellation.

- Document Linux Landlock and bubblewrap prerequisites for bounded Grok lanes, including affected Claude Code cloud hosts, and link setup failures to the shared host and parent prerequisites without changing runner behavior (#56).

## Config-home port correction (#120)

Setup resolves the active harness's config home through `poteto-mode/references/codex-tools.md`: nonempty `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, falling back to `$HOME/.claude` or `$HOME/.codex` for unset or empty values. The model sheet, global instruction integration, current-state reads, snapshots, restoration, and readback all use that directory. Claude keeps the literal `@~/.claude/pstack-models.md` import at the default home and renders exactly `@./pstack-models.md` for a redirected home, keeping spaces and `#` in the config-directory name out of the import line. It identifies the existing import by the target basename `pstack-models.md`, replaces one matching line in place, appends when none exist, and stops before writing if more than one exists. Codex retains its exact-byte bounded block. Default-home behavior, role defaults, probes, and confirmation are unchanged.

This is an intentional Claude Code/Codex port divergence from Cursor's `~/.cursor/rules/` destination, recorded in `UPSTREAM.md` for the port-patch ledger (#105). The named config-home invariant in `tests/skill-collision-repro.sh` rejects literal default-home destinations outside the legacy import, requires the literal default-home rendering and zero/one/many import rules, and checks unset, empty, and space-containing resolution without writing daily files. `tests/setup-config-home-repro.sh` prepares private redirected directories while preserving real `HOME` and `USER`, and checks artifacts and unchanged daily targets; it does not substitute for installed-harness invocation, receipts, or fresh-session loading proof. The operator supplies that evidence on the final PR head and posts the live gate.

## 1.5.0 syncs to Cursor pstack 0.15.5

Open Pstack 1.5.0 tracks Cursor pstack 0.15.5 at `12d587dfb20741cafc376c42c696c5f6e2a64487`. The first-run panel is now three models: `claude:opus@max`, `codex:gpt-5.6-sol@max`, and `grok:grok-4.7@xhigh`. Opus max takes judgment and prose, hardest tasks, and the How explainer. Grok 4.7 xhigh takes feature and refactoring work, the How explorer, and Swarm workers. Bug-fix, perf-issue, and hillclimb stay on Sol max. Why and Reflect stay on `inherit-parent`. Fable stays in the model matrix with its native agents, but no first-run role uses it. Setup asks about roles first, then asks efforts for and probes only the assigned families (the ordering follows PR #73 by @arjitj2). It drops and lists retired-role rows such as `how critics`.

Imported: the operator-neutral wording, tick status only on change, code-ready rounds with two or more audit lanes and one fix-forward, rebases at the code-ready report and at merge prep, `children.tsv`, the owner Babysit exception, countersign as approval, Architect reading `architect runners`, Swarm SHA and method briefs, Shipping build-noise lane reuse, decision-trail `start` rows and supersede-only corrections, the non-truncating `log.sh`, and the #419 cuts. Not applied: the five exclusions listed in `UPSTREAM.md`, the Cursor manifest, and `docs/guide/`. Existing sheets are not rewritten. Delete role lines and rerun setup to take the new defaults. A `grok:grok-4.6` row keeps running until setup asks for its replacement. With no sheet, the new defaults apply on update.

## 1.4.1 syncs to Cursor pstack 0.15.1

Open Pstack 1.4.1 tracks Cursor pstack 0.15.1 at `f8abeddd1862dc73704e3d719dd73df0d51b8c71`. Poteto-mode now requires each claim to include its evidence or a measured, inferred, or guess label in the same sentence. Agents also run any check they can run themselves instead of handing that check to the user. No playbook, model, runtime, or dependency changed.

## 1.4.0 syncs to Cursor pstack 0.15.0

Open Pstack tracks Cursor pstack 0.15.0 at `71ed0d1076fec562c1b74ee353121a8d00f75382`. The shared catalog contains 54 skills, including 23 principles. This sync imports the skill density and punctuation passes, the 361,140-byte logo, and the verbatim upstream README. How, Why, and Teach take the shorter explanation guidance. Reflect runs only on explicit invocation. Poteto-mode no longer requires reading the whole principle index as the first todo, but still requires reading any applied leaf and citing it truthfully. Unslop adds the mannered-prose and over-compression rules, preserving stable rule numbers. Technical-writing proposes new abstract-metaphor offenders and replacements without editing Unslop automatically.

How's critique mode and `how critics` role are retired, and its two review references are deleted. Architect and Investigation use explain-only How. Setup now renders 15 role rows. An old 16-row sheet's `how critics` row has no consumer in ordinary dispatch. Setup reports it as an unknown role before any probe or write. Remove that row before rerunning the normal validated setup flow. On Codex, the editable sheet and bounded AGENTS block must agree. Invalid state or a failed probe leaves both unchanged.

Two new leaves carry narrow local correctness corrections, also reflected in their descriptions and Poteto-mode's index. `principle-test-behavior-not-implementation` warns conditionally about assertions that miss relevant behavior. `toBeDefined`, `toBeTruthy`, `toBeInstanceOf`, and `toBeGreaterThan(0)` do fail on `undefined`, and useful negative-path, prompt/configuration, and relational contract checks remain valid. `principle-attack-the-premise` limits the actor census and reassignment prescription to imbalance problems. An even census is evidence against an asymmetry hypothesis, not proof that a shared premise is correct. Later syncs take upstream's equivalent corrections if they land.

Opening a PR adopts the "briefing, not the lab notebook" guidance and links detailed evidence. The "about 40 lines" squash-body cutoff is omitted. The port's required installed-version, user-action, and observed-result evidence sections remain unchanged. The PR 44 shipping rules, parent-owned provider dispatch, Sol defaults for bug-fix, perf-issue, and hillclimb, and no-fallback/no-implicit-timeout contracts remain in place. The Autopilot chooser and Multi-phase plan reference remain intact.

Existing exclusions remain: `make-bot-ui`, Benny automations, Cursor-only guide and sticky-mode content, Cursor-only solo-model defaults, invocation-blocking flags on How, Why, Unslop, and TypeScript best practices, and the unsupported Claude manifest logo field. Those four skills stay user-invocable and model-invocable. The principle leaves keep `user-invocable: false`, which hides them from the slash menu but leaves model invocation open. The Cursor manifest is not imported. Watcher and orchestrator directories, package metadata, and lockfile have no upstream changes in this range. The unrelated Grok Voice plugin remains outside this sync.

## 1.3.0 syncs to Cursor pstack 0.14.7

Open Pstack now tracks Cursor pstack 0.14.7 at `efa2a531985e0a8084d36ff3cf87233be8a9f34b`.

**Forge-neutral pull request playbooks.** Shipping, Babysit, Autopilot-full, Autopilot-stack, Opening a PR, and Multi-phase plan use GitHub CLI by default and Origin when its CLI can resolve the repository. Same-repository base chains and fork stacks land from the bottom one pull request at a time. Stable patch IDs decide when a rewritten head needs a new code verdict. Owners open pull requests early, follow repository draft rules until required evidence exists, keep an uncommitted decision trail, and compare load-bearing behavior and performance at trunk and head. Graphite remains only in the unchanged Orchestrate frontier tooling.

Factory panel review hardened the upstream landing flow. Shipping freezes the stack and clears every pre-existing auto-merge request and native merge-queue entry before verification. On GitHub, it confirms that both `autoMergeRequest` and the separate `mergeQueueEntry` are null. It repeats the check for the current bottom pull request and every descendant before any branch or base mutation. Both autopilots apply the same rule before rewriting an existing pull request, and Opening a PR applies it before an existing child is rebased, force-pushed, or retargeted. Autopilot-stack delivers each bottom pull request through Shipping instead of offering merge-when-ready for descendants. Same-repository heads use a base-branch chain. Fork heads keep local parent ancestry, target trunk in the base repository, and use a frozen bottom-to-top list because a fork-only parent branch cannot be a pull request base. Autopilot-full preserves the same parent ancestry in its short private-stack exception. Owners open pull requests early but leave them draft when repository instructions require live evidence before readiness.

Fork-safe rebases resolve the base fetch remote separately from the head push remote. The playbooks resolve the head push URL before fetching stack parents, worktree refreshes, and live-lane heads. Rebase and publish steps use that exact URL, binding an explicit force-with-lease to the SHA captured before the rewrite. Each verdict records its head, patch base, and stable patch ID separately from the current landing head and base. A patch-equivalent rewrite keeps the verdict, but every merge guard uses the current landing head. After a parent is squash-merged, an explicit `git rebase --onto` moves only the child's commits from its recorded old parent to current trunk. The rebase command terminates option parsing before passing the short branch name. Git then updates the branch instead of leaving a detached HEAD. Fork pull requests use GitHub's pull-request API with the validated head repository name, which also supports organization-owned forks. Every GitHub pull request command names the canonical base repository. The installed-plugin watcher receives its owner, repository, and pull request number explicitly.

Values returned by the forge or repository stay shell data. The imported pull request playbooks pass them as quoted arguments instead of pasting contributor-controlled branch names or other forge values into shell source.

Immediate merges require a server-enforced expected-head guard. The playbook verifies `baseRefName` immediately before the GitHub merge and monitors it until merge. GitHub has no expected-base guard, so Shipping uses the supported head guard and reports a safety failure if the pull request lands in another base. Server-side auto-merge also requires a SHA-scoped independent-verdict check. Without that check, the agent watches until it can issue the guarded immediate merge. Every observed head or base change disarms every pending request and returns to verification. An unarmed frontier returns to the merge step when it becomes ready. Every terminal non-passing required check ends the watch while auto-merge or a merge-queue entry is pending. `UNSTABLE` remains nonterminal by itself. A stale or conflicted frontier returns to the guarded rebase flow.

Origin merge commands omit GitHub's unsupported `--squash` flag and stop when Origin cannot provide atomic expected-head and expected-base guards. Both autopilot playbooks use the same captured-SHA lease rule. Autopilot-full routes owner merges through Shipping's current-head flow.

**TypeScript boundary guidance.** The TypeScript skill scopes Claude Code automatic loading to `.ts` and `.tsx` files, prefers repository-owned runtime schemas over hand-written property guards, and derives types from those schemas with helpers such as `z.infer`. Codex continues to invoke the same shared skill by name.

**Codex presentation.** The exact upstream `assets/logo.png` now ships in the shared plugin. The Codex manifest exposes it through `interface.logo`. The Claude manifest does not add a logo field because Claude Code has no schema for it.

**No-op upstream revisions.** Upstream moved several Fable references to a newer revision slug. Open Pstack already stores rolling `claude:fable` and `claude:opus` aliases, so those edits require no port change.

**Upstream-only exclusions.** `make-bot-ui` from `799151d` and `6fecddb` is not ported because it is built entirely from Cursor routine, webhook, and UI primitives. The `disable-model-invocation` additions from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`; the flag would break poteto-mode's named invocation path on Claude Code. The `23a56e2` defaults that move `bug-fix`, `perf-issue`, and `hillclimb` from Sol to Fable are not applied because Fable costs much more for these frequent delegated code roles; all three stay on `codex:gpt-5.6-sol@max`. The Claude manifest logo field from `efa2a53` is also omitted because Claude Code has no schema for it.

## 1.2.1 keeps Fable and Opus on their latest Claude revisions

Open Pstack now stores `claude:fable@<effort>` and `claude:opus@<effort>` in its model matrix, role defaults, and generated setup sheets. Claude Code resolves those aliases to the latest family revision. Native Claude agents and external runner calls pass the same aliases.

Runtime dispatch normalizes the provider-qualified versioned Fable and Opus descriptors written by earlier releases before it chooses a route, so an installed sheet stops pinning as soon as the plugin updates. It does not write user files and reports that setup should persist the migration. `setup-pstack` applies the same rule before validation, preserves roles, lane order, and effort selections, and writes only after the existing probes and confirmation. The runner rejects any version pin that reaches its boundary, records both the requested alias and Claude's concrete reported revision, and verifies that the report belongs to the requested family. Static checks reject new active version pins.

## 1.2.0 adds verified multi-PR plans, earlier runtime diagnostics, and shared review-bot triage

Plans with several stages now use one checklist instead of an overview and separate files for each stage. It has one ordered section for every pull request and keeps all ten ways of testing the real product, unit tests, live and performance proof, checks for how changes work together, merge rules, and supporting details in one place. A Node-based checker with no extra dependencies rejects missing or out-of-order sections, fake screenshots, empty definitions of success, incomplete performance proof, incorrectly written review checks, unsupported punctuation, and incorrect command use. Claude Code and Codex use the same installed skill and checker through their existing parent-controlled setup. If a provider fails, it is identified by name and treated as a dropout. No backup provider or hidden time limit was added.

The shared startup script now checks for Node before using features that only Bun provides. If the startup script or watcher is run with Node, it prints one clear message and exits cleanly instead of failing later because `Bun` does not exist. The normal Bun behavior and every existing test for runners, watchers, and orchestrators are unchanged. CI uses Node 22.23.2 so this behavior is always checked against the same known version.

The separate Babysit skill now follows the same three-choice rule as poteto-mode Babysit: fix the problem, dismiss it, or ask what to do. Both versions point to one official Bugbot policy. A check of the packaged files confirms that both links work, only one copy of the policy exists, all three choices are present, and the listed situations default to asking, so the two versions cannot quietly become different.

## 1.1.0 adds selectable requested effort to setup-pstack

`setup-pstack` asks one requested effort per frontier family (`low`, `medium`, `high`, `xhigh`, `max`) instead of probing a fixed default quartet. `provider-dispatch.md` owns the model matrix: family, upstream choice, provider, model, first-run default effort, selectable efforts, and Claude-native agent stem. Setup loads the current sheet first, folds mixed per-family efforts with an explicit operator choice, probes only the four requested pairs, and writes nothing on a failed probe. A rerun rewrites that family's `@effort` suffix on every assigned role and leaves customized role-to-family lanes in place. First-run defaults remain Fable `max`, Sol `max`, Grok `xhigh`, and Opus `xhigh`.

Claude-native dispatch ships Fable and Opus agents at all five efforts. Names are `pstack-<stem>-<effort>`. `pstack-fable-max` and `pstack-opus-xhigh` stay. The runner already mapped all five efforts; tests now cover `low`, `medium`, and `high` for each provider. Evidence remains requested effort and route. There is no runtime resolver, same-provider external fallback, implicit timeout, or second configuration source.

## 1.0.2 retries transient Grok authentication preflights

`pstack-runner` now waits five seconds and retries `grok models` once when Grok's first preflight would be classified as unauthenticated. This handles the CLI's brief contradictory output during self-update, when it can print an unauthenticated banner while exiting 0 and listing the requested model. A second failure remains terminal with exit 77. The retry shares the existing absolute deadline and cancellation latch, the receipt keeps evidence from both attempts, and model execution still runs at most once.

## 1.0.1 removes duplicate workflow entries

Claude Code and Codex both load the native `plugins/pstack/skills/` tree. Codex 0.149.0 also converts each `plugins/pstack/commands/*.md` file into a generated `.codex-plugin/migrated-command-skills/source-command-*/SKILL.md`. The 31 same-named command trampolines therefore doubled Codex's workflow inventory. Claude's component inventory also registered both layers, although Claude Desktop visually merged the duplicate names.

This release deletes all 31 command trampolines. The native skill tree is now the only workflow source. Claude Code still supports both model-initiated `Skill` tool calls and user `/pstack:<name>` invocations through each native `SKILL.md`. Codex loads that same tree without generated source-command copies. The 21 `principle-*` leaves declare `user-invocable: false`; Claude hides them, while Codex 0.149.0 currently ignores that picker metadata ([#8](https://github.com/ericlitman/open-pstack/issues/8)).

`tests/skill-collision-repro.sh` rejects any legacy command layer, checks the requested principle visibility metadata, compares the version across `UPSTREAM.md` and the three manifests, and preserves the default model-quad check. Its behavioral mode builds a one-skill Claude fixture and proves that both a model-initiated `Skill` tool call and a user `/testplug:foo` invocation reach `SKILL-RAN`.

## 1.0.0 — establish open-pstack

`ericlitman/open-pstack` becomes the canonical cross-harness distribution. Its imported baseline is `053ed78732e3b71826933170eafe7f7782dda844`, synchronized to Cursor pstack v0.14.2 at `46125561306434d8a1d7745d540d8932ab0cd2a2`. The repository preserves the existing history and attribution while moving marketplace identity, links, and the private tooling package to open-pstack.

Claude Code and Codex continue to share one skill tree. The parent-owned Claude/Codex/Grok provider dispatch, explicit failure receipts, no-fallback rule, and lack of an implicit runtime timeout are unchanged. `UPSTREAM.md` records the review-first sync procedure, and ordinary pull requests run the Bun tests, typecheck, manifest parse, and static maintenance invariants in GitHub Actions. Live provider behavior remains a release gate because CI cannot substitute for subscribed CLI execution.

## 0.9.12 — restore the upstream frontier panel across Claude Code and Codex

The v0.14.2 sync kept pstack's workflow structure but replaced upstream's Fable 5 / GPT-5.6 Sol / Grok 4.6 / Opus 5 panel with Claude-only choices. This release restores the upstream frontier panel from either supported parent harness without adding another orchestrator.

**Parent-owned dispatch.** Model configuration now uses explicit `<provider>:<model>@<effort>` descriptors. Claude Code keeps Fable and Opus native and launches Sol and Grok externally. Codex keeps Sol native and launches Fable, Opus, and Grok externally. The top-level parent resolves that table once; children do not inspect inherited environment markers, select providers, or reroute themselves. Same-provider external calls are rejected.

**Deterministic external runner.** `skills/poteto-mode/scripts/runner/pstack-runner` accepts an already-resolved parent, provider, model, effort, access mode, prompt file, cwd, output file, receipt file, and optional timeout. It preflights the assigned subscribed CLI, invokes it once with provider-native read-only or isolated-write controls, disables nested agent orchestration, restricts provider tools, reserves concurrent outputs exclusively, and writes a structured receipt with model proof, elapsed time, usage, cost when exposed, and bounded failure evidence. Claude uses project-only settings and an explicit tool list. Grok uses its kernel sandbox and an explicit tool list, and its terminal Messages result is persisted without progress narration. Codex receipts distinguish a provider report from an exact pinned argv instead of fabricating a reported model. Missing CLIs, authentication failures, unavailable models, explicit timeouts, cancellations, catchable post-reservation failures, non-zero exits, malformed output, and model mismatches are loud dropouts. There is no fallback. Parent harnesses launch it as resumable background work because Claude's foreground Bash path has a ten-minute ceiling. The runner and preflight impose no arbitrary default deadline; `--timeout` is opt-in only when the user or task provides a real external bound, and that bound starts at wrapper entry, remains one end-to-end deadline rather than a fresh allowance per child, and is armed in runtime-safe chunks without shortening long bounds. The runner is self-contained and does not enter the shared script bootstrap/re-exec path. A run-scoped cancellation latch owns SIGINT and SIGTERM from reservation through the terminal receipt, wakes the active direct child wait to send the first signal once, tolerates repeated delivery while reaping it, cancels inherited-pipe reads after child exit, keeps child exit codes distinct from launcher exit status, records only signals it actually sent to the child, clears losing timers, removes the empty output reservation, and preserves a durable terminal receipt; retries use fresh attempt paths.

**Native Claude effort.** `pstack-fable-max` and `pstack-opus-xhigh` agent definitions pin model plus effort for Claude-native lanes and mechanically deny nested Agent/Task dispatch. Codex passes model and `reasoning_effort` directly to `spawn_agent`.

**Workflow integration.** One `provider-dispatch.md` reference owns the route contract. `setup-pstack`, poteto-mode, every code-writing playbook, and the How, Why, Reflect, Arena, Swarm, Architect, and Interrogate skills resolve configured roles through it. The default code roles and four-provider panel match upstream v0.14.2. MCP-dependent Why and Reflect roles stay native through `inherit-parent`, because an external provider process does not inherit the parent's live MCP tool surface. The Codex mapping treats an unavailable native lane as a named dropout instead of collapsing the panel, and the README documents the external CLI requirements.

**Tests.** The vendored Bun suite covers exact command construction, terminal provider output parsing, multi-model usage envelopes, auth/model preflight, honest provider-report versus pinned-argv proof, missing CLI, unavailable model, authentication/model classification, wrapper-entry and shared explicit deadlines, no-timeout delayed work, runtime-safe very-long deadlines, no-spawn after preflight exhaustion, inherited-pipe deadline/cancellation, truthful receipts for post-exit and externally signalled children, bootstrap-free isolated launch, terminal post-reservation failures, prompt retained-handle exit after a losing long timer, preflight and model cancellation, repeated-signal child reaping with a race-free fixture handshake, fresh-path retry, same-provider rejection, identity cleanup, exclusive paths, and simultaneous same-provider lanes. `tests/skill-collision-repro.sh` compares the provider-qualified panel descriptors across the setup sheet, four panel skills, and canonical dispatch reference. Live Claude-parent and Codex-parent behavioral probes are a release gate; unit tests alone are insufficient.

## 0.9.11 — sync to upstream v0.14.2

Catches the port up with upstream `cursor/plugins/pstack` from `3fe2823` (v0.11.3) to `4612556` (v0.14.2). Skills 48 → 52, commands 27 → 31, subagents 1 → 2, plus a vendored `scripts/` tree under `poteto-mode/`.

**New skills.**

- `swarm` (upstream `b79f8ca`, `91dd7b7`): fan out N parallel workers over slices or races, drain them, return one report. Upstream spawns Cursor cloud agents; Claude Code has no remote worker environment, so the port spawns local background subagents and takes isolation from a worktree or a per-worker output directory. The worker default follows the port's single-role default (`claude-opus-4-8`) and reads `swarm workers` from `~/.claude/pstack-models.md`.
- `no-comments` plus the `comment-sicko` subagent (#185): a comment-stripping review pass. `Task` → `Agent`, and upstream's agent name `Comment Sicko` becomes `comment-sicko` because a `subagent_type` with a space is not addressable.
- `technical-writing` (#185): the layered Diátaxis / Google developer style / STE / Global English standard. No Cursor primitives, copied as-is.
- `bro` (#187): restate the last message in plain language. Copied as-is.

Per the 0.9.8 invariant, all four drop upstream's skill-side `disable-model-invocation: true` and get command trampolines that carry it instead.

**New playbooks** (#185, #187), under `poteto-mode/playbooks/`: `babysit` (drive a PR or stack to merge-ready), `shipping` (verify each PR independently, then land the contiguous verified run), `orchestrate` (a standing multi-day program under one coordinator), `autopilot-full` and `autopilot-stack` (one owner per PR, swarm-verified), and `worktree-cleanup` (safety-gated disk reclamation). They share the new `references/bugbot-triage.md` rubric, which the poteto-mode review-bot trigger now points at.

Substitutions in the six: Cursor cloud agents become local background subagents isolated by worktree; `control-cli` / `control-ui` become the `run` / `verify` built-ins; `Task` becomes `Agent`; `AskQuestion` becomes `AskUserQuestion`; the Cursor agent store becomes `~/.claude/orchestrate/<slug>/`, which outlives the session the way a multi-day program's store has to; a Cursor restart becomes a session restart; the Cursor dashboard becomes the background task list. Cursor's `/goal` has no Claude Code equivalent, so the autopilots keep the program objective in the standing orders and the todolist, and their audit tick re-reads the playbook from the installed plugin instead of `git show origin/main:pstack/...`. Graphite (`gt`) is not Cursor-specific and stays.

**Babysit, skill versus playbook.** Upstream v0.14.0 stopped routing PR-status requests to Cursor's built-in babysit and gave poteto-mode its own playbook. The port's bundled `babysit` skill (the 0.9.2 analog of that built-in) stays as the standalone `/babysit` entry point; inside poteto-mode the playbook supersedes it, and both files say so.

**Vendored scripts.** `poteto-mode/scripts/` carries upstream's `watch-pr` (the PR watcher the Babysit and Shipping playbooks poll), `orch` (the orchestrate store CLI), `worktree-audit.sh`, and the bun bootstrap. Three edits: `worktree-audit.sh` reads `~/.claude/projects/` — scanning the whole projects tree, since a session run inside a worktree gets its own encoded directory — instead of `~/.cursor/projects/<slug>/agent-transcripts`; it warns when `jq` or `rg` is missing, because their absence silently blanks the PR and LAST_CHAT columns and downgrades an in-use worktree to `safe` in the one playbook that deletes user state; and the private workspace package is renamed `@pstack-claude/poteto-mode-tools` in `package.json` and `bun.lock`. `bun` joins `gh` as a documented system dependency, `gt` only for the stack playbooks and `jq`/`rg` only for the worktree audit. `node_modules/` under the scripts dir is gitignored.

**Content refinements over the port's existing translation.** `architect` gains design-it-twice, the `design-red-flags.md` screen, and the interface-depth comparison (#175), with the matching rationale-template and runner-prompt edits. Nine `principle-*` leaves, `unslop`, `typescript-best-practices` (plus 69 new lines of `references/patterns.md`), and `lead-judgment.md` take upstream's HEAD bodies verbatim; their bodies were byte-identical to upstream `3fe2823` beforehand, so the port keeps only its own frontmatter. `interrogate` moves its reviewer defaults into a labelled A/B/C/D table (#167). `create-verification-skill` points at the new `feature-map-example/` and names the four required H2s (#178). `automate-me` learns that mode skills can live in a personal category directory (#187). `opening-a-pr` takes upstream's title, description, readiness, and babysit rewrite (#185, #238), and `autonomous-run` takes mid-run-discovery ownership (#170).

**Model configuration.** Upstream's slug bumps (#165, #166, #169, #210: fable / sol / grok / Opus 5) are not ported — the port keeps its own Claude quad (`claude-opus-5`, `claude-fable-5`, `claude-opus-4-6`, `claude-sonnet-5`) and its `claude-opus-4-8` single-role default. What is ported is the structure: the `inherit-parent` / `auto` aliases (#163), which on Claude Code mean omitting `model` on the `Agent` call so the role runs on the parent session's model, and the config-source-first phrasing (#167) in `arena`, `interrogate`, and `swarm`. `setup-pstack` gains the aliases, the `swarm workers` row, and the alias-aware validation rules.

**Deliberately not ported.** `docs/guide/` (the ten-chapter tutorial and its six screenshots, 2.3 MB) teaches pstack through Cursor's UI, sticky mode, and cloud agents, and ships no skill content; README links it upstream. `is_background: true` on `poteto-agent` is Cursor agent frontmatter with no Claude Code key. Sticky mode and Benny remain out, unchanged from the earlier reviews.

**Test fix.** The quad invariant in `tests/skill-collision-repro.sh` had been searching the panel skills for `claude-sonnet-4-6`, a slug the 0.9.10 panel swap removed, so the check failed on `main` for every skill. It now derives the anchor slug from the canonical `arena runners` row and reads `interrogate`'s quad from its new reviewer table.

**Verified.** 52 skills / 31 commands / 2 subagents; three manifests parse at 0.9.11. Static invariants pass, including the repaired quad check. The vendored scripts pass `bun install --frozen-lockfile`, `bun test orch watch-pr` (52 tests), and `bun run typecheck` from their ported location. Not yet live-verified in a Claude Code or Codex session.

## 0.9.10 — sync to upstream v0.11.3

Catches the port up with upstream `cursor/plugins/pstack` from `0452e08` (v0.10.0) to `3fe2823` (v0.11.3). Skill count 44 → 48, commands 24 → 27.

**New skills.**

- `teach` (#153): composes the `how` and `why` skills into one plain explanation. Command-paired public skill; platform note for the parallel dispatch and image-gen tool.
- `principle-model-the-domain` (#147): encode the domain in a structure instead of scattered conditionals. Verbatim upstream prose, `user-invocable: false` per the 0.9.9 principle convention, woven into `poteto-mode`'s data-shape trigger and Architecture index, and into the `feature` and `refactoring` playbooks.
- `create-verification-skill` and `maintain-verification-skill` (#150, #151): generate and maintain a persistent, repo-tailored project verification skill plus feature map. A different layer from Claude's built-in `run`/`verify` per-session drivers, which they complement. Translation: `.cursor/skills/` → `.claude/skills/`, drop `disable-model-invocation` (command-paired), add command trampolines and platform notes.

**Content refinements (#155, #156), applied over the port's existing Cursor→Claude translation.** The perf playbook's eight strategy families; `interrogate` "four-model" → "multi-model"; the `hillclimb` ground-the-workload-first rewrite; rationale one-liners across five playbooks; `typescript-best-practices` real-tests and structured-telemetry rows; the `why` databricks source `SHOW TABLES` note.

**Model strategy (#143, #156).** `poteto-mode` now tiers code delegates by difficulty — hardest changes to the strongest judgment model (`claude-fable-5`) or the strongest instruction follower, trivial edits to a fast code model, everything else `claude-opus-4-8`. `setup-pstack` gains the configurable `arena cross-judge pool` row. The upstream `grok`/`gpt` slugs stay substituted with `claude-*`.

**Deliberately not ported.** Sticky mode (#144) is Cursor-only frontmatter (`mode`/`icon`/`color`/`reminder`) with no Claude Code equivalent; the port's 0.9.5 SessionStart hook already auto-fires `poteto-mode` with the same non-trivial/trivial/opt-out logic. Benny (#137) remains out, per the earlier review.

## 0.9.9 — principle leaves hide from the slash menu

0.9.8 kept `disable-model-invocation: true` on the 20 `principle-*` leaves, on the reasoning that they have no command and are read by path from `poteto-mode`. But that flag only blocks *model* invocation. It does not hide a skill from the user `/` menu, so all 20 surfaced as bare `/principle-*` slash commands in every session (confirmed across projects on the desktop app). They are internal references; users should never invoke them.

Fix: swap the flag for `user-invocable: false` on all 20 leaves. Per the [Claude Code skills docs](https://code.claude.com/docs/en/skills.md), `user-invocable: false` hides a skill from the `/` menu and controls menu visibility only, not Skill-tool or file access — so `poteto-mode` reading each leaf by path (`../principle-<name>/SKILL.md`, the mechanism the leaves have always used) is untouched. The two flags are mutually exclusive: setting both leaves a skill neither user- nor model-invocable, so this is a swap, not an addition. The visible consequence is that the leaves become model-auto-invocable on description match — the same standing the 12 command-paired skills took in 0.9.8, and immaterial to the by-path reference the leaves actually rely on. The invariant is now: every command carries `disable-model-invocation: true`, no command-paired skill carries it, and every `principle-*` leaf carries `user-invocable: false`.

## 0.9.8 — command-paired skills drop `disable-model-invocation`

The 0.9.7 fix put `disable-model-invocation: true` on all 24 command trampolines so the Skill tool resolves a colliding name to the skill. But 12 of those skills carried the same flag in their own frontmatter (present since the initial port), and the flag on a **skill** makes the Skill tool refuse the invocation outright. Net effect: the 0.9.5 SessionStart mandate ("invoke `pstack:poteto-mode` with the Skill tool") was refused every session, five of the six direct-entry skills it lists (`poteto-mode`, `tdd`, `architect`, `arena`, `interrogate`; only `how` and `why` were unflagged) were model-unreachable, and every user-typed `/pstack:<name>` for a flagged skill expanded to a trampoline body the model then couldn't follow. 0.9.7 didn't cause the skill-side flags, but it surfaced them: before it, the same calls died in the trampoline loop instead.

Fix: remove the flag from the 12 command-paired skills that carried it (`architect`, `arena`, `automate-me`, `blast-radius`, `figure-it-out`, `interrogate`, `poteto-mode`, `recall`, `reflect`, `show-me-your-work`, `tdd`, `thermo-nuclear-code-quality-review`). The resulting invariant is symmetric: every command carries the flag, no command-paired skill does. The `principle-*` leaves keep it — they have no commands and are deliberately read by path from `poteto-mode`. Model auto-invocation on description match is now possible for the 12; that is the 0.9.5 design intent, and the same standing the other 12 always-unflagged skills (`how`, `why`, `babysit`, `deslop`, …) already had.

`tests/skill-collision-repro.sh` gains the mirrored static invariant (no skill with a same-named command may carry the flag) and a fourth behavioral leg preserving the repro: with the flag on the skill, the Skill tool refuses the invocation even though the command no longer shadows it.

## 0.9.7 — command trampolines no longer shadow their skills

Every user-facing skill ships with a same-named `commands/<name>.md` trampoline whose body is "Invoke the `<name>` skill and follow it." On Claude Code, the Skill tool resolves a colliding name to the **command**, not the skill — so a model-initiated invoke of `pstack:<name>` got the trampoline back, which told it to invoke the skill, which resolved to the trampoline again. Mutual recursion; the real `SKILL.md` never loaded. This hit every model-side entry path, including the 0.9.5 SessionStart mandate (whose whole job is telling the model to invoke `pstack:poteto-mode`), and it made each name appear twice in the model's skill list. Observed in desktop-app sessions (inline `--plugin-dir` loading, same path as the 0.9.3 entry); reproduced on CLI 2.1.195 with a minimal two-artifact plugin.

Fix: all 24 command files now carry `disable-model-invocation: true` — the flag the `principle-*` leaf skills already use. Verified on 2.1.195 with the same minimal plugin: the Skill tool then resolves the colliding name to the skill (its `SKILL.md` is what gets injected), while a user-typed `/plugin:<name>` still runs the command trampoline, whose "invoke the skill" body now lands on the skill instead of looping. Command bodies are unchanged, so the Codex prompts path (which reads `description` frontmatter and the filename, and ignores keys it doesn't know — the established `name`-key precedent) is untouched. Whether a full Codex plugin install still surfaces the stubs in its picker with the flag present is unverified; if it hides them, the skills themselves remain the primary Codex surface and are invocable by name. Incidental finding from the same repro, recorded for future use: `${CLAUDE_PLUGIN_ROOT}` **is** substituted inside command markdown bodies on 2.1.195, not just in hooks and MCP configs.

The repro is preserved as `tests/skill-collision-repro.sh` (manual; needs the `claude` CLI, makes three haiku calls). It checks the static invariant (every command carries the flag) and the three behavioral legs: command wins the collision without the flag, skill wins with it, user-typed `/command` still runs. The first leg is a precedence detector — if it ever fails, upstream changed the undocumented resolution order and the flag should be re-evaluated, not the fix declared broken.

## 0.9.6 — hook hardening and duplication trims (thermo-nuclear review)

A strict maintainability review of the 0.9.3–0.9.5 range drove these:

- `hooks/session-start` collapsed from 43 lines to 3: SessionStart hook stdout reaches context directly (per the hooks docs; verified end-to-end on 2.1.197), so the JSON envelope, the `escape_for_json` pass, and the Cursor/Copilot platform branches — dead code here, since `hooks.json` is the only registration — are gone. This also removes a verified failure-path bug: the old `cat ... 2>&1 || echo` fallback was additive, silently injecting raw `cat` stderr plus the fallback string into session context when the context file was unreadable; now a missing file fails the hook cleanly and injects nothing. The script is no longer adapted from superpowers (NOTICE updated; `run-hook.cmd` remains near-verbatim and attributed).
- Panel-quad enumeration trimmed from the `poteto-mode` meta-files (`SKILL.md`, `references/plan.md`, `references/codex-tools.md`) — the slugs now live only in the four panel skills and the `setup-pstack` sheet, with a grep-identical rule added to Maintenance. This drift class already bit once (0.9.4 fixed a three-reviewers-vs-"four different models" mismatch).
- README's desktop-app `dependency-unsatisfied` narrative deduplicated to a two-sentence summary linking the CHANGES 0.9.3 entry.

## Upstream review through `0452e08` (v0.10.0), 2026-07-01

One upstream pstack commit landed after the `e46364b` sync: `0452e08` adds the dormant `automations/benny/` pack (Slack issue triage plus reproduce-and-fix, built on Cursor's event-triggered automations) and bumps upstream to 0.10.0. Deliberately not ported — rationale and revisit criteria in README → What's deliberately not ported. `cursor-team-kit` has no commits since the sync point (its latest, `679fdaf`, 2026-05-28, predates `e46364b`). The port's skill tree was current with upstream HEAD as of this note; the later 0.9.10 sync carries it forward to v0.11.3 (see above).

## 0.9.5 — poteto-mode auto-fires via SessionStart hook

`plugins/pstack/hooks/` is new. `hooks.json` registers a `SessionStart` hook (matcher `startup|clear|compact`) that injects `hooks/session-start-context.md` (~0.3k tokens) as additional context — the same mechanism superpowers uses to auto-load its skill-use mandate. The injected block routes any non-trivial engineering task into `pstack:poteto-mode` before the first response, lists the direct-entry skills, tells dispatched subagents to ignore it, and defers to explicit user instructions. The full poteto-mode skill still loads only on invoke. `run-hook.cmd` (cross-platform polyglot) and the JSON-emission pattern in `session-start` are adapted from superpowers (MIT; see NOTICE.md and LICENSE-superpowers). Codex is unaffected — it has no plugin hook runtime; invoke poteto-mode by name there.

## 0.9.4 — Sonnet 5 joins the default panels

The multi-model panels (`arena` runners, `architect` runners, `interrogate` reviewers, `how` critics) grow from a triple to a quad: `claude-opus-4-8`, `claude-sonnet-5`, `claude-opus-4-6`, `claude-sonnet-4-6` — both generations in each of two tiers. This also restores upstream's four-way `interrogate` split; the port had been running three reviewers under a "four different models" description. `setup-pstack` adds Sonnet 5 (`claude-sonnet-5`) to the available-family enumeration and to the four panel rows of its default sheet. Single-model delegation defaults stay `claude-opus-4-8`. Touched: `arena`, `architect`, `interrogate`, `how`, `setup-pstack`, `poteto-mode` (`SKILL.md`, `references/plan.md`, `references/codex-tools.md`), and the README substitution-table panel row. The historical Cursor→Claude mapping rows (`composer-2.5-fast`, `gpt-5.x`) are unchanged — they record what the 0.9.2 sync substituted, not current defaults.

## 0.9.3 — dependency declaration removed

`plugin.json` no longer declares `dependencies: [{ "name": "plugin-dev", "marketplace": "claude-plugins-official" }]`, and `marketplace.json` drops the matching `allowCrossMarketplaceDependenciesOn`. The Claude Code desktop app passes every enabled plugin to the CLI as a session-only `--plugin-dir`, which strips marketplace identity (`pstack@inline`); a cross-marketplace dependency can never resolve in that mode, and the loader disables the entire plugin with `dependency-unsatisfied`. Result: pstack loaded in the CLI and the VS Code extension but silently vanished from desktop-app sessions. `optional: true` on a dependency entry passes `claude plugin validate` but is not honored by the loader (tested on 2.1.197). `plugin-dev` is now a documented manual install (README → Dependencies); skill bodies still route skill-authoring to `plugin-dev:skill-development` when it is present.

## Codex port

pstack also ships as a Codex plugin. The skill bodies are not forked or regenerated. The same `skills/` tree serves both runtimes. One mapping file does the Claude-to-Codex translation. That single-mapping-file spine is the same one the official `superpowers` plugin ships for Codex.

pstack diverges from superpowers in one respect, and it is deliberate. superpowers writes its skill prose in tool-neutral language ("dispatch a subagent"), so no skill names a runtime tool and no per-skill note is needed. pstack instead keeps the upstream Claude-native prose intact, to stay in lockstep with upstream sync, and adds a one-line Platform note to each skill that names a Claude primitive. The note points at the mapping. Rewriting 44 upstream skills into neutral language would fork them from upstream and was rejected for that reason.

**Added.**

- `plugins/pstack/.codex-plugin/plugin.json` is the Codex plugin manifest (`skills: ./skills/`), with key-parity to the `superpowers` Codex manifest.
- `.agents/plugins/marketplace.json` is the Codex marketplace manifest at the repo root, sourcing `./plugins/pstack` the way the Claude `.claude-plugin/marketplace.json` does.
- `plugins/pstack/skills/poteto-mode/references/codex-tools.md` is the single Claude to Codex map. It covers tool actions (`Agent` becomes `spawn_agent` / `wait_agent` / `close_agent`, `AskUserQuestion` becomes plain text, the todolist becomes `update_plan`), the `multi_agent` config flag, subagent policy (Codex has no `poteto-agent` type, so dispatch a `spawn_agent` told to read `poteto-mode` first), model slugs (`claude-*` becomes your configured Codex models), the Claude built-ins pstack names (`run`, `verify`, `loop`, `plugin-dev:skill-development`), and the instructions file (`AGENTS.md`).

**Platform notes (pointer-only edits).**

- `skills/poteto-mode/SKILL.md` gained a "Platform Adaptation" section pointing at the mapping.
- `skills/{architect,arena,automate-me,babysit,how,interrogate,reflect,why}/SKILL.md` each gained a one-line Platform note, since each names a Claude tool, a `claude-*` slug, or a Claude built-in. The pure-prose skills (the `principle-*` set, `tdd`, `figure-it-out`, and the cursor-team-kit imports) needed nothing.
- `skills/setup-pstack/SKILL.md` gained a Codex branch. It writes `~/.codex/pstack-models.md` referenced from `~/.codex/AGENTS.md`, using Codex slugs instead of `claude-*`.

**Commands.** The 24 `commands/*.md` files are Codex-compatible as written, no rewrite needed. Codex command discovery reads the `description` frontmatter and the filename and ignores the extra `name` key, and each body (`Invoke the <skill> skill and follow it`) is a valid Codex prompt. They surface as slash commands once the full plugin is installed in Codex. For the symlink-based install, drop the same files into `~/.codex/prompts/` for loose `/name` shortcuts alongside the symlinked skills.

**Deliberately not ported.**

- `agents/poteto-agent.md`. Codex has no `subagent_type`, so ad-hoc subagents are dispatched via `spawn_agent` told to read `poteto-mode` first. The mapping covers this.

**Verified.** Codex discovers the skills and namespaces them under `pstack` (`pstack:poteto-mode` and so on) in a live session. Mapping resolution mid-task and `spawn_agent` fan-out follow the `superpowers` pattern and are worth confirming per session.

**Maintenance.** The open-pstack version string lives in `plugins/pstack/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugins/pstack/.codex-plugin/plugin.json`, and the current-version row in `UPSTREAM.md`. A version bump must update all four. `tests/skill-collision-repro.sh` checks that they match. A version bump also needs a `CHANGES.md` section that starts with the version, and the release moves any `Unreleased` entries into it. `scripts/release.py publish` builds the release notes from that section. `.agents/plugins/marketplace.json` carries no version field. The canonical default panel is the `arena runners` row of the setup-pstack first-run sheet. It is copied into the other three panel rows and into `arena`, `architect`, and `interrogate`. Keep those copies grep-identical when models change. The static test reads the panel from that row, and `model-matrix.test.ts` pins its families and checks each effort against the matrix. After a sync that touches `skills/poteto-mode/scripts/`, run `bun install --frozen-lockfile`, `bun run test`, and `bun run typecheck` from that directory. `hooks/session-start-context.md` restates skill one-liners. Re-verify it whenever skill names or descriptions change. The package must not contain a `commands/` layer. Claude Code and Codex load the native `skills/` tree directly, and a command layer duplicates that inventory. The 24 `principle-*` leaves carry `user-invocable: false` to request exclusion from the user picker while `poteto-mode` reads them by path. Claude honors the metadata; Codex 0.149.0 currently does not ([#8](https://github.com/ericlitman/open-pstack/issues/8)). They must not carry `disable-model-invocation`, which would make them unreachable to the model. Re-run the behavioral mode of `tests/skill-collision-repro.sh` after Claude Code upgrades to check both model-initiated and user-initiated native skill invocation.

## 0.9.2 sync (against upstream `e46364b`)

Upstream pstack jumped from `0.1.0` → `0.9.2` between syncs. 30+ commits, including 11 new files.

**New pstack-native skills/playbooks pulled in (Cursor refs in them re-substituted on the way in):**

- `skills/blast-radius/` — find what a change could break beyond the diff.
- `skills/recall/` — reconstruct recent working context. Cursor transcript path (`~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`) rewritten to Claude Code path (`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`).
- `skills/setup-pstack/` — model-per-role configuration. Substantially rewritten: original wrote `~/.cursor/rules/pstack-models.mdc` (Cursor's `.mdc` always-applied-rule feature, no Claude Code analog). Replacement writes `~/.claude/pstack-models.md` and instructs the user to add an `@~/.claude/pstack-models.md` include to `~/.claude/CLAUDE.md` so the override sheet loads each session.
- `skills/principle-build-the-lever/`, `skills/principle-sequence-verifiable-units/` — new principles.
- `skills/poteto-mode/playbooks/{hillclimb,pause-safely,refactoring,session-pickup,trace-forensics}.md` — new playbooks.
- `skills/interrogate/references/code-quality-review.md` — new interrogate reference.

**Re-applied substitutions across changed + new content:**

- Bulk pass through 28 files via Python regex covering all entries in the substitution table above.
- Targeted fixes for variants the bulk pass missed:
  - `recall/SKILL.md` line 15 — Cursor transcript path rewrite.
  - `why/SKILL.md` line 100 — MCP discovery wording variant.
  - `poteto-mode/SKILL.md` lines 22–25 — `cursor-team-kit` qualifiers removed; Bugbot triage refs to `babysit`.
  - `reflect/SKILL.md` lines 37, 45, 49 — readonly/agent-mode language; `Task` → `Agent`.
  - `poteto-mode/playbooks/session-pickup.md` line 7 — `agent-transcripts/` path.
  - `poteto-agent.md` description — `generalPurpose` → `general-purpose`.
- Bumped Opus references from `claude-opus-4-7` to `claude-opus-4-8` (current Claude family head).
- Multi-model panels (`arena`, `architect`, `interrogate`, `how` critics, and the `setup-pstack` defaults) had a duplicate `claude-sonnet-4-6` in the third slot. Replaced one with `claude-opus-4-6` so the panel runs three distinct models (`claude-opus-4-8`, `claude-opus-4-6`, `claude-sonnet-4-6`) instead of two — cross-generation diversity inside the opus tier where cross-vendor diversity isn't available.
- All single-subagent delegation defaults bumped from `claude-sonnet-4-6` to `claude-opus-4-8`: `bug-fix`, `feature`, `perf-issue`, `refactoring`, `hillclimb` (the five poteto-mode code-writing playbooks); `how-explorer`, `why-investigators`, `reflect-tooling` (the three multi-subagent dispatches that run the same model in parallel rather than a diverse panel). Setup-pstack override sheet updated to match. Meta-defaults in `poteto-mode/SKILL.md` and `plan.md` rephrased: "default `claude-opus-4-8` for code-writing delegations" replaces the old "claude-sonnet-4-6 for code" wording. Sonnet now appears only in the diverse 3-model panels.

**Command stubs added:** `commands/blast-radius.md`, `commands/recall.md`, `commands/setup-pstack.md`.

**Manifest changes:**

- `plugins/pstack/.claude-plugin/plugin.json` — version `0.1.0` → `0.9.2`; added `displayName: "pstack (Claude Code port)"`.
- `.claude-plugin/marketplace.json` — plugin entry version bumped to `0.9.2`.

**Team-kit imports:** unchanged. The upstream diff showed only `verify-this` (which we didn't import) changed in `cursor-team-kit/skills/`.

**`babysit` skill:** unchanged. Locally authored; not affected by upstream sync.

---

## Substitution table

| Cursor primitive | Replaced with | Notes |
| --- | --- | --- |
| `Task` tool | `Agent` tool | Claude Code's `Agent` tool is the equivalent. |
| `subagent_type: generalPurpose` | `subagent_type: "general-purpose"` | Kebab-case in Claude Code. |
| `subagent_type: "poteto-agent"` | `subagent_type: "poteto-agent"` | Unchanged — this plugin ships that agent. |
| `readonly: true` / `readonly: false` | (dropped; rewritten as "pick a subagent_type that retains MCP access") | Claude Code controls tool/MCP access via subagent_type, not a per-call readonly flag. |
| `AskQuestion` | `AskUserQuestion` | Tool rename; semantics match. |
| Cursor `/loop` (built-in) | Claude Code `loop` skill | 1:1 replacement; available as a built-in skill. |
| Cursor `/babysit` (built-in) | This plugin's `babysit` skill | New Claude Code analog at `skills/babysit/` wrapping `gh` + `loop`. |
| Cursor `/create-skill` (built-in) | `plugin-dev:skill-development` skill | Claude Code's authoring guidance for SKILL.md. |
| `cursor-team-kit` `/deslop` | This plugin's `deslop` skill | Ported in (only team-kit skill imported). |
| `cursor-team-kit` `control-cli` | `run` skill (Claude Code built-in) | Drives CLIs/TUIs. |
| `cursor-team-kit` `control-ui` | `verify` skill (Claude Code built-in, VS Code extension) | Drives UIs (browser/Electron). |
| `~/.cursor/projects/*/` transcripts | `~/.claude/projects/<encoded-cwd>/*.jsonl` | `<encoded-cwd>` is the workspace's working directory with `/` → `-`. |
| Cursor `agent-transcripts/` dir | `~/.claude/projects/<encoded-cwd>/` | Same as above. |
| `.cursor/skills/`, `~/.cursor/skills/`, `~/.cursor/plugins/` | `.claude/skills/`, `~/.claude/skills/`, `~/.claude/plugins/` | Path-only translation. |
| Cursor `mcps/` directory | Tool list at top of system prompt (`mcp__<server>__<name>` prefixed entries), or `.mcp.json`, or `claude mcp list` | Discovery surface differs. |
| Model: `composer-2.5-fast` | `claude-sonnet-4-6` | Fast workhorse Claude. |
| Model: `claude-opus-4-X-thinking-xhigh` | `claude-opus-4-8` (with note "extended thinking" where it appeared in a table) | Claude Code uses model IDs without the Cursor UI suffix; extended thinking is a separate knob. Originally substituted to `4-7`, then bumped to `4-8` to match the current Claude family. |
| Model: `gpt-5.3-codex-high-fast`, `gpt-5.5-high-fast` | `claude-sonnet-4-6`, `claude-haiku-4-5` | Within Claude Code, cross-vendor diversity isn't native. Skills that need a harsher pass now route to the bundled `thermo-nuclear-code-quality-review` skill (imported from cursor-team-kit) as the escape hatch. Different style of pressure (strict maintainability rubric), not vendor diversity. |

## New / imported files

- `skills/babysit/SKILL.md` — Claude Code analog of Cursor's `/babysit`. Wraps `gh pr view` / `gh pr checks` / `gh run view --log-failed` plus the `loop` skill for pacing. Provenance: independently authored; workflow informed by Cursor's public `/babysit` behavior. Not a copy of Cursor's closed-source implementation.
- `commands/babysit.md` — slash command routing to the babysit skill.
- `skills/thermo-nuclear-code-quality-review/SKILL.md` — imported verbatim from `cursor-team-kit`. Used as the harsher-critique escape hatch in `arena`, `interrogate`, `architect`, and `how` (replaces the Cursor-original cross-vendor bridge).
- `commands/thermo-nuclear-code-quality-review.md` — slash command stub.
- `skills/make-pr-easy-to-review/`, `skills/fix-ci/`, `skills/fix-merge-conflicts/`, `skills/get-pr-comments/`, `skills/what-did-i-get-done/` — five more skills imported verbatim from `cursor-team-kit`. Audited for Cursor-specific refs; none found, so no rewiring needed. They use only `gh` and `git` primitives.
- `commands/make-pr-easy-to-review.md`, `commands/fix-ci.md`, `commands/fix-merge-conflicts.md`, `commands/get-pr-comments.md`, `commands/what-did-i-get-done.md` — slash command stubs.
- `.claude-plugin/marketplace.json` — marketplace manifest so the repo is installable via `/plugin marketplace add michael-denyer/pstack-claude`. Declares `allowCrossMarketplaceDependenciesOn: ["claude-plugins-official"]` so the cross-marketplace dependency on `plugin-dev` resolves at install time.
- `plugin.json` `dependencies` — declares `plugin-dev` (from `claude-plugins-official` marketplace) as a required dependency, since the rewiring routes skill-authoring tasks to `plugin-dev:skill-development`.

## Per-skill changes applied

### `skills/poteto-mode/SKILL.md`

- Triggers section: `create-skill` → `plugin-dev:skill-development`; `deslop` "from `cursor-team-kit`" qualifier dropped; `control-cli`/`control-ui` line replaced with `run`/`verify` driver guidance; `Cursor's built-in **babysit**` → this plugin's `babysit`.
- Subagents section: `Task` → `Agent`; `composer-2.5-fast` → `claude-sonnet-4-6`; `claude-opus-4-8-thinking-xhigh` → `claude-opus-4-8`; "agent mode (readonly strips MCP)" → "full tool access (do not pick a subagent_type that strips MCP)".

### `skills/poteto-mode/references/plan.md`

- `AskQuestion` → `AskUserQuestion`.
- `generalPurpose` → `"general-purpose"`; built-in `plan` subagent_type → Claude Code's built-in `Plan` agent; both model slugs updated.
- `create-skill` → `plugin-dev:skill-development`.
- `control-ui` / `control-cli` lines replaced with `verify` / `run` driver skills.
- "Cursor's built-in **babysit** skill" → "the **babysit** skill".

### `skills/poteto-mode/playbooks/`

- `authoring-a-skill.md`: `create-skill` → `plugin-dev:skill-development`.
- `autonomous-run.md`: "Cursor's `/loop` command (a built-in, not a pstack skill)" → "Claude Code's `loop` skill (built-in)".
- `bug-fix.md`, `feature.md`, `perf-issue.md`: `composer-2.5-fast` → `claude-sonnet-4-6`; "control skill" → "driver skill (`run` for CLIs/TUIs, `verify` for UIs)".
- `eval.md`: `agent-transcripts/` + `~/.cursor/projects/*/` → `~/.claude/projects/<encoded-cwd>/*.jsonl`.
- `opening-a-pr.md`: `Task` → `Agent`; "Cursor's built-in **babysit** skill" → "the **babysit** skill".
- `prototype.md`, `runtime-forensics.md`, `visual-parity.md`: "control skill" → "driver skill" with `run`/`verify` explicit.

### `skills/automate-me/SKILL.md`

- Description and body: `create-skill` (6 places) → `plugin-dev:skill-development`.
- `AskQuestion` (2 places) → `AskUserQuestion`.
- `.cursor/skills/` / `~/.cursor/skills/` → `.claude/skills/` / `~/.claude/skills/`.
- `agent-transcripts/` + `~/.cursor/projects/*/` → `~/.claude/projects/<encoded-cwd>/*.jsonl`.

### `skills/reflect/SKILL.md` + `references/*.md`

- Transcript paths → `~/.claude/projects/<encoded-cwd>/*.jsonl`.
- `Task` → `Agent` (in SKILL.md and all three reviewer references).
- `generalPurpose` → `"general-purpose"`; `readonly: false` + "agent mode" → "pick a subagent_type that retains MCP access".
- Model slugs updated (`composer-2.5-fast` → `claude-sonnet-4-6`; `claude-opus-4-8-thinking-xhigh` → `claude-opus-4-8`).
- `create-skill` (3 routing rules) → `plugin-dev:skill-development`.
- Reference files: `.cursor/skills/`, `~/.cursor/skills/`, `~/.cursor/plugins/` → `.claude/...`, `~/.claude/...`.

### `skills/why/SKILL.md`

- MCP discovery: Cursor environment / `mcps/` directory → Claude Code tool list / `.mcp.json` / `claude mcp list`.
- `generalPurpose` → `"general-purpose"`; readonly/agent-mode language → "pick a subagent_type that retains MCP access".
- Model slugs updated.

### `skills/how/SKILL.md`

- `generalPurpose` → `"general-purpose"` (all 4 occurrences).
- `composer-2.5-fast` → `claude-sonnet-4-6` (replace_all).
- `claude-opus-4-8-thinking-xhigh` → `claude-opus-4-8` (replace_all for inline; table cell updated separately).
- Critic model table: GPT slugs → Claude family; added note about bridging to `/gsd-review` for cross-vendor critique.
- `readonly: true` lines dropped from subagent config blocks.

### `skills/interrogate/SKILL.md`

- `Task tool` → `Agent` tool.
- Reviewer model table: `claude-opus-4-8-thinking-xhigh` / `gpt-5.3-codex-high-fast` / `gpt-5.5-high-fast` / `composer-2.5-fast` → Claude family variants.
- `generalPurpose` → `"general-purpose"`; `readonly: true` dropped.
- Added cross-vendor-bridge note (`/gsd-review`).

### `skills/arena/SKILL.md`

- Default 3 runners: GPT/composer slugs → Claude family. Added cross-vendor-bridge note.

### `skills/architect/SKILL.md`

- Phase B runner slugs: GPT/composer → Claude family. Added cross-vendor-bridge note.

### `skills/show-me-your-work/SKILL.md`

- Transcript audit path: `agent-transcripts/` + `~/.cursor/projects/*/` → `~/.claude/projects/<encoded-cwd>/*.jsonl`.

## Deliberately not changed

- **`claude-opus-4-8` model ID.** Already a valid Claude model; no edit needed beyond stripping the Cursor `-thinking-xhigh` UI suffix. Extended thinking is configured separately, not as a model variant.
- **`/loop`, `/deslop`, `/babysit` slash references.** These all resolve in Claude Code now (`loop` is a built-in skill; `deslop` and `babysit` ship in this plugin).
- **`run_in_background: true`.** Claude Code's `Agent` tool supports this — kept as-is.
- **"currently open files, recent edits, the cursor location"** in `why/SKILL.md` (line 59). "Cursor location" here means editor cursor (caret position), not the IDE; generic phrasing, no edit.
- **`poteto-agent` subagent ID.** Plugin ships this agent; references stay.
- **Cursor's `/create-skill` writing style guidance referenced indirectly.** Pointed at `plugin-dev:skill-development` which covers the same ground in Claude Code. If you want stricter parity, also install Anthropic's `superpowers:writing-skills` skill.

## Forking note

This port now diverges from upstream pstack content. To track upstream:

```bash
# diff against the pinned commit
diff -ru /tmp/pstack-src/pstack/skills/ skills/  # caveats: ignores the babysit/ and deslop/ dirs
```

If you want a clean re-port (e.g. when upstream releases v0.2.0), the rebuild recipe is:

1. Copy upstream skills verbatim.
2. Re-apply the substitution table above (most of it is mechanical find/replace).
3. Re-add `skills/babysit/`, `commands/babysit.md`, and the cursor-team-kit `deslop` import.

## Provenance

- Upstream pstack: [cursor/plugins/pstack @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/pstack) — MIT, (c) 2026 Lauren Tan.
- Upstream deslop: [cursor/plugins/cursor-team-kit/skills/deslop @ e46364b](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills/deslop) — MIT, (c) 2026 Cursor.
- babysit: independently authored; workflow informed by Cursor's public `/babysit` behavior — no code or prose copied.
- Inspected for prior-art decisions: [v1truv1us/ai-eng-system](https://github.com/v1truv1us/ai-eng-system) (namespaces pstack under `pstack/` but keeps Cursor refs intact); [Evan-Kim2028/agent-fleet](https://github.com/Evan-Kim2028/agent-fleet) (vendors pstack under `base-kit/pstack/`, same posture).
