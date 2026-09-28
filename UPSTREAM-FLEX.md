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
- The three GPT-6 rows in the stock model matrix, the "Default panel" section, the "Flex model matrix" section, and the route-table columns in `references/provider-dispatch.md`
- The first-run sheet in `skills/setup-pstack/SKILL.md` and the default descriptors named in `arena`, `architect`, `interrogate`, `how`, `swarm`, and the `feature`, `refactoring`, `bug-fix`, `perf-issue`, and `hillclimb` playbooks
- The assignment-first restructure of `skills/setup-pstack/SKILL.md`
- `docs/LANES.md`, this file, the README fork section, and the NOTICE/LICENSE/CHANGES additions

Every upstream skill body is byte-unchanged except for the default-descriptor mentions listed above. Since [#17](https://github.com/thisguymartin/pstack-flex/issues/17), the stock matrix carries three fork-owned GPT-6 rows and the first-run sheet uses them, so those two surfaces conflict on every upstream sync and are resolved by hand: keep the fork's rows and defaults, take upstream's wording for everything else.

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
- `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md` — the four upstream rows and their prose are upstream's; the GPT-6 rows, the "Default panel" section, and the flex section are fork-owned. Upstream's own panel changes land in the "Default panel" line only if the fork wants them.

After every merge: run the full local gate (`bun install --frozen-lockfile`, `bun run test`, `bun run typecheck`, manifest JSON parse, `PSTACK_STATIC_ONLY=1 bash tests/skill-collision-repro.sh`), then record the installed version, action, and observed result for each affected harness in the pull request before tagging.
