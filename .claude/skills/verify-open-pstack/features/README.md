# Maintained feature map

The ownership table below says which features a changed path reaches. `SKILL.md` says how to pick the named features from that reach and how `verify.sh run` checks them.

`registry.json` is the machine-readable ownership map. Classification turns the changed paths into the reachable `<harness>:<feature>` set; an empty set is `no runtime change`. `core.ts` supports exact paths and terminal `/**` only. Unknown paths fail closed; rename classification includes both paths. Runtime markdown, references, playbooks, hooks, manifests, and scripts are runtime even when their extension looks documentary.

| Ownership | Surfaces a change can affect |
| --- | --- |
| `skills` | One `skill-invocation:<name>` exercise per selected skill, in both harnesses |
| `shared` | All listed skills, setup, runner, shipped tools, and `hook:startup` in both harnesses, and Claude's `agent-preload:poteto-agent`; a version-only manifest change reaches less, as described below |
| `catalog` | The generated model catalog and native agents, and the registry sources: `catalog`, `setup`, and `runner`, and no skill check; a provider adapter under `runner/providers/` also reaches `writers:<provider>`, or `writers` when no writer case names that provider |
| `assets` | Installed UI/resource surface for each actual consumer found in the pinned plugin manifests |
| `setup` | Installed setup/model configuration with byte-exact daily Claude file restoration before publication |
| `runner` | Installed parent invoking real configured provider lanes |
| `tools` | Installed parent invoking the changed shipped CLI |
| `project` | Native discovery/invocation of this verifier in both harnesses |
| `nonRuntime` | Explicit ordinary repository documentation, policy, non-shipped assets, and unit-test paths; no plugin harness launch |

A change to `features/recipes.ts` can name any feature that has a recipe.

A change to `plugins/pstack/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, or `plugins/pstack/.codex-plugin/plugin.json` is version-only when the merge base and the head hold the same regular file with the same mode, both sides parse as JSON objects, at least one version string changed (top-level `version`, or `plugins[].version` in the marketplace), and nothing else differs. A version-only change reaches only `hook:startup`: the two Claude files in Claude, the Codex manifest in Codex. `.agents/plugins/marketplace.json` has no version and always takes the shared expansion.

Asset ownership is consumer-driven, not blanket shared ownership. Inspect the exact candidate's plugin manifests. At present, `plugins/pstack/assets/logo.png` is referenced only by `plugins/pstack/.codex-plugin/plugin.json`, so a logo-only change selects the installed Codex asset surface and does not invent a Claude exercise. New shipped assets must be added to `assets` and must have a real manifest consumer; missing, ambiguous, or unknown consumption fails closed.

`bootstrap.ts` belongs to `tools`; exercise its actual consumer, `watch-pr`, including dependency bootstrapping rather than the unrelated external runner.

Catalog paths take precedence over `shared` and over the skill match, so `references/model-catalog.md` and the generated agents select only `catalog`, `setup`, and `runner`. Each generated agent is listed by exact path; a new one is unmapped until it is added to `catalog`. Skill-owned `SKILL.md`, `references/**`, and `playbooks/**` select their skill. poteto-mode's `SKILL.md` also reaches Claude's `agent-preload:poteto-agent`, because poteto-agent preloads it. Additional executable paths must be registered explicitly. `core.ts` assigns the Codex transcript resolver, `poteto-mode/scripts/resolve-codex-transcript.ts`, and its launcher, `poteto-mode/scripts/resolve-codex-transcript`, to `reflect` by their exact paths, so a change to it selects `skill-invocation:reflect` rather than the unrelated shipped-tool recipe. Shared consumed mappings select every dependent skill conservatively. The coverage test inventories tracked plugin files; new unmapped files block CI and runs. Deleted skill surfaces cannot silently disappear from evidence: choose a surviving documented entry point demonstrating the intended removal, or report blocked.

The feature documents below define sub-features, user entry points, driving instructions, and gotchas. Review each changed sub-feature in the diff. Record all changed sub-feature actions in the feature's transcript and artifact. Do not run destructive application work in the maintainer checkout.

- `skill-invocation.md`: installed native skills, principle leaves, and project-skill self-test.
- `setup.md`: setup/routing/model configuration and byte-exact restoration.
- `isolation.md`: existing native logins, Codex auth symlink, and private run state.
- `runner.md`: parent-to-child provider dispatch and receipts.
- `catalog.md`: the generated model catalog and native agents, read by a parent resolving roles from a model sheet.
- `shipped-tools.md`: watch, plan checks, audit, statechart, and evidence logging.
- `assets.md`: manifest-declared installed assets on actual consuming harnesses.
- `t3.md`: a T3 Code parent dispatching a role through `delegate_task` (`t3:dispatch`), on a run-owned disposable T3 server.
- `hooks.md`: the SessionStart hook's context reaching a new session (`hook:startup`), and the Windows runner beside it.
- `recipes.ts`: the headless cases and machine-checked assertions for every selectable feature. A named feature without one fails the run as `missing-recipe` before any session starts. A recipe proves a lookup or a read with a fixture value the model cannot derive from the prompt, such as a per-run `crypto.randomUUID()` marker, compared in the structured result. A command's text can show which tool the parent called, but it never proves what that tool read or produced, so do not add command-text or tool-output pattern checks for that.
- `agent-preload:poteto-agent` (Claude only): the parent dispatches `pstack:poteto-agent` through the Agent tool and asks it for the first Core principle of the preloaded poteto-mode skill without invoking `Skill` or reading files. The check needs that Agent call, `Laziness Protocol` in the reply the parent writes to `result.md`, and no `Skill` call or `Read` of poteto-mode's `SKILL.md` among the child's own tool calls.

Consumed `AGENTS.md`/`CLAUDE.md` instructions, `tests/skill-collision-repro.sh`, `.github/workflows/ci.yml` and the root `package.json`, whose scripts CI runs, select `project-skill`. `.mergify.yml` is explicitly `nonRuntime`. There are no blanket no-runtime exemptions for `.github/**`, `tests/**`, or `scripts/**`: unregistered instruction/enforcement paths fail closed until their ownership is reviewed and mapped.

Explicit non-runtime repository changes are `no runtime change`. Plugin-runtime proof and local CLI proof remain separate.
