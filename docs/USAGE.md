# Using pstack-flex

The walkthrough: what this plugin is, how work flows through it, how to set it up on the models you actually have, and copy-paste examples for the skills you will use daily. Lane mechanics and pricing live in [LANES.md](LANES.md); the fork's delta over upstream is in [UPSTREAM-FLEX.md](../UPSTREAM-FLEX.md).

## What this is

pstack is a plugin of engineering skills, playbooks, and small local tools for coding agents — not a model, not a service. You hand `poteto-mode` a task; it matches the task to a playbook, works the steps, and leaves evidence (diffs, runs, receipts) you can inspect instead of asking for trust. Its sharpest edge is multi-model adversarial review: several different model families challenge important work, because the adversarial signal comes from model diversity, not assigned personas.

pstack-flex adds one thing on top: **you choose the models and the compute**. Any subset of families works, and two open labs — DeepSeek and MiniMax — are first-class lanes on plain API keys, down to a zero-subscription setup.

If you also use my [thisguyskills](https://github.com/thisguymartin/skills) collection: that repo decides **what** to build (shaping, spec, Linear, handoff) and its handoff ends with "Use `pstack:poteto-mode`" — which is exactly where this repo picks up.

## The big picture

```mermaid
flowchart TD
    T([Your task]) --> P["/pstack:poteto-mode"]
    P --> PB[Playbook match<br/>feature, bug-fix, refactoring, perf, ...]
    PB --> S[Skills fire per step<br/>how, tdd, interrogate, arena, ...]
    S --> F{Lane fan-out}
    F --> N1["claude:fable / claude:opus<br/>native Agent (Claude sub)"]
    F --> N2["codex:gpt-5.6-sol<br/>native or codex CLI (ChatGPT sub)"]
    F --> N3["grok:grok-4.6<br/>grok CLI (Grok sub)"]
    F --> G1["deepseek:deepseek-flash<br/>runner + env -> DeepSeek API (key)"]
    F --> G2["minimax:MiniMax-M3<br/>runner + env -> MiniMax API (key)"]
    N1 --> R[Outputs + receipts]
    N2 --> R
    N3 --> R
    G1 --> R
    G2 --> R
    R --> V[Verification: run it, judge it,<br/>cross-model consensus]
    V --> PR([Review-ready PR])
```

Every lane is a real agent process with tools and file access. The parent harness (your Claude Code or Codex session) resolves the route once; children never pick their own models.

## Install this fork

The marketplace keeps upstream's name (`open-pstack`), so only the source changes.

Claude Code:

```text
/plugin marketplace add thisguymartin/pstack-flex
/plugin install pstack@open-pstack
/reload-plugins
```

Codex:

```shell
codex plugin marketplace add thisguymartin/pstack-flex --ref main
codex plugin add pstack@open-pstack
```

Plus [Bun](https://bun.sh) for the lane runner, and `multi_agent = true` under `[features]` in `~/.codex/config.toml` if Codex is your parent. Sign in only to the CLIs whose subscriptions you actually have — missing families are fine now.

## Keys for the gateway lanes

DeepSeek and MiniMax have no login flow here; their lanes read an API key from your environment at spawn time. The runner never writes keys to disk or receipts, so the only question is how the env gets populated. Don't paste keys into `.zshrc` — store them encrypted and load on demand. macOS Keychain, built in and free:

```zsh
# once: store each key (prompts for the value, nothing in shell history)
security add-generic-password -a "$USER" -s pstack-deepseek -w
security add-generic-password -a "$USER" -s pstack-minimax -w

# in .zshrc: a function, not an export — keys enter env only when you call it
pstack-keys() {
  export DEEPSEEK_API_KEY=$(security find-generic-password -a "$USER" -s pstack-deepseek -w)
  export MINIMAX_API_KEY=$(security find-generic-password -a "$USER" -s pstack-minimax -w)
}
```

Daily flow: `pstack-keys -> claude -> /pstack:poteto-mode`. Alternatives, the threat model, and the spend-cap advice are in [LANES.md](LANES.md#storing-keys). Set spend caps on both provider dashboards; that is the real blast-radius control.

## First-time setup: /setup-pstack

```text
/pstack:setup-pstack
```

(Codex: `Use pstack:setup-pstack to configure pstack.`)

Setup is assignment-first: pick which roles run on which families, answer one effort question per **assigned** family, and only assigned families get probed. Unassigned families are skipped, not errors. Every probe is a real one-turn run — a failed probe writes nothing. Three configurations that make sense:

**A. Full frontier** (Claude + ChatGPT + Grok subs) — accept the defaults; behaves exactly like stock upstream:

```text
arena runners: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
```

**B. Hybrid saver** (Claude sub + two API keys) — frontier judgment, cheap volume:

```text
feature, refactoring: deepseek:deepseek-flash@high
bug-fix: deepseek:deepseek-flash@high
judgment and prose: claude:fable@max
hardest tasks: claude:fable@max
swarm workers: deepseek:deepseek-flash@high
arena runners: claude:fable@max, deepseek:deepseek-flash@high, minimax:MiniMax-M3@high
interrogate reviewers: claude:fable@max, deepseek:deepseek-flash@high, minimax:MiniMax-M3@high
```

**C. Zero-subscription budget duo** (nothing but two keys) — start your parent session env-pointed at DeepSeek (walkthrough in [LANES.md](LANES.md#zero-subscription-walkthrough)), then assign everything across the two flex families:

```text
arena runners: deepseek:deepseek-flash@high, minimax:MiniMax-M3@high
interrogate reviewers: deepseek:deepseek-flash@high, minimax:MiniMax-M3@high
```

Two labs are two distinct families, so panels keep real diversity without any override. A single-provider panel needs your explicit confirmation — by design.

## Daily driving: the skills, with examples

**poteto-mode** — the default entry point for any real task. It stays sticky across turns and pairs well with long autonomous sessions.

```text
/pstack:poteto-mode

Take ENG-142: saved reports lose their date-range filter after rename.
Repro is in the issue. Fix it, prove it in the running app, and prep the PR.
```

**interrogate** — multi-model review of a decision, design, or diff. Reviewers come from different families; the parent sorts their findings.

```text
/pstack:interrogate

Review this migration plan in docs/plans/report-store.md. Attack the
premise, the rollout order, and anything that loses data on rollback.
```

```mermaid
flowchart LR
    Q[Decision or diff] --> A[Reviewer A<br/>family 1]
    Q --> B[Reviewer B<br/>family 2]
    Q --> C[Reviewer C<br/>family 3]
    A --> S[Parent synthesizes]
    B --> S
    C --> S
    S --> O["consensus (2+ models) -> act on<br/>lone findings -> consider<br/>disagreements -> resolve explicitly"]
```

**arena** — N parallel attempts at the same task, an independent cross-judge, then graft the best parts onto a base.

```text
/pstack:arena

Implement the rate limiter from the spec in docs/spec.md. Run the
configured arena panel and keep the winner's tests regardless of base.
```

```mermaid
flowchart LR
    T[Task] --> C1[Candidate 1]
    T --> C2[Candidate 2]
    T --> C3[Candidate 3]
    C1 --> J[Cross-judge<br/>different provider]
    C2 --> J
    C3 --> J
    J --> G[Pick base + graft<br/>best pieces]
```

**swarm** — same-shaped work fanned across N workers, one combined report. Good for sweeps: "apply this codemod across packages," "audit every endpoint for X."

```text
/pstack:swarm

Audit every handler under src/api/ for missing input validation.
One worker per file group, combined findings ranked by severity.
```

**architect** — competing designs from different families, scored by a judge on yet another family, before any code.

```text
/pstack:architect

Design the offline sync layer: local-first edits, conflict policy,
and migration from the current always-online store.
```

Worth knowing by name: `how` (explain how something works before touching it), `why` (root-cause an incident with your MCP context), `tdd`, `unslop` (de-slop prose and code), `fix-ci`, `babysit` (drive a PR to green). The 23 `principle-*` leaves are loaded by poteto-mode as needed — you rarely invoke them directly.

## What actually happens on a gateway lane

No new harness. The same runner that launches Codex and Grok lanes spawns the stock `claude` binary with swapped environment:

```mermaid
sequenceDiagram
    participant P as Parent session
    participant R as pstack-runner
    participant C as claude -p (subprocess)
    participant D as DeepSeek / MiniMax API
    P->>R: lane: deepseek:deepseek-flash@high
    R->>R: guard: DEEPSEEK_API_KEY set?<br/>config dir free of OAuth creds?
    Note over R: refusal = unauthenticated receipt,<br/>no subprocess ever spawned
    R->>C: spawn with ANTHROPIC_BASE_URL,<br/>ANTHROPIC_AUTH_TOKEN, isolated CLAUDE_CONFIG_DIR
    C->>D: every model request in the agent loop
    D-->>C: completions
    C-->>R: JSON result
    R-->>P: output file + receipt
```

The guard order matters: key check and OAuth check happen in-process **before** anything runs, so a claude.ai login can never be pointed at a third-party endpoint. Inherited `ANTHROPIC_*` values from your parent session are stripped before injection.

## Reading receipts

Every external lane writes a JSON receipt next to its output. The fields that matter:

| Field | Meaning |
| --- | --- |
| `status` | `complete`, or a named dropout (`unauthenticated`, `unavailable-cli`, `timed-out`, ...) |
| `modelVerified` + `modelEvidence` | `provider-report` = the endpoint echoed the requested model (case-insensitive for gateways). `pinned-argv` = it didn't, but the argv pinned it — normal for Codex and sometimes gateways |
| `usage` | real token counts — trust these |
| `costUsd` | real for claude/grok subscription lanes; **always `null` on gateway lanes** (the CLI would price at Anthropic rates). Multiply `usage` by the [LANES.md](LANES.md) table instead |

## Cost playbook

- High-volume code-writing roles (`feature`, `bug-fix`, `swarm workers`) -> `deepseek:deepseek-flash` — cheapest tokens, near-free cache hits, and half price in the off-peak window.
- Long-context research and big-repo reading -> `minimax:MiniMax-M3` — 1M context.
- `judgment and prose` and `hardest tasks` -> your best frontier lane if you have one; this is the last role to economize.
- Panels: one frontier + two flex lanes gets you three-family diversity at a fraction of three subscriptions.

## Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| Receipt `unauthenticated`, exit 77, "KEY is not set" | lane env missing | run your `pstack-keys` function (or export the key) in the shell that starts the parent |
| Receipt `unauthenticated`, "OAuth credentials found" | a claude.ai login sits in the lane's config dir | that's the leak guard working; remove the login from `~/.pstack-flex/<provider>` — never `claude login` there |
| Receipt `unauthenticated` after the model ran | the endpoint rejected the key (401) | check the key and the base URL against the provider's current guide |
| Exit 69 `unavailable-cli` | the `claude` binary isn't on PATH for the runner | install it or fix PATH |
| A panel ran with fewer lanes than configured | a lane dropped out with a named receipt | read that receipt; pstack proceeds N-1 and never silently substitutes a model |
| Everything gateway broke after a claude CLI update | Anthropic doesn't support third-party endpoints; compatibility can shift | pin the CLI version on machines that depend on gateway lanes; see [LANES.md](LANES.md#safety-and-policy) |
