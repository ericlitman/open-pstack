---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
---

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

**Dispatch contract.** Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before launching adversaries. Configured entries are provider-qualified descriptors; the parent starts native and external lanes directly. On Codex, resolve remaining Claude tool names via [`codex-tools.md`](../poteto-mode/references/codex-tools.md).

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent by reading and following the [`in-your-own-words`](../in-your-own-words/SKILL.md) skill, which runs only when typed, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fan out

Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with these changes. Read the `interrogate reviewers` line in place of `arena runners`. If the sheet or that line is missing, use its [role default](../poteto-mode/references/model-catalog.md#role-defaults). Before launch, prepare one dedicated worktree per adversary at the reviewed HEAD, and copy the scope's uncommitted tracked and untracked changes into each. Route each adversary's descriptor with `isolated-write` access in its own worktree, with a unique output and receipt path. Adversaries never stage, commit, or create worktrees. Use the parent subagent primitive without a model override for an `auto` or `inherit-parent` entry, so that adversary runs on the parent model. Pick each subagent's effort for the job, per the Subagents section of the **poteto-mode** skill.

A provider whose route has no `isolated-write` mode is a named dropout, and so is an unavailable provider, login, or model. Continue with the completed adversaries. Never pick the closest model or silently fall back; that destroys the meaning of cross-provider agreement.

In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Verify each finding per arena Phase F by rerunning its command. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Adversaries**: each adversary's descriptor, or its named dropout and the reason.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive. When no adversary completed, say the coverage is incomplete instead.
- **Dropped**: for each adversary, the count of dropped findings and why.
