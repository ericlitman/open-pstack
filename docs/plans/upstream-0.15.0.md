# Sync upstream pstack 0.15.0 into open-pstack

Plan prepared September 8, 2026 for [PSTACK-2](https://linear.app/mobilyze-llc/issue/PSTACK-2). Implementation has not started. Fable approved the revised plan with `Ship`.

The update should import the four pstack commits after the last recorded sync, remove upstream's retired How critic workflow, and keep the existing Claude Code and Codex adaptations. Use one shared skill tree and the existing routing boundaries. This is one update PR with three reviewable commits, not a new synchronization framework.

| Compared tree | Pinned revision | Version |
| --- | --- | --- |
| open-pstack main | `56bfd14418fa733e34d98f714f357d28788470e3` | 1.3.0 |
| Recorded Cursor sync | `efa2a531985e0a8084d36ff3cf87233be8a9f34b` | 0.14.7 |
| Target pstack tree | `71ed0d1076fec562c1b74ee353121a8d00f75382` | 0.15.0 |

The target is the latest commit that changes `pstack/`. Cursor's repository head at inspection was `2b8ae2ee306f823d54879d3da7f8496b73c31d5d`, which adds another plugin and does not change this target tree. The original local checkout was behind main, so it was not used as the port baseline. The merged 1.3.0 tree and tag exist even though GitHub's latest published release still reports 1.2.1. This plan compares source trees, not installed caches or release-page labels.

| Upstream commit | Change | Decision |
| --- | --- | --- |
| `7314f72` / [PR 309](https://github.com/cursor/plugins/pull/309) | Reduce logo to 361,140 bytes | Take the exact asset. Keep each distribution's manifest schema. |
| `e8d856f` / [PR 329](https://github.com/cursor/plugins/pull/329) | Skill density pass, retired How critics, two new principles | Port behavioral intent and deletions. Preserve existing platform substitutions. Apply two narrow correctness edits described below. |
| `d7cde2b` / [PR 331](https://github.com/cursor/plugins/pull/331) | Punctuation pass | Apply only upstream-changed prose. Do not run a repository-wide punctuation rewrite. |
| `71ed0d1` / [PR 333](https://github.com/cursor/plugins/pull/333) | 0.15.0 manifest and catalog corrections | Update provenance and actual port counts. Do not copy the Cursor manifest. |

The rerunnable audit reports 96 changed files, including 40 `SKILL.md` files. There are 92 modifications, two additions, and two deletions. Of those paths, 24 match the old upstream blobs, 64 already diverge in the port, two are new upstream files, and six need distribution-specific treatment. These are exact file comparisons, not claims that every divergent file conflicts. No upstream runtime script changes in this range.

Run from the repository root after fetching both remotes:

```sh
git fetch origin
git fetch cursor main
python3 scripts/upstream-audit.py \
  --port 56bfd14418fa733e34d98f714f357d28788470e3 \
  --upstream 71ed0d1076fec562c1b74ee353121a8d00f75382 > /tmp/pstack-0.15.0-audit.json
```

The dependency-free script reads committed Git objects. It maps upstream skills, agents, assets, and the verbatim README mirror; lists every changed blob and port-only file; and labels unmapped documentation/manifests for review. It performs no fetch, checkout mutation, patch application, or automatic approval. Repeated runs against these SHAs produced byte-identical output. All 96 reported paths matched an independent `git diff --name-only --no-renames` check, and four representative classifications were checked by hand.

## Changes to bring over

| Area | Implementation decision |
| --- | --- |
| `how` and callers | Adopt explain-only How. Remove critique mode, `references/critic-prompt.md`, and `references/critique-rubric.md`. Remove How-critique routing from Architect and Investigation. Architectural challenge remains available through Interrogate and Architect's own review. Do not add a compatibility alias. |
| Model configuration | Remove `how critics` from setup's generated sheet and from tests and active documentation that require it. The documented role map becomes 15 rows. Preserve the remaining role assignments, panel order, provider descriptors, and per-family effort controls. |
| Existing model sheets | Normal dispatch uses the invoked skill's requested role, so the leftover `how critics` row has no consumer and cannot launch a critic. The runner accepts assigned argv and does not read the sheet. Whole-sheet validation belongs to setup, where the retired row becomes unknown. Document removing that row before setup accepts the sheet, then use the normal validated setup flow. For Codex the editable sheet and bounded AGENTS block must agree. A failed probe or invalid sheet must leave both unchanged. No silent rewrite, runtime validator, or migration mechanism. |
| `why` and `teach` | Adopt the shorter instructions while preserving evidence gathering, source citations, contradictions, unknowns, and the distinction between code behavior and historical intent. Keep Why and Reflect's MCP-dependent work on the parent-native route. |
| `reflect` | Adopt explicit invocation only. Do not trigger a reflection pass automatically after a task, failure, or correction. |
| `poteto-mode` | Remove the mandatory first todo to read the entire principle index. Keep applied-leaf reads and truthful citations. Register both new principles. Preserve the Feature throughput checkpoint and all existing implementation/review gates. |
| `unslop`, `technical-writing`, PR playbooks | Adopt shorter prose, removal of the Adding soul advice, and the new mannered-prose and over-compression guidance. Keep upstream's stable rule numbering. Use concise PR briefs and short squash messages. Propose changes to an offender skill without editing it automatically. |
| PR evidence | Keep the required exact-candidate installed-behavior evidence in the PR template. Link detailed logs and measurements from the concise description. Do not treat upstream's shorter PR-body guidance as permission to omit the installed version, user action, observed result, or evidence required before readiness. |
| Other touched skills/playbooks | Import the upstream hunk intent, including retained cross-references. Review deletions for lost rules, not just prose size. The Autopilot chooser rule restored in upstream PR 329 must remain reachable from Multi-phase plan. |

The How deletion touches more than the skill directory. Inspect `plugins/pstack/skills/setup-pstack/SKILL.md`, `plugins/pstack/skills/poteto-mode/scripts/runner/model-matrix.test.ts`, `tests/skill-collision-repro.sh`, `docs/reference.md`, and the Architect/Investigation callers. Remove only the How-specific critic expectations. Preserve all remaining multi-model panel assertions.

At port `56bfd14`, the precise removal points are `setup-pstack/SKILL.md:99`, `runner/model-matrix.test.ts:29,44`, `tests/skill-collision-repro.sh:107-125`, `architect/SKILL.md:24`, `poteto-mode/SKILL.md:90`, `poteto-mode/playbooks/investigation.md:7`, and `docs/reference.md:171,196`. There is no dedicated How-critic agent to delete; the shared Fable/Opus agent definitions remain in use.

Clarify in the existing `provider-dispatch.md` that model rows configure roles a skill actually uses and cannot create a workflow. No special-case dispatch implementation is needed. The current runner contract is visible in `runner/cli.ts:59-108`, `runner/types.ts:11-22`, and `runner/run.ts:486-536`; none reads the model sheet. Selection belongs to the parent under `provider-dispatch.md:32,45-52`. Release notes must distinguish an unused row during ordinary dispatch from the setup-time unknown-role diagnostic.

Add `principle-attack-the-premise` and `principle-test-behavior-not-implementation` to the shared skills tree and catalogs. Use the port's existing `user-invocable: false` frontmatter convention so the principles stay model-readable. Do not copy upstream's `disable-model-invocation: true` onto them.

Two correctness adjustments need explicit provenance in `CHANGES.md`:

- The testing principle labels several assertions as passing when imported functions return `undefined`. A Bun probe confirmed that `toBeDefined`, `toBeTruthy`, `toBeInstanceOf`, and `toBeGreaterThan(0)` fail on `undefined`. Change the categorical list heading and examples into conditional warnings about tests that fail to observe the relevant behavior. Preserve useful negative-path tests and relational contract checks. Do not turn this sync into a test-suite rewrite or delete the port's prompt/configuration contract checks merely because they inspect text.
- The premise principle assumes repeated failures come from an imbalance among actors and says an even census rules out the premise. Scope the census and reassignment prescription to imbalance problems. An even census is evidence against that asymmetry hypothesis, not proof that any shared premise is correct. Keep the instruction to question a premise after repeated failed fixes.

These edits correct specific false generalizations. They do not establish a separate house style for the principles or justify rewriting unrelated upstream text.

Treat these two differences as temporary upstream corrections tracked in PSTACK-2. During implementation, search upstream issues/PRs for the exact claims, prepare one minimal correction proposal with both examples, and link its disposition from `CHANGES.md` and this ticket. Publication to upstream requires authorization to send that proposal; this planning task does not post to other maintainers. Preparing the proposal is part of this update, not an untracked follow-up. Do not wait for upstream acceptance to finish the port. At each subsequent sync, take upstream's equivalent correction and delete the local delta. If upstream rejects it, record that decision and reassess the smallest remaining difference instead of treating the patch as a permanent house-style fork.

## Port boundaries to preserve

- Keep one shared `plugins/pstack/skills/` tree. Tool translation stays in `poteto-mode/references/codex-tools.md`; model routing stays in `provider-dispatch.md`. Do not add another abstraction or per-harness skill fork.
- The parent resolves provider, model, effort, and access mode once. Children never detect or choose a route. Native versus external execution, receipts, cancellation, named dropouts, and no fallback or implicit timeout remain unchanged.
- Retain rolling Fable/Opus aliases, existing selectable efforts, and the Sol defaults for `bug-fix`, `perf-issue`, and `hillclimb`. Upstream model-slug prose must not override user configuration.
- Preserve Claude/Codex transcript discovery, MCP access, local worktree isolation, tool mapping, namespaced skill resolution, and installed-script paths. No Cursor login, event runtime, cloud VM, `control-ui`/`control-cli`, built-in babysitter, or Cursor filesystem path becomes a requirement.
- Preserve the forge-neutral shipping changes from [open-pstack PR 44](https://github.com/ericlitman/open-pstack/pull/44): independent verdicts, queue disarming, captured-SHA leases, expected-head protection, correct fork remotes, and bottom-first landing. Apply small prose edits to these adapted files instead of replacing them.
- Preserve the existing shipping assertions in `tests/skill-collision-repro.sh:212-323`. They already check disarming before verification/mutation, queue-entry removal, captured-SHA leases, independent verdicts, expected-head merges, fork remotes, and bottom-first landing. The unmodified baseline passed during this planning task. After importing prose, keep these checks passing. If wording changes require an assertion update, retain the same invariant and prove that removing the protected instruction still makes the check fail. Do not add another shipping-test framework or weaken checks to make a copy pass.
- Keep the existing exclusions in `UPSTREAM.md`: `make-bot-ui`, the invocation-blocking flags on `how`/`why`/`unslop`/`typescript-best-practices`, Cursor-only model-default hunks, and the unsupported Claude logo field. The older Benny automation pack remains excluded. The unrelated Grok Voice plugin is outside `pstack/`.
- Preserve the port-only skills, agents, runner, watcher, orchestrator, package/lockfile, and four distribution manifests except for deliberate release metadata and the How-role test edits. Do not import a command-wrapper layer.
- Upstream's stronger "Do not add guards" wording in Fix Root Causes applies to symptom-hiding workarounds. It does not override external-input validation required by Boundary Discipline or justify removing runner validation in this sync.

[GitHub issue 36](https://github.com/ericlitman/open-pstack/issues/36) still proposes importing `make-bot-ui`; later merged PR 44 and current `UPSTREAM.md` explicitly exclude it. This update follows the later merged decision and the user's request to omit Cursor-specific capabilities. It does not reopen or implement that issue. Other open setup/provider and How/Why enhancement issues remain separate work, not prerequisites or additions to this sync.

## Execution order

1. **Retire the removed workflow and add the two leaves.** Start from refreshed main, rerun the audit, and bind the work to this ticket. Port the semantic changes, remove dead How references and its role, register the new leaves, and add the two narrow correctness adjustments. Update only the affected role/catalog assertions. Run the affected static/model-map checks before continuing.
2. **Port the remaining upstream prose and asset.** Read upstream commits in order, apply the three-way comparison to adapted files, keep prior release safeguards, and replace the logo with the exact upstream bytes. Confirm no Cursor-dependent instruction was introduced. Do not mass-format scripts, rewrite tests, or change runtime provider behavior.
3. **Record the sync and verify the release candidate.** Set `UPSTREAM.md` to `71ed0d1` / 0.15.0, copy `README-UPSTREAM.md` verbatim, and update `NOTICE.md`, `CHANGES.md`, README, reference documentation, counts, and versioned manifests. The expected catalog is 54 shared skills and 23 principles. Verify the actual tree before writing counts. Keep Cursor's version independent of open-pstack's. Choose the next port release from the then-current tags and explicitly document the removed mode/role; do not promise an old configuration still works.

Commit the audit tool with the plan so the implementer can rerun it. The implementation can remain one PR because it adds no runtime architecture. Keep that PR draft until both affected applications pass the installed-candidate checks below. Merge only the reviewed candidate, then tag/release and read back the actual published state. This planning task does not perform that implementation or release.

## Acceptance and verification

- Every upstream delta path is accounted for as imported, adapted, deleted, or excluded with a reason. Recheck against current main at execution time and keep new upstream arrivals outside the pinned target unless deliberately re-reviewed.
- No active path invokes How critics or requires its role. Both obsolete reference files are gone. Setup renders 15 valid rows; the other role families and efforts remain unchanged. Test upgrading with the old 16-row sheet without rerunning setup: How launches no critics, and another retained role still dispatches as configured. Invoking setup on that same stale sheet yields an actionable diagnostic before probes or writes. A corrected sheet passes the usual probes and readback in both applications.
- Both new principles load through normal model invocation, follow the port's visibility convention, and use the corrected statements. A deliberately incorrect function makes its behavior test fail. A useful negative-path test remains valid. A repeated failure shared evenly by all actors does not incorrectly terminate premise investigation.
- From the exact installed candidate in fresh Claude Code and Codex sessions, run How on simple and complex fixtures. Obtain grounded explanations using the configured explorer/explainer routes, with no critic fan-out. Check Why's source-backed response and named gaps on a fixed fixture, and Teach's concise combination of How/Why results. Inspect transcripts and actual outputs, not just self-reported success.
- Confirm Reflect does not start after an ordinary completed task, and does run when explicitly invoked. Check a PR-writing fixture gives a short review brief with required installed-candidate evidence and linked details. Check the retained Autopilot chooser resolves.
- Demonstrate named `how`, `why`, `unslop`, and `typescript-best-practices` invocation still works. Confirm `make-bot-ui` remains absent. Verify both new principles are discoverable to the model and the port-only skills remain packaged.
- Before merge, compare every installed plugin file to the exact candidate and record candidate identity, application/version, invoked action, and observed result. Existing runtime tests and focused native/external routing canaries must still demonstrate no silent provider substitution or implicit deadline. Full setup across both applications already exercises the selected routes.
- Run the repository gates from `.github/workflows/ci.yml`: `bun install --frozen-lockfile`, `bun run test`, and `bun run typecheck` in `plugins/pstack/skills/poteto-mode/scripts`; parse all four JSON manifests; run `PSTACK_STATIC_ONLY=1 bash tests/skill-collision-repro.sh`; run Claude plugin validation; and run `git diff --check`. Do not run Claude's marketplace validator on the Codex manifest.
- Compare `README-UPSTREAM.md` and the logo bytes against the pinned upstream objects. Require the asset to be below 512 KiB. Check all live links and catalog counts affected by the deletion/additions.
- Treat upstream's reported token reduction/evals as upstream evidence only. Record port text-size changes and run focused behavioral fixtures in both applications; do not claim upstream's token or latency numbers for this port. No new benchmark system is needed.

## Sources and review record

- [Recorded 0.14.7 sync contract](https://github.com/ericlitman/open-pstack/blob/56bfd14418fa733e34d98f714f357d28788470e3/UPSTREAM.md)
- [Prior sync and its installed-candidate evidence](https://github.com/ericlitman/open-pstack/pull/44)
- [Exact upstream comparison](https://github.com/cursor/plugins/compare/efa2a531985e0a8084d36ff3cf87233be8a9f34b...71ed0d1076fec562c1b74ee353121a8d00f75382)
- [Upstream testing principle](https://github.com/cursor/plugins/blob/71ed0d1076fec562c1b74ee353121a8d00f75382/pstack/skills/principle-test-behavior-not-implementation/SKILL.md)
- [Upstream premise principle](https://github.com/cursor/plugins/blob/71ed0d1076fec562c1b74ee353121a8d00f75382/pstack/skills/principle-attack-the-premise/SKILL.md)
- Comparison tool: `scripts/upstream-audit.py`. Evidence was generated at `/Users/ericlitman/projects/pstack/evidence/upstream-0.15.0/`.
- The current task explicitly requests Linear tracking, superseding this repository's standing GitHub-only instruction for this update. There is no second implementation ticket.
- Fable first returned `Fix`. The revised plan ties the two correctness edits to an upstream proposal, distinguishes ordinary dispatch from setup validation, and identifies the shipping assertions that already exist and pass.
- Fable's final verdict is `Ship`. The reviewed approach removes obsolete behavior without a migration or shim, retains existing safeguards, and uses a small read-only audit instead of a sync engine.
- Remaining review risk: a rule in one of the 64 adapted files could disappear during the prose import without a focused fixture covering it. The per-file adaptation review and installed-candidate checks above remain required; path accounting alone does not prove semantic preservation.
