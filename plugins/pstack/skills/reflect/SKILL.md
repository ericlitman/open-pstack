---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

**Dispatch contract.** Resolve every configured role through [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md). Reviewers need the parent's live MCP surface, so the default and supported portable route is `inherit-parent` (or its `auto` alias). Pass the transcript or digest plus any required evidence paths. On Codex, resolve remaining Claude tool names via [`codex-tools.md`](../poteto-mode/references/codex-tools.md).

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, resolve and verify this conversation's transcript through the [active-transcript mapping](../poteto-mode/references/codex-tools.md#active-transcripts); otherwise pass a tight session digest.

## 2. Spawn three reviewers in parallel

Start all three read-only lanes in one fan-out phase through provider dispatch. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references, so keep them native to the parent. The prompt forbids file writes; the parent applies edits. Pick each subagent's effort for the job, per the Subagents section of the **poteto-mode** skill.

| Lens | Model descriptor | Prompt template |
|---|---|---|
| Judgment | the `reflect tooling, judgment, divergent, synthesizer` descriptor (default `inherit-parent`) | `references/judgment-reviewer.md` |
| Tooling | the `reflect tooling, judgment, divergent, synthesizer` descriptor (default `inherit-parent`) | `references/tooling-reviewer.md` |
| Divergent | the `reflect tooling, judgment, divergent, synthesizer` descriptor (default `inherit-parent`) | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `Agent` response body.

## 3. Synthesize

Dispatch one lane using the `reflect tooling, judgment, divergent, synthesizer` descriptor (default `inherit-parent`). It spot-verifies citations through MCP, so preserve that access. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill under the plugin cache. Before approval, show its destination, the project or user skill folder that [`codex-tools.md`](../poteto-mode/references/codex-tools.md#reflect-skill-copies) names for this harness. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the **plugin-dev:skill-development** skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `plugin-dev:skill-development` and run its description-optimization loop.
- `new skill via plugin-dev:skill-development: <kebab-name>`: hand creation to `plugin-dev:skill-development`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
