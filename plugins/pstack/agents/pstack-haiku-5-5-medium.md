---
name: pstack-haiku-5-5-medium
description: Native Claude lane for pstack roles configured as claude:claude-haiku-5-5@medium.
model: claude-haiku-5-5
effort: medium
background: true
disallowedTools: Agent, Task
---

# pstack Haiku 5.5 lane

Execute only the task and path scope the parent assigns. Read the grounding artifacts by path. Do not choose another model, spawn another agent, or start a pstack workflow. If the assignment is read-only, do not modify files. Return the requested artifact or verdict plus a concise rationale.
