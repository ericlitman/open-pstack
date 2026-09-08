---
name: principle-attack-the-premise
description: "Apply when two or more fixes that share one premise have failed the same gate. Question the shared premise before the next fix. For imbalance problems, take a census per actor and test the asymmetry hypothesis."
user-invocable: false
---

# Attack the Premise

When two or more fixes that share one premise have failed the same gate, suspect the premise, not the fixes.

**Why:** Each failure under a shared premise is evidence about the premise.

**Pattern:**
- **Write the premise down.** The premise is the one sentence that every failed fix assumed.
- **For imbalance problems, take a census before the next fix.** Count the imbalance per actor to test which actors hold it. Write the census as a rerunnable script per [Build the Lever](../principle-build-the-lever/SKILL.md).
- **If the census shows skew, investigate it.** If the same few actors hold most of the imbalance on every run, something assigns them that role. Find what assigns the role. That assignment is the next "why" per [Fix Root Causes](../principle-fix-root-causes/SKILL.md).
- **When role assignment causes the imbalance, remove that asymmetry instead of compensating for it**, per the [Laziness Protocol](../principle-laziness-protocol/SKILL.md). Rotate the role between actors, randomize the assignment, or move the role, so that no actor holds it on every run. A return path, a shared pool, a batched hand-off, or a periodic rebalance leaves the assignment in place and adds work on every run.

**Stop:**
- Do not start the next fix before the premise is written down and tested. For an imbalance hypothesis, include the census.
- If the census is even across actors, that is evidence against the asymmetry hypothesis, not proof that the shared premise is correct. Keep questioning the premise and retain the census as evidence.

This principle is distinct from [Redesign from First Principles](../principle-redesign-from-first-principles/SKILL.md), which rebuilds a design around a new requirement. It questions a fact the current design assumes.
