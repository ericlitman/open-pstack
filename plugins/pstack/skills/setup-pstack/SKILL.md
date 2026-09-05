---
name: setup-pstack
description: Configure pstack's provider-qualified models, per-family requested effort, and parent-owned routes per role. Verifies native and external Claude, Codex, and Grok lanes before writing the override sheet. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Configure one portable model sheet for the current parent harness. Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before probing or writing anything. Its model matrix, descriptor grammar, and route table are the contract. Choose one requested effort per active matrix family. Do not add a second configuration file, a runtime resolver, or a weaker-model fallback.

Claude Code writes `~/.claude/pstack-models.md` and loads it from `~/.claude/CLAUDE.md` with:

```text
@~/.claude/pstack-models.md
```

Codex writes `~/.codex/pstack-models.md`. Codex has no `@` include, so mirror the sheet's exact bytes inside one bounded block in `~/.codex/AGENTS.md` and retain the sheet as the editable source of truth:

```text
<!-- pstack:models:begin -->
<exact contents of ~/.codex/pstack-models.md>
<!-- pstack:models:end -->
```

## Steps

### 1. Establish the parent

Use the harness and tool surface running this skill: Claude Code or Codex. Environment markers may corroborate that top-level answer, but do not launch a child and ask it to detect where it came from. Record the parent because the same descriptor takes a different route in each harness.

### 2. Load current state

Read the current parent-specific sheet when it exists. Before matrix validation, normalize only versioned predecessors of the supported rolling aliases. A provider-qualified Claude model is migratable when its model component starts with `claude-fable-`, `claude-opus-`, or `claude-sonnet-` and the remaining revision contains only digits and hyphens. Replace that component in memory with `fable`, `opus`, or `sonnet`, preserving the provider, effort, role, and lane order. Record each original and normalized descriptor for the confirmation in step 8. This migration is valid loaded state and does not require a separate operator choice.

Treat the normalized loaded values as current role-to-family assignments. Keep any documented role missing from the sheet as a pending row seeded from the complete first-run role map. A pending row is not current state and does not activate its seeded families. Materialize it only in the next successful write after step 4 assigns every lane to a target family or alias. A duplicate or unknown role row is inconsistent state; report it and resolve it before probing. A bare host-native slug from an older sheet is also invalid because it does not say which provider owns it. A versioned Claude model outside the three migration families remains inconsistent state. If the sheet is missing, use the complete first-run role map. Its non-alias descriptors already equal the matrix rows marked First-run active `yes` at their Default effort.

### 3. Parse the role map and active families

Read the model matrix. Every non-alias value must match `<provider>:<model>@<effort>`. Map it to exactly one matrix family by `(provider, model)`, require its effort to appear in that row's Selectable efforts cell, and collect the effort. `inherit-parent` and `auto` rows carry no family effort.

An unmatched provider/model, out-of-domain effort, duplicate role, or unknown role is inconsistent state. Stop, show the conflicting rows verbatim, and ask for an explicit matrix family or alias replacement. Do not invent a precedence rule. Do not probe or write while any inconsistency is unresolved.

Derive the current active family set from the normalized loaded rows: it is exactly the matrix families with at least one non-alias descriptor. Pending rows do not contribute to this set. Do not read or write a separate active-family value. Record all efforts used by each current active family. A supported family with no loaded non-alias occurrence is inactive.

### 4. Choose the target active set and role assignments

Show the supported matrix families and mark the current active set. On a first run, that set is Fable, Sol, Grok, and Opus because those rows have First-run active `yes`; keep it unchanged by default. On a rerun, keep the derived current set by default. Ask whether to add or remove named supported families. Require at least one target active family. Refuse an alias-only role map because setup could not probe a model family or choose a behavioral-smoke descriptor from it.

Build the final role map in memory before probing. Start from the normalized complete role map from step 2, preserving every loaded row's lane order and family or alias per lane. Present each pending row and its seeded assignments. If a seeded descriptor names a family outside the target set, require the operator to replace that lane with a target family, `inherit-parent`, or `auto`. Ask whether to keep the other assignments or change named roles. Keeping them is the default. Apply only role changes the operator names; never offer a reset of a customized sheet to the first-run assignments.

A removed family must have every occurrence replaced with another target family, `inherit-parent`, or `auto`. An added family must appear in at least one role. Other named role changes may use a target family, `inherit-parent`, or `auto`. Refuse an unqualified slug, a model outside the matrix, a provider/model mismatch, or any role map whose derived family set differs from the chosen target set.

### 5. Collect one requested effort per active family

Visit the target active families in matrix order and collect one requested effort for each. For a family that currently uses one effort, show it as current. For a newly active family, show its Default effort as proposed. Empty input keeps the current value or accepts that proposal.

If a target family has mixed current efforts, show every conflicting role row and ask for one normalized effort from its Selectable efforts cell. Do not ask for an effort from a removed or inactive family. On a first run with the unchanged target set, state the four matrix defaults before asking.

### 6. Probe the target active set

Probe only the target active `provider:model@effort` pairs. Run one probe per active family, even when families share a provider. Do not probe inactive families. Do not enumerate or offer older models as substitutes. A failed probe writes nothing: report the failing pair and provider, stop, and keep the active sheet plus parent integration bytes unchanged. A failed first run creates neither artifact.

| Provider | Claude parent route | Codex parent route | Availability proof |
|---|---|---|---|
| Claude | native Agent `pstack-<stem>-<effort>` | Claude CLI | native one-turn probe or `claude auth status --json` plus one-turn probe |
| Codex | `codex exec` | native `spawn_agent` | `codex login status` plus one-turn probe or native one-turn probe |
| Grok | Grok CLI | Grok CLI | `grok models` must list the requested model; one-turn probe |

Use a tiny read-only probe that returns a unique marker. A login-status command alone proves credentials, not that the requested model and effort flags run. Record native and external results separately. Never call the external launcher for the parent's own provider. On a Claude parent, active Claude-family probes are one-turn runs of their mapped `pstack-<stem>-<effort>` agents. On a Codex parent, active Codex-family probes are native `spawn_agent` calls with the selected model and `reasoning_effort`. Every other active pair uses the external runner with the selected effort flag.

Receipts and native transcripts prove the requested effort and the route. They do not prove a provider's hidden applied reasoning depth. There is no implicit timeout, weaker-model fallback, same-provider external fallback, or second mutable configuration source.

### 7. Render the final role map

Build the new sheet in memory. Do not write it yet.

Use the final role assignments from step 4. Rewrite every target-family descriptor to `provider:model@<requested effort for that family>`. Leave `inherit-parent` and `auto` unchanged. An effort-only rerun cannot change a role's family. Changing Grok's effort updates every Grok occurrence and does not move a Sol role onto Grok.

Derive the rendered active family set again and require it to equal both the chosen target set and the set of probed families. This equality is the persistence rule: the sheet stores active membership and effort only through role descriptors.

### 8. Confirm and commit

Show any rolling-alias migrations as original and normalized descriptors. Then show the route table for this parent and every rendered role and descriptor. Ask for confirmation before writing.

Why and Reflect require the parent's live MCP surface. Keep their investigator, reviewer, and synthesizer roles on `inherit-parent` or `auto`; the bounded external runner deliberately omits ambient MCPs. `inherit-parent` and `auto` always validate, but say when they reduce a panel's provider diversity. For panel roles, one lane runs per entry. The list length is the fan-out count. `arena cross-judge pool` is a list from which Arena chooses a provider different from the parent and base candidate when possible. `swarm workers` is the default for every worker unless a race explicitly assigns another descriptor.

Every non-alias value must match `<provider>:<model>@<effort>` and its family must have passed step 6.

After the operator confirms, write the in-memory render from step 7. Never paste the example below as the result. It is only the complete first-run role map used to seed step 2; selected efforts and explicit role changes always replace its example values before writing.

```markdown
# pstack model configuration

Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. Every documented role remains present. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.

feature, refactoring: grok:grok-4.6@xhigh
bug-fix: codex:gpt-5.6-sol@max
perf-issue: codex:gpt-5.6-sol@max
hillclimb: codex:gpt-5.6-sol@max
judgment and prose: claude:fable@max
hardest tasks: claude:fable@max
how explorer: grok:grok-4.6@xhigh
how explainer: claude:fable@max
how critics: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
arena cross-judge pool: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
swarm workers: grok:grok-4.6@xhigh
architect runners: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
interrogate reviewers: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
```

### 9. Wire it in

Render the parent integration in memory before either write. On Claude, the integration is the single `@~/.claude/pstack-models.md` include in `~/.claude/CLAUDE.md`. On Codex, it is the exact sheet bytes between one `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->` pair in `~/.codex/AGENTS.md`. Replace that whole bounded block on a rerun. Insert one block at the end on first run. If either marker is missing, duplicated, or reversed, stop and report inconsistent state instead of guessing a boundary.

Snapshot every target's current bytes. Write the sheet and parent integration only after every target-active probe passes and the operator confirms. Read both targets back and compare them with the in-memory render. If either write or readback fails, restore every snapshot and report the failure. An unchanged rerun must produce byte-identical sheet and integration content after normalization.

Do not copy the model sheet between harnesses without rerunning the parent-specific probes; route availability can differ even on the same host.

### 10. Behavioral smoke

Before declaring setup complete, run one small read-only mixed panel from this parent: one chosen descriptor for every target active family, distinct output/receipt paths, and an independent cross-judge chosen from that same set. Do not smoke an inactive family. Launch native agents and every external process in the background with retained handles, then drain them. Verify the native transcript entries and every external receipt. A structural config check or unit test is not a substitute.

Report the sheet path, parent route table, requested-effort probe results, smoke results, and external elapsed/token/cost receipts. Re-running this skill re-probes and updates the same sheet. Do not claim the provider exposed hidden applied-effort observability.
