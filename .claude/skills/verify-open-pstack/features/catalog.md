# Model catalog

## Sub-features

The generated model catalog (`plugins/pstack/skills/poteto-mode/references/model-catalog.md`), the generated Claude-native `pstack-<family>-<effort>` agents, and the runner registry sources they come from (`scripts/runner/registry/**`, `scripts/runner/providers/**`): model matrix, kept predecessors and rolling aliases, routes, provider notes, and role defaults.

## How to get to it (user POV)

A parent reads the catalog through `provider-dispatch.md` whenever a configured role launches. Invoke the installed `poteto-mode` skill and ask it to resolve roles from a model sheet.

## Driving it with verify-open-pstack

Give the parent a fixture model sheet, not the operator's configured one, so this feature changes no real configuration. Ask it to report each role's descriptors and routes as JSON. Compute the expected role defaults and routes from the installed candidate's catalog and the fixture sheet, never from a copy in the verifier.

## Gotchas

The outcome is the evidence: the reported descriptors and routes must equal the candidate's. Do not check which files the parent read or the text of its commands. A catalog change also selects `setup` and `runner`, because setup reads the catalog and the runner resolves lanes through the registry.

## Headless

The catalog recipe in `recipes.ts` writes a fixture sheet whose `judgment and prose` line takes another role's default descriptor, so only a read of the sheet reports it. The sheet has no `arena runners` or `bug-fix` line. It puts `swarm workers` on `codex:gpt-6-luna@max`, `hardest tasks` on the registered pin `claude:claude-opus-5-5@max`, `how explainer` on the versioned `claude:claude-sonnet-5-5@high`, and `how explorer` on the Devin lane `devin:swe-2@max`. The parent writes `routes.json` with the descriptors and routes of those seven roles. The case asserts the `poteto-mode` load and that the report equals, role by role, the sheet's descriptor or the installed catalog's role default, each with the route the catalog's route table gives this parent. The pin, Luna and the Devin lane stay unchanged, the Devin lane is external from both parents, and the Sonnet revision is reported as `claude:sonnet@high`. The recipe fixes those dispatched descriptors, and the catalog gives their routes. The sheet also puts `feature, refactoring` on `codex:gpt-6.1-sol@max` and holds the setting line `codex writer sandbox: full-access`. The report adds that role and `writerSandbox`, the `--writer-sandbox` value the parent would pass for that role's writer: `full-access` from Claude, whose route is the external runner, and null from Codex, whose route is native `spawn_agent`. A second case, `consume-sheet-bounded`, writes the same fixture sheet with the setting line `codex writer sandbox: bounded`. The runner's `bounded-writer` case covers a sheet with no setting line. It asserts the same roles, descriptors and routes, and `writerSandbox` null from both parents, so a parent that passes full access without the opt-in fails.

On Claude, a second case, `native-agents`, has the parent dispatch `pstack:pstack-sonnet-max`, `pstack:pstack-opus-5-5-max`, and `pstack:pstack-haiku-5-5-max` through `Agent`. Each child reads its own fixture nonce and writes it to its own output file. The `Agent` call returns only a launch notice, so the case asserts each dispatch, at least one tool call recorded under it, and that the output file holds that agent's nonce. Codex has no Claude-native agents, and its session record does not show `spawn_agent`, so this case runs on Claude only.
