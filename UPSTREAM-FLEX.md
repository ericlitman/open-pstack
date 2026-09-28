# Flex fork synchronization

pstack-flex layers on top of open-pstack's own upstream tracking. Two sync relationships exist:

1. `cursor/plugins/pstack` -> `ericlitman/open-pstack` — documented in [UPSTREAM.md](UPSTREAM.md), unchanged by this fork.
2. `ericlitman/open-pstack` -> `thisguymartin/pstack-flex` — this document.

## Fork point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/ericlitman/open-pstack.git` |
| Tag | `v1.4.1` |
| Commit | `de67e6b40511814171e5e4c8ad7af3b79f07c9ee` |
| Tracks Cursor pstack | `0.15.1` (`f8abedd`) |

The fork keeps full upstream history. The `upstream` remote points at ericlitman/open-pstack.

## What the fork owns

All flex changes are additive and live in port-owned files so upstream merges stay cheap:

- `plugins/pstack/skills/poteto-mode/scripts/runner/flex-providers.ts` and `flex-providers.test.ts` (new)
- Gateway-provider hooks in `runner/{types,commands,run,parse-output,cli}.ts` and their tests
- The "Flex model matrix" section and route-table columns in `references/provider-dispatch.md`
- The assignment-first restructure of `skills/setup-pstack/SKILL.md`
- `docs/LANES.md`, this file, the README fork section, and the NOTICE/LICENSE/CHANGES additions

The stock model matrix, the first-run sheet, every upstream skill body, and the static quad invariants are byte-unchanged. Flex rows and setup instructions are additive.

## Merge procedure

```shell
git fetch upstream
git switch -c merge-rehearsal
git merge --no-ff --no-commit upstream/main
# inspect, resolve, run the full local gate, then merge for real or abort
```

Expected conflict surface on future upstream releases:

- `plugins/pstack/skills/setup-pstack/SKILL.md` — upstream issue #88 (1.5.0, syncing Cursor pstack 0.15.5) folds upstream PR #73, which moves setup to the same assignment-first, probe-only-assigned shape this fork already uses. Resolve toward upstream's wording wherever it covers the same rule; keep the flex families and the diversity rule.
- `plugins/pstack/skills/poteto-mode/scripts/runner/model-matrix.test.ts` — upstream 1.5.0 changes the stock panel to three lanes. Take upstream's stock assertions verbatim; the flex-matrix describe block is fork-owned and should survive as-is.
- `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md` — stock matrix and default-panel prose are upstream's; the flex section is fork-owned.

After every merge: run the full local gate (`bun install --frozen-lockfile`, `bun run test`, `bun run typecheck`, manifest JSON parse, `PSTACK_STATIC_ONLY=1 bash tests/skill-collision-repro.sh`), then record the installed version, action, and observed result for each affected harness in the pull request before tagging.
