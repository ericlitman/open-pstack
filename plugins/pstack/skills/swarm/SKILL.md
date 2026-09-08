---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
---

# Swarm

Fan out N parallel workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

**Dispatch contract.** Resolve each worker descriptor through [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md). The parent starts native and external lanes; workers never route themselves. On Codex, resolve remaining Claude tool names via [`codex-tools.md`](../poteto-mode/references/codex-tools.md).

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not the number that run at once.
4. Pick the worker descriptor from `swarm workers` in the current harness's pstack model sheet when present. Otherwise use `grok:grok-4.6@xhigh`. For a model race, name each arm's descriptor up front.
5. Give each worker its own writable output when it writes.

## Phase B: Fan out

Start all N workers in one fan-out phase through provider dispatch. Native lanes use background subagents; external lanes invoke the launcher as background work with retained task/session handles. Never use Claude's foreground Bash path for a long worker. Every writer runs in its assigned worktree or output directory. Isolation comes from those paths, not the provider.

When a worker must start from a non-default branch, check that branch out in the worker's own worktree and name the worktree path in its brief.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence.

If a worker drops out, proceed with N-1 and note the provider, model, and receipt failure. Never substitute another provider silently.

## Phase C: Aggregate

Read the terminal results. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
