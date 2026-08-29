---
name: setup-pstack
description: Configure pstack's provider-qualified models, per-family requested effort, Architect Sol exception, and parent-owned routes per role. Verifies native and external Claude, Codex, and Grok lanes before writing the override sheet. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Configure one portable model sheet for the current parent harness. Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before probing or writing anything. Its model matrix, descriptor grammar, and route table are the contract. Choose one requested effort per matrix family. Keep every Sol lane in `architect runners` at `xhigh`; the requested Sol family effort applies to every other Sol lane. Do not add a second configuration file, a runtime resolver, or a weaker-model fallback.

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

Read the current parent-specific sheet when it exists. Treat its values as current role-to-family assignments. Overlay its rows on the complete first-run role map in step 7. Materialize any missing documented role row from that map on the next successful write. A duplicate or unknown role row is inconsistent state; report it and resolve it before probing. A bare host-native slug from an older sheet is also invalid because it does not say which provider owns it. If the sheet is missing, use the complete first-run role map and the model matrix's Default effort cells.

### 3. Parse per-family efforts

Read the model matrix. Every non-alias value must match `<provider>:<model>@<effort>`. Map it to exactly one matrix family by `(provider, model)`, require its effort to appear in that row's Selectable efforts cell, and collect the effort. Exclude Sol descriptors in `architect runners` from the Sol family effort collection and require each excluded descriptor to use `xhigh`. `inherit-parent` and `auto` rows carry no family effort.

An unmatched provider/model, out-of-domain effort, duplicate role, unknown role, or Architect Sol descriptor outside `xhigh` is inconsistent state. Stop, show the conflicting rows verbatim, and ask for an explicit matrix family or alias replacement. If one or more families have mixed efforts after excluding the Architect Sol exception, show every conflicting family and role row, then ask for one normalized effort per family from its Selectable efforts cell. Do not invent a precedence rule. Do not probe or write while any inconsistency is unresolved.

One distinct effort per family outside the Architect Sol exception is the current value. A family with no non-alias occurrence is unassigned; use its matrix Default effort as the proposed value and label it unassigned rather than calling it current.

### 4. Collect one requested effort per family

Ask exactly four effort questions, one each for Fable, Sol, Grok, and Opus. Name each model, its current or proposed value, and the Selectable efforts from its matrix row. State that the Sol answer applies outside `architect runners`, whose Sol lanes stay at `xhigh`. Empty input keeps a current value or accepts the matrix proposal for an unassigned family. On a first run, state the four matrix defaults and the Architect exception before asking. On a rerun, state the four parsed values and the Architect exception without offering to reset customized role lanes.

### 5. Probe the four requested pairs

Probe each distinct selected `provider:model@effort` pair. Run one probe per family, even when two families share a provider. Probe the Architect Sol `xhigh` pair separately when the selected Sol family effort differs. Do not enumerate or offer older models as substitutes. A failed probe writes nothing: report the failing pair and provider, stop, and keep the active sheet plus parent integration bytes unchanged. A failed first run creates neither artifact.

| Family | Pair source | Claude parent route | Codex parent route | Availability proof |
|---|---|---|---|---|
| Fable | Fable matrix row + selected effort | native Agent `pstack-fable-<effort>` | Claude CLI | native one-turn probe or `claude auth status --json` plus one-turn probe |
| Sol | Sol matrix row + selected effort | `codex exec` | native `spawn_agent` | `codex login status` plus one-turn probe or native one-turn probe |
| Architect Sol | Sol matrix row + `xhigh` | `codex exec` | native `spawn_agent` | `codex login status` plus one-turn probe or native one-turn probe |
| Grok | Grok matrix row + selected effort | Grok CLI | Grok CLI | `grok models` must list the requested model; one-turn probe |
| Opus | Opus matrix row + selected effort | native Agent `pstack-opus-<effort>` | Claude CLI | native one-turn probe or `claude auth status --json` plus one-turn probe |

Use a tiny read-only probe that returns a unique marker. A login-status command alone proves credentials, not that the requested model and effort flags run. Record native and external results separately. Never call the external launcher for the parent's own provider. On a Claude parent, the Fable and Opus probes are one-turn runs of the mapped `pstack-<stem>-<effort>` agent. On a Codex parent, the Sol probe is native `spawn_agent` with the selected `reasoning_effort`. Every other pair uses the external runner with the selected effort flag.

Receipts and native transcripts prove the requested effort and the route. They do not prove a provider's hidden applied reasoning depth. There is no implicit timeout, weaker-model fallback, same-provider external fallback, or second mutable configuration source.

### 6. Render, preserving role families

Build the new sheet in memory. Do not write it yet.

- First run: start from the complete role assignments in step 7.
- Rerun: start from the normalized complete role map from step 2, preserving each loaded row's lane order and family (or alias) per lane.

After effort selection, ask whether to keep those role-to-family assignments or change named roles. Keeping them is the default. Apply only role changes the operator names; never offer a reset of a customized sheet to the first-run assignments. A changed role may use one of the four probed matrix families, `inherit-parent`, or `auto`.

Require the final role map to contain at least one descriptor from each matrix family after excluding the Architect Sol exception. The sheet stores effort only in role descriptors, so an unassigned family's selection cannot persist without adding a second source of truth.

Rewrite every matrix-family descriptor to `provider:model@<requested effort for that family>`, then rewrite every Sol descriptor in `architect runners` to `codex:gpt-5.6-sol@xhigh`. Leave `inherit-parent` and `auto` unchanged. An effort-only rerun cannot change a role's family. Changing Sol's effort updates every Sol occurrence outside `architect runners`; changing Grok's effort updates every Grok occurrence and does not move a Sol role onto Grok. Refuse an unqualified slug, an unavailable route, a model other than the four matrix families, or a provider/model mismatch.

### 7. Confirm and commit

Show the route table for this parent, then show every rendered role and descriptor. Ask for confirmation before writing.

Why and Reflect require the parent's live MCP surface. Keep their investigator, reviewer, and synthesizer roles on `inherit-parent` or `auto`; the bounded external runner deliberately omits ambient MCPs. `inherit-parent` and `auto` always validate, but say when they reduce a panel's provider diversity. For panel roles, one lane runs per entry. The list length is the fan-out count. `arena cross-judge pool` is a list from which Arena chooses a provider different from the parent and base candidate when possible. `swarm workers` is the default for every worker unless a race explicitly assigns another descriptor.

Every non-alias value must match `<provider>:<model>@<effort>` and must have passed step 5.

After the operator confirms, write the in-memory render from step 6. Never paste the example below as the result. It is only the complete first-run role map used to seed step 2; selected efforts and explicit role changes always replace its example values before writing.

```markdown
# pstack model configuration

Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. Every documented role remains present. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.

feature, refactoring: grok:grok-4.6@xhigh
bug-fix: codex:gpt-5.6-sol@max
perf-issue: codex:gpt-5.6-sol@max
hillclimb: codex:gpt-5.6-sol@max
judgment and prose: claude:claude-fable-5@max
hardest tasks: claude:claude-fable-5@max
how explorer: grok:grok-4.6@xhigh
how explainer: claude:claude-fable-5@max
how critics: claude:claude-fable-5@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:claude-opus-5@xhigh
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: claude:claude-fable-5@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:claude-opus-5@xhigh
arena cross-judge pool: claude:claude-fable-5@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:claude-opus-5@xhigh
swarm workers: grok:grok-4.6@xhigh
architect runners: claude:claude-fable-5@max, codex:gpt-5.6-sol@xhigh, grok:grok-4.6@xhigh, claude:claude-opus-5@xhigh
interrogate reviewers: claude:claude-fable-5@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:claude-opus-5@xhigh
```

### 8. Wire it in

Render the parent integration in memory before either write. On Claude, the integration is the single `@~/.claude/pstack-models.md` include in `~/.claude/CLAUDE.md`. On Codex, it is the exact sheet bytes between one `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->` pair in `~/.codex/AGENTS.md`. Replace that whole bounded block on a rerun. Insert one block at the end on first run. If either marker is missing, duplicated, or reversed, stop and report inconsistent state instead of guessing a boundary.

Snapshot every target's current bytes. Write the sheet and parent integration only after all four probes pass and the operator confirms. Read both targets back and compare them with the in-memory render. If either write or readback fails, restore every snapshot and report the failure. An unchanged rerun must produce byte-identical sheet and integration content after normalization.

Do not copy the model sheet between harnesses without rerunning the parent-specific probes; route availability can differ even on the same host.

### 9. Behavioral smoke

Before declaring setup complete, run one small read-only mixed panel from this parent with every distinct chosen descriptor, including the Architect Sol exception, distinct output/receipt paths, and an independent cross-judge. Launch Claude-native agents and every external process in the background with retained handles, then drain them. Verify the native transcript entries and every external receipt. A structural config check or unit test is not a substitute.

Report the sheet path, parent route table, requested-effort probe results, smoke results, and external elapsed/token/cost receipts. Re-running this skill re-probes and updates the same sheet. Do not claim the provider exposed hidden applied-effort observability.
