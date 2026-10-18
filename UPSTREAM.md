# Upstream synchronization

open-pstack tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack) while adapting Cursor-specific primitives for Claude Code and Codex.

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `99743e9c151c8537cbbf1f98bb38f34ef3368453` |
| Upstream version | `0.15.25` |
| open-pstack version | `1.15.0` |

The table above is the current Cursor sync point. Open Pstack 1.10.0 imported this 0.15.25 sync, and 1.11.0 through 1.15.0 keep it. `README-UPSTREAM.md` preserves the upstream pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance.

## Upstream-only exclusions

- Local adaptation #228 changes only bug-fix step 5, refactoring step 1, `principle-sequence-verifiable-units/SKILL.md`, and the session-start direct-entry list: use real-surface repro or the flow's existing deterministic E2E instead of failing-test-first, add a regression test or the smallest behavior pin only where it guards a real risk no E2E covers, and keep the type-checked build as a build step. Preserve this divergence on sync; other test guidance remains upstream wording.

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` from `23a56e2`, `889ec4b`, and `70b2dc8` are not applied. Those frequent code-writing roles stay on `codex:gpt-6.1-sol@max`.
- `5bf2b15`'s setup budget question, its `# budget` line, and its step down to a lower detected effort are not applied. Setup already asks one requested effort per assigned family, and the step-down would silently lower a requested effort.
- `12d587d`'s rule that reruns a rejected configured entry on its family default or the closest valid slug is not applied, and neither is `ce649c0`'s rule that puts `cursor-grok-*` and `composer-*` entries in the Grok family for that fallback. An unavailable model stays a named dropout per `provider-dispatch.md`.
- The expected-runtime column in `70b2dc8`'s `children.tsv` and its expected-runtime stuck test are not applied, and neither are `ce649c0`'s stuck-after runtime and its rule that an owner with no push or trail row by the first tick is stuck. A lane is stuck only on affirmative failure evidence. An owner with no push or trail row at a tick is drift for that owner to record.
- The explicit Grok, Opus, and Sol defaults for the Why and Reflect roles are not applied. Those roles stay on `inherit-parent` because the external runner omits the parent's MCP servers.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.
- Commit `df58112` (pstack 0.15.15) is not applied. It drops Sol from every default, cuts the panels to Opus and Grok, and moves Opus from `max` to `xhigh`. Open Pstack keeps its own model defaults and three-model panels.
- The `disable-model-invocation: true` lines that `23e4138` puts on `benchmark-checklist` and `principle-explain-the-number` are not applied. The same flag, which upstream carried on principle leaves and `figure-it-out` before 0.15.5, stays off as in earlier syncs. Principle leaves keep `user-invocable: false`, and `figure-it-out` and `benchmark-checklist` stay model-invocable because poteto-mode routes to them by name. The typed-only `correct`, `ketchup`, `poteto-help`, `in-your-own-words`, and `sharpen` keep the flag.
- The Built-in PR tool paragraph from `23e4138` and `00b14f1` is not applied. It describes a Cursor run tool that Claude Code and Codex do not have.
- The 40-line squash-body cutoff returns in `00b14f1` and stays omitted, as in the 0.15.0 sync.
- Autopilot-full step 5's trunk-move rule from `23e4138`, and its revision in `ce649c0`, are not applied. The `23e4138` rule merged without another rebase when `git merge-tree` was clean and trunk touched none of the PR's paths or CI paths, and both checks pass when trunk removes an export that the PR's new code imports. `ce649c0` replaces those checks with the owner's judgment: merge when trunk's changes cannot affect the patch, and run the patch's checks on the merge result when trunk changed a caller or a dependency. An owner who misses a dependency still merges an untested tree. Step 5 keeps the rebase at merge prep and sends a trunk move before the merge through the patch ID rule in `playbooks/shipping.md`. `ce649c0`'s lockfile exception and its hold before a third rebase go with the rule.
- `poteto-agent.md` does not take `is_background: true` from `2bd5dd4`. Claude Code documents `background`, not `is_background`, in agent frontmatter, and Codex defines agents in TOML and maps concurrency at dispatch. The port keeps `general-purpose` in the description and the `skills: [pstack:poteto-mode]` preload.
- The root Agent Plugins v1 `pstack/plugin.json` from `e5a02f8` and its version bumps through 0.15.25 are not applied. The port keeps its current Claude manifest at `plugins/pstack/.claude-plugin/plugin.json` and Codex manifest at `plugins/pstack/.codex-plugin/plugin.json`. Agent Plugins v1 is revisited with #13.
- `unslop` takes `bc697d0`'s description without its `disable-model-invocation: true` line, as for `73f8be4` above.
- `pstack/.cursor-plugin/plugin.json` and `pstack/docs/guide/` are not imported. The Cursor manifest has no Claude Code or Codex consumer, and the guide shows Cursor's interface; `poteto-help` links to the guide upstream. That covers the 0.15.21 to 0.15.25 version bumps and `e5136d8`'s guide edit.
- `poteto-agent.md` does not take `b93e811`'s search of `~/.cursor/plugins/` for poteto-mode, its highest-version rule, or its note that the skill catalog hides poteto-mode. The Claude agent preloads `pstack:poteto-mode`, the port's poteto-mode is not hidden, and Codex has no `poteto-agent` type. The agent keeps upstream's "Use the absolute path your parent gave you."

## Local port-patch ledger

- **#140 — Reflect transcript resolution**: Cursor's Reflect step 1 reads the `agent-transcripts/` directory its system prompt names; the port had substituted Claude Code's per-project directory, which left Codex without a lookup. The port replaces that step's body with one line that points to `plugins/pstack/skills/poteto-mode/references/codex-tools.md#active-transcripts`, and leaves the rest of `reflect/SKILL.md` unchanged. That mapping section holds the harness specifics: the Claude per-project scope, layouts, candidate and scan limits, opening-message verification, the Codex resolver call, and the 2,000-word digest fallback. The port-authored Bun resolver `plugins/pstack/skills/poteto-mode/scripts/resolve-codex-transcript.ts`, started through the `sh` launcher `resolve-codex-transcript` next to it so project Bun config and `.env` files cannot affect it, looks up the parent's known chat ID in Codex's read-only `threads` index, checks rollout scope and ownership, and prints opening-message metadata without transcript text. Preserve this divergence during upstream syncs: keep step 1 as the one-line pointer and keep the mapping section and resolver.
- **#120 — harness config homes** (tracked for #105): Cursor's setup destination is `~/.cursor/rules/`. The shared port resolves nonempty `CLAUDE_CONFIG_DIR` / `CODEX_HOME`, otherwise `$HOME/.claude` / `$HOME/.codex`, once at `plugins/pstack/skills/poteto-mode/references/codex-tools.md#harness-config-homes`. `setup-pstack/SKILL.md` reuses that home for reads, sheet/integration writes, snapshots, restoration, and readback; Claude preserves the literal legacy import at the default home and renders exactly `@./pstack-models.md` for redirected homes, keeping spaces and `#` in the config-directory name out of the import line; reruns replace the one import whose target basename is `pstack-models.md`, append if absent, and stop if duplicated. Preserve this intentional divergence during upstream syncs. The named config-home invariant in `tests/skill-collision-repro.sh` rejects literal default destinations outside the legacy import, requires the literal default-home rendering and zero/one/many import rules, and verifies unset/empty/space-containing resolution without daily writes. See `CHANGES.md` for the port correction and `tests/setup-config-home-repro.sh` for redirected live-evidence preparation. The Cursor sync point is unchanged.

- **#157 — role pointers**: Cursor names model descriptors in the Arena, Architect, How, Interrogate, and Swarm skills, the bug-fix, feature, hillclimb, perf-issue, and refactoring playbooks, poteto-mode's delegation defaults, and setup's probe table and first-run sheet. The port replaces each with a role pointer: the role's backticked sheet label and a link to `plugins/pstack/skills/poteto-mode/references/model-catalog.md#role-defaults`, which `registry/render.ts` generates from `plugins/pstack/skills/poteto-mode/scripts/runner/registry/models.ts`. Interrogate's reviewer table and setup's probe table and example sheet are deleted. When an upstream sync changes a model slug on one of these lines, keep the port's line and put the model change in `registry/models.ts`. `runner/registry.test.ts` enforces the rule: `ROLE_POINTERS` names each file's roles, and its text scan rejects any descriptor or versioned model name in `plugins/pstack/**/*.md`, `README.md`, and `docs/reference.md` outside the generated catalog and agents.

- **#191 — landing playbooks and per-spawn effort**: `ce649c0` cuts Shipping to six steps and both autopilots to principles. The port takes the cut's rules and reasons but keeps the landing procedure from 1.3.0: Shipping keeps steps 1 to 9, Autopilot-full step 2 holds the guarded rebase and push, and Autopilot-stack step 2 holds the fork and topology rules. Those steps disarm auto-merge and merge-queue entries before verification and before any rewrite, keep the verdict head and base apart from the landing head and base, resolve the base fetch remote apart from the head push URL, bind each push to a captured SHA, and merge only through a server-enforced expected head. The named landing invariants in `tests/skill-collision-repro.sh` check those rules by step and phrase, so a sync that moves them updates the invariants in the same change. `ce649c0`'s Match the model to the job rule is taken with port adaptations: the starting level is the role's configured effort, an unlisted effort moves to the nearest effort the catalog row lists, a configured `ultra` stays, and the fast and standard speed sentences are dropped because the port's descriptors carry no speed selector.

## Check for changes

The repository already names Cursor's repository as the `cursor` remote in the maintainer checkout. A fresh clone can add it once:

```shell
git remote add cursor https://github.com/cursor/plugins.git
```

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch cursor main
git log --oneline 99743e9c151c8537cbbf1f98bb38f34ef3368453..cursor/main -- pstack
git diff --stat 99743e9c151c8537cbbf1f98bb38f34ef3368453..cursor/main -- pstack
```

No output means the tracked pstack tree has not changed. This comparison does not need a polling service or generated mirror branch.

## Incorporate a change

1. Create or update a GitHub issue in `ericlitman/open-pstack` and branch from current `main`.
2. Read each upstream pstack commit in order. Bring over its intent and content, then apply only the Claude Code and Codex substitutions documented in `CHANGES.md`.
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and provider routing in `provider-dispatch.md`; do not fork a skill per harness.
4. Update the commit and version in this file, the affected provenance rows in `NOTICE.md`, and `README-UPSTREAM.md` when upstream changes it.
5. Run CI-equivalent checks locally, then run the installed Claude Code and Codex behavioral lanes required by the changed surface. Unit tests alone are not a release gate.
6. Merge the reviewed PR before tagging the next open-pstack release. Publish the release with `python3 scripts/release.py publish` from a clean checkout of `main`.

Cursor's version and open-pstack's version are independent. Cursor's version identifies the imported content; open-pstack's version identifies the cross-harness distribution.
