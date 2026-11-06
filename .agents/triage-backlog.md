# Triage backlog: open-pstack

The `triage-backlog` skill reads this file. open-pstack is a one-repository project.

## Repositories

| Repository | Tracker | Verify skill |
|---|---|---|
| ericlitman/open-pstack | GitHub Issues | `.claude/skills/verify-open-pstack` |

## Session hosts

pro14, studio2

## Records

`~/projects/docs/projects/open-pstack/records/`

## Additions

### After step 4 (Sweep blockers): upstream lens

```sh
git remote | grep -qx cursor || git remote add cursor https://github.com/cursor/plugins.git; git fetch cursor main
git worktree add --detach <tmp>/port origin/main && cd <tmp>/port
python3 scripts/upstream-audit.py --port origin/main --upstream cursor/main > <tmp>/audit.json
python3 scripts/upstream-merge.py <tmp>/audit.json; echo "exit $?"
cd - && git worktree remove --force <tmp>/port
```

`upstream-merge.py` has no dry-run mode and writes files, so this second throwaway worktree is the dry run. Report its verbatim, clean-merge and needs-review counts. Exit 1 means review is needed. Exit 2 means the script refused its input. Report the two apart.

Tag each item port-only or Cursor-derived, by the paths it edits (a PR's files) or names, as `UPSTREAM.md` and `NOTICE.md` map them; an item that names none is tagged from its subject, and the tag says so. Before a local fix to a Cursor-derived file is scheduled, check the source that `UPSTREAM.md` or `NOTICE.md` names for that path for an existing fix, such as `git log cursor/main -- pstack/<path>` for the pstack tree. An "upstream first" disposition is finished only when the authorized upstream action exists and its link is in the plan. For an issue already closed upstream-first, record whether the upstream PR exists, and act only when its reopen condition fired. Distinguish model providers from parent harnesses; T3 Code is a supported parent harness. Done when the counts, the exit code and a tag for each item are in the plan.

### Steps 2 (Collect) and 5 (Release lag): model snapshot, release procedure and model lag

The release procedure is `python3 scripts/release.py publish`, which tags the live-gated head.

After the step-2 collector, save the Codex model list: `codex debug models > <out>/codex-models.txt 2>&1`, and record `codex --version` in the plan. Claude has no model-list command, so the plan says its list is unavailable. At step 5, compare `codex-models.txt` with the registry source `plugins/pstack/skills/poteto-mode/scripts/runner/registry/models.ts`. A gap recommends a change to the registry source, because `model-catalog.md` is generated from it. Done when each model gap is in the plan.

### Step 6 (Set dispositions): live gate

The live proof is the `live-gate` status in each PR's `checks`. Before scheduling, confirm the item can be live-gated: a same-repository PR, a Darwin host (`uname -s`), and every path it changes mapped in `.claude/skills/verify-open-pstack/features/registry.json`, because the live gate fails closed on an unmapped path. For a provider item, `command -v <cli>`: an absent CLI cannot be live-gated. Run `.claude/skills/verify-open-pstack/scripts/verify.sh doctor --output <new dir>`. A failure becomes an evidence-plan question; a Claude `loggedIn: false` is repaired by Eric logging in from the Claude app's Terminal panel on that host, not over SSH.

A fork PR cannot get a `live-gate`. Port it to a same-repository branch with `Co-authored-by`, or close it with a pointer.
