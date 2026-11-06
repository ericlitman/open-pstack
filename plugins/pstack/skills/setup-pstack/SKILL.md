---
name: setup-pstack
description: Configure pstack's provider-qualified models, per-family requested effort, and parent-owned routes per role. Verifies the assigned native and external lanes before writing the override sheet. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Configure one portable model sheet for the current parent harness. Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) and the [model catalog](../poteto-mode/references/model-catalog.md) before probing or writing anything. The dispatch rules, descriptor grammar, and the catalog's model matrix, kept predecessors, and route table are the contract. Choose one requested effort per assigned matrix family. Do not add a second configuration file, a runtime resolver, or a weaker-model fallback.

Resolve `<config-home>` once using the [harness config-home rule](../poteto-mode/references/codex-tools.md#harness-config-homes). Use it for all current-state reads, writes, snapshots, restoration, and readback.

Claude Code writes `<config-home>/pstack-models.md` and loads it from `<config-home>/CLAUDE.md` using the import rule in step 8. When `<config-home>` is the default home, render exactly the legacy line:

```text
@~/.claude/pstack-models.md
```

Only when `CLAUDE_CONFIG_DIR` redirects the home, render exactly `@./pstack-models.md`, relative to the importing file's directory.

Codex writes `<config-home>/pstack-models.md`. Codex has no `@` include, so mirror the sheet's exact bytes inside one bounded block in `<config-home>/AGENTS.md` and retain the sheet as the editable source of truth:

```text
<!-- pstack:models:begin -->
<exact contents of the resolved model sheet>
<!-- pstack:models:end -->
```

## Steps

### 1. Establish the parent

Use the harness and tool surface running this skill: Claude Code, Codex, T3 Code running one of them, or Grok. Environment markers may corroborate that top-level answer, but do not launch a child and ask it to detect where it came from. Record the parent because the same descriptor takes a different route in each harness. On T3, record the orchestration harness and the model runtime as [T3 host](../poteto-mode/references/provider-dispatch.md#t3-host) says. The runtime, Claude Code or Codex, selects `<config-home>`, the sheet, and the integration below. Grok is a parent for dispatch. This skill still writes the sheet only for Claude Code and Codex. On a Grok parent, probe in step 5, then stop before step 6 and do not write a config home.

### 2. Load current state

Inspect `<config-home>/pstack-models.md` and the existing integration: resolve Claude's single model-sheet import, or read Codex's single bounded model block, reporting missing targets and stopping on unreadable, malformed, or ambiguous state. Use the sole surviving configuration, or the editable sheet when both configurations agree; on Codex, the sheet remains authoritative and the block is its mirror, recoverable when the sheet is absent. If surviving configurations differ, show both sources and their differing assignments and require an explicit source choice before normalization or probing, without merging them automatically. Use first-run defaults only when neither source contains recoverable configuration, then apply the existing normalization, role-completion, and validation rules to the selected state. Before matrix validation, normalize only versioned predecessors of the catalog's [rolling aliases](../poteto-mode/references/model-catalog.md#kept-predecessors-and-normalization). Match in this order: an exact model-matrix row, then a kept predecessor, then a rolling-alias revision. A model that is its own matrix row, such as a registered exact pin, is never migratable. Any other provider-qualified Claude model is migratable when its model component starts with a rolling alias's versioned-predecessor prefix and the remaining revision contains only digits and hyphens. Replace that component in memory with the alias, preserving the provider, effort, role, and lane order. Record each original and normalized descriptor for the confirmation in step 7. This migration is valid loaded state and does not require a separate operator choice.

A line `<provider> writer sandbox: full-access` or `<provider> writer sandbox: bounded`, such as `codex writer sandbox: full-access`, is a setting, not a role; [Writer sandbox](../poteto-mode/references/provider-dispatch.md#writer-sandbox) says how a parent uses it. Set the setting lines aside before the role overlay, the retired-role rule, and descriptor validation, and carry them through steps 6 to 8, including the line of a provider that no role uses. A second line for one provider, a provider outside the [route table](../poteto-mode/references/model-catalog.md#routes), or another value is inconsistent state.

Treat the normalized values as current role-to-family assignments. Overlay those rows on the complete first-run role map, the catalog's [role defaults](../poteto-mode/references/model-catalog.md#role-defaults). Materialize any missing documented role row from that map on the next successful write. A duplicate role row is inconsistent state; report it and resolve it before probing. A row whose role is not in the role defaults, such as `how critics`, is from a retired role. Drop it and list it at confirmation. A bare host-native slug from an older sheet is also invalid because it does not say which provider owns it. A versioned Claude model that matches no matrix row, kept predecessor, or rolling alias remains inconsistent state. A value whose `(provider, model)` is a [kept predecessor](../poteto-mode/references/model-catalog.md#kept-predecessors-and-normalization) is not inconsistent state. On a rerun, propose replacing every occurrence with its family's current model at the same effort, and ask. If the operator declines, that family's model stays the kept predecessor for steps 3 to 7: probe it, render it, and write it unchanged. If the sheet is missing, seed from the role defaults, whose descriptors carry the model matrix's Default effort cells.

A qualifying rerun is a rerun whose sheet loaded, whose loaded state has a valid setting line for every provider that the setting question below covers, on which the operator names no change, and where no inconsistency or kept-predecessor proposal needs a choice. On a qualifying rerun, validate in step 3. If that passes without resolving an inconsistency, keep the role assignments and efforts and print them instead of asking the questions in steps 2 and 4. If every step 5 probe then passes, print the step 7 table and write without step 7's confirmation. The qualifying rerun skips no validation, permission check, snapshot, readback, or the step 9 smoke test.

Otherwise, ask whether to keep these role-to-family assignments or change named roles. Keeping them is the default. Apply only role changes the operator names; never offer a reset of a customized sheet to the first-run assignments. A changed role may use any model-matrix family, `inherit-parent`, or `auto`.

Ask once about a provider's setting line when the loaded state has none for it, and only for these providers: Codex, and each provider that a writer role (see step 3) uses through the external runner and whose Access modes cell lists `isolated-write-full-access` but not `isolated-write`. For Codex, ask whether its writer lanes that the external runner launches should run with Codex's full-access sandbox, and say that the line does not apply to writer lanes that T3 runs. Say that full access lets the writer launch a browser and write dot-folders such as `.agents/`, and that it removes every sandbox limit, including filesystem confinement to the worktree. For any other provider, ask whether it may write at all, and warn: "Nothing stops this provider from writing outside its worktree, including the main repository's shared Git state." Declining is the default. Record `<provider> writer sandbox: full-access` on a yes and `<provider> writer sandbox: bounded` on a decline, so a rerun does not ask again. When the line exists, keep it unless the operator names a change, and do not ask.

### 3. Parse per-family efforts

Read the catalog's model matrix and kept predecessors. Every non-alias role value must match `<provider>:<model>@<effort>`. Map it to exactly one matrix family by `(provider, model)`, matching a kept predecessor to its family, require its effort to appear in the Selectable efforts cell of that row or of the kept predecessor's row, and collect the effort. Reject `ultra` for every row whose Selectable efforts cell does not list it. `inherit-parent` and `auto` rows carry no family effort.

Lanes for these roles write files: `feature, refactoring`, `bug-fix`, `perf-issue`, and `hillclimb`, whose playbooks delegate with `isolated-write`; `hardest tasks`, which takes the hardest code changes; and `arena runners`, `architect runners`, `interrogate reviewers` and `swarm workers`, which write to their own worktrees or output directories. Refuse any of those roles on an external provider that cannot write: one whose Access modes cell in the [route table](../poteto-mode/references/model-catalog.md#routes) lists neither `isolated-write` nor `isolated-write-full-access`, or lists only `isolated-write-full-access` while its setting line from step 2 is missing or says `bounded`. Name the role and the provider, and say why. The runner refuses that provider's writer lane before launch, so the read-only probe in step 5 would pass and the role would fail at dispatch. Ask for another family or alias for that role, and do not probe or write until it changes. Every other role may use a read-only provider.

An unmatched provider/model, out-of-domain effort, or duplicate role is inconsistent state. Stop, show the conflicting rows verbatim, and ask for an explicit matrix family or alias replacement. If one or more families have mixed efforts, show every conflicting family and role row, then ask for one normalized effort per family from its Selectable efforts cell. Do not invent a precedence rule. Do not probe or write while any inconsistency is unresolved.

One distinct effort per family is the current value. A family with no non-alias occurrence is unassigned: do not ask for its effort, check its CLI, or probe it. A family that a step 2 role change newly assigns takes its matrix Default effort as the proposed value.

### 4. Collect one requested effort per family

Except on the qualifying rerun above, ask one effort question for each assigned family. Name each model, its current or proposed value, and the Selectable efforts from its matrix row. A family whose only selectable effort is `default` gets no effort question. Empty input keeps that value. On a first run, state the assigned families' matrix defaults before asking. On a rerun, state the parsed values without offering to reset customized role lanes.

### 5. Probe the requested pairs

Before any external CLI availability/authentication check or model probe, resolve the selected families through this parent's route table. On T3, read `orchestrator_capabilities` once, search for each assigned model the list omits, and give each family its route by the [T3 host](../poteto-mode/references/provider-dispatch.md#t3-host) order. A family on the T3 route needs no CLI access check. A family on the standalone route takes the checks below for the runtime's route table. On a Codex parent, name the assigned external families and inspect the parent's effective permission instructions for network access and the state paths and host prerequisites in each provider's [notes](../poteto-mode/references/model-catalog.md#provider-notes), including any required outside-workspace writes. Do not inspect credential contents or attempt a denied write to establish permission. `CODEX_SANDBOX_NETWORK_DISABLED=1` in the parent's own environment is evidence that external CLI network access is disabled; inspect it before child-environment scrubbing. `CODEX_SANDBOX` identifies a sandbox backend, not a complete permission policy. Missing markers, a config-file preference, or the name `workspace-write` alone do not prove sufficient access. Use the effective session permissions and required paths, not a blanket ban on every path outside the workspace.

If required access is blocked, explain the affected assigned families and the restriction before invoking their CLIs. If permission information is unavailable or incomplete, call it **unknown**, say which required access cannot be established, and resolve it before external checks or probes. Offer exactly two paths when access is blocked or remains unknown:

1. Restart the parent with suitable permissions, chosen deliberately by the operator; stop this setup without writing. See provider-dispatch's **Host and parent prerequisites**, including Grok's nested-sandbox limitation.
2. Explicitly choose native-only role assignments for this parent. Show each affected role and proposed replacement and obtain the operator's named changes, then return to steps 2–4 to validate the revised map and efforts before native probes. On Codex, families of the `codex` provider are native; `inherit-parent` and `auto` also stay native. Do not change any lane automatically, reduce its effort, or launch an external CLI for a now-unassigned family. State any reduction in provider diversity.

If all chosen families are native, no external CLI permission check or probe is needed; the separate final-write check still applies. When the effective permissions allow the selected external lanes, proceed with the existing routes and requested efforts unchanged. Never change sandbox settings or escalate permissions as part of setup.

Probe only the selected `provider:model@effort` pair of each assigned family. Run one probe per family in the role map, even when two families share a provider. Do not enumerate or offer older models as substitutes. A failed probe writes nothing: report the failing pair and provider, stop, and keep the active sheet plus parent integration bytes unchanged. A failed first run creates neither artifact.

If a Grok probe fails because the host cannot enforce its bounded sandbox, see [Host and parent prerequisites](../poteto-mode/references/provider-dispatch.md#host-and-parent-prerequisites); keep the active configuration unchanged.

Find the family's provider in the [route table](../poteto-mode/references/model-catalog.md#routes). A native-only route gets a native one-turn probe: on Claude Code, the family's `pstack-<family>-<effort>` agent; on Codex, `spawn_agent` with the descriptor's model and `reasoning_effort`. On Grok, `inherit-parent`, `auto`, and a Grok descriptor whose model and effort are already the parent's use `spawn_subagent`. An external route gets one `pstack-runner` call with a tiny read-only probe prompt and `--parent` set to the parent running this skill. On a Grok parent that call also covers every Grok descriptor `spawn_subagent` cannot carry. The runner's preflight checks the CLI, the login and the model, and its receipt is the result. A T3 route gets one `delegate_task` probe, and its T3 result record must meet T3 host's completion rules.

Use a tiny read-only probe that returns a unique marker. For each family that an external writer role uses on a provider whose writer needs a `full-access` setting line, also run one `isolated-write` probe in a disposable linked worktree, with `--writer-sandbox full-access`, that creates a small program and runs it; it passes only when the program's output file holds the expected marker. A login-status command alone proves credentials, not that the requested model and effort flags run. Record native, external, and T3 results separately. Never call the external launcher for a Claude or Codex parent's own provider. A Grok parent may call it for a Grok descriptor when `spawn_subagent` cannot carry the model or the effort.

Receipts and native transcripts prove the requested effort and the route. T3 result records prove only T3's launch configuration. They do not prove a provider's hidden applied reasoning depth. There is no implicit timeout, weaker-model fallback, or second mutable configuration source. A failed native lane is not retried through the runner.

### 6. Render, preserving role families

Build the new sheet in memory. Do not write it yet.

- First run: start from the catalog's role defaults, with the step 2 role changes applied.
- Rerun: start from the normalized complete role map from step 2, with the step 2 role changes applied, preserving each loaded row's lane order and family (or alias) per lane.

Keep the setting lines from step 2 where the loaded sheet had them. Put a line that step 2 adds after the last role row and any earlier setting line.

Rewrite every matrix-family descriptor to `provider:model@<requested effort for that family>`, using each family's model chosen in step 2. Leave `inherit-parent` and `auto` unchanged. An effort-only rerun cannot change a role's family. Changing Grok's effort updates every Grok occurrence and does not move a Sol role onto Grok. Refuse an unqualified slug, an unavailable route, a model outside the model matrix and its kept predecessors, or a provider/model mismatch.

### 7. Confirm and commit

Show any rolling-alias migrations as original and normalized descriptors and any retired-role rows dropped in step 2. Then show the source file read in step 2, the new destination `<config-home>/pstack-models.md`, the route table for this parent (on T3, each family's route from step 5), every rendered role and descriptor, and the setting lines. Carry the loaded assignments into the new destination; only explicit role or effort changes and the documented normalization may change them. Ask for confirmation before writing, unless the qualifying rerun's probes all passed.

Why and Reflect require the parent's live MCP surface. Keep their investigator, reviewer, and synthesizer roles on `inherit-parent` or `auto`; the bounded external runner deliberately omits ambient MCPs. `inherit-parent` and `auto` always validate, but say when they reduce a panel's provider diversity. For panel roles, one lane runs per entry. The list length is the fan-out count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only entries from a provider other than the parent's, in list order, so order it by preference. An `inherit-parent` or `auto` entry never judges. `swarm workers` is the default for every worker unless a race explicitly assigns another descriptor.

Every non-alias role value must match `<provider>:<model>@<effort>` and must have passed step 5.

After the operator confirms, or the qualifying rerun's probes all pass, separately check the parent's effective write permission for **both actual destinations** (the sheet and parent integration, resolved through `CODEX_HOME` when set) and any directory creation needed. Render both artifacts in memory and perform this check before the first write or directory creation. Native probes succeeding does not grant configuration-write permission. A restricted parent may still be allowed to write under `CODEX_HOME`; assess each resolved destination rather than rejecting it just because it is outside the workspace. If either destination is denied or its permission remains unknown, stop with the destination-specific explanation: leave every existing artifact byte-identical and create neither artifact on a first run. Do not test permission by overwriting a target, write only the allowed artifact, or automatically request escalation.

Only after both destinations are permitted, write the in-memory render from step 6 using step 8's snapshot and readback procedure. Never paste the role defaults as the result. They only seed step 2; selected efforts and explicit role changes always replace their values before writing.

### 8. Wire it in

Render the parent integration in memory before either write.

On Claude, the integration is the one `@` import line in `<config-home>/CLAUDE.md` whose target's basename is `pstack-models.md`, regardless of its existing directory or path spelling. When `<config-home>` is the default home, render exactly `@~/.claude/pstack-models.md`, preserving the legacy text. Only when `CLAUDE_CONFIG_DIR` redirects the home, render exactly `@./pstack-models.md`. This relative import resolves from the importing file's directory, where the sheet also lives, so the import line contains no config-directory characters. On a rerun, replace that one line in place, preserving all unrelated bytes. If zero matching import lines exist, append one. If more than one exists, stop and report inconsistent state before either write; do not append another import or guess which one to replace.

On Codex, the integration is the exact sheet bytes between one `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->` pair in `<config-home>/AGENTS.md`. Replace that whole bounded block on a rerun. Insert one block at the end on first run. If either marker is missing, duplicated, or reversed, stop and report inconsistent state instead of guessing a boundary.

Snapshot every target's current bytes. Write the sheet and parent integration only after every requested pair passes and the operator confirms or the rerun qualifies. Read both targets back and compare them with the in-memory render. If either write or readback fails, restore every snapshot and report the failure. An unchanged rerun must produce byte-identical sheet and integration content after normalization.

Do not copy the model sheet between harnesses without rerunning the parent-specific probes; route availability can differ even on the same host.

### 9. Behavioral smoke

Before declaring setup complete, run one small read-only mixed panel from this parent: every distinct chosen descriptor, distinct output/receipt paths, and an independent cross-judge. Launch Claude-native agents and every external process in the background with retained handles, then drain them. On T3, run each lane and the judge through the route step 5 gave its family. Verify the native transcript entries, every external receipt, and every T3 result record. A structural config check or unit test is not a substitute.

Report the sheet path, parent route table, requested-effort probe results, smoke results, and external elapsed/token/cost receipts. Re-running this skill re-probes and updates the same sheet. Do not claim the provider exposed hidden applied-effort observability.

### 10. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing. On the qualifying rerun, mention this offer in one line instead of asking, and do not invoke the skill.

### 11. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke `/create-formal-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing. On the qualifying rerun, mention this offer in one line instead of asking, and do not invoke the skill.
