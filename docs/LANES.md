# Lanes: models, providers, and cost control

pstack-flex's reason to exist: you choose which models run and what they cost. This document covers the lane concepts, the gateway environment reference, prices, the zero-subscription walkthrough, and the safety rules.

Prices and endpoints below were verified 2026-09-25 and drift. Re-verify against each provider's own docs before relying on a number.

## Lane kinds

| Kind | Lanes | Auth | Billing | Route |
| --- | --- | --- | --- | --- |
| Subscription | `claude:fable`, `claude:opus`, `codex:gpt-5.6-sol`, `grok:grok-4.6` | each CLI's own login | that CLI's plan | native or external per the route table |
| Gateway (flex) | `deepseek:deepseek-flash`, `minimax:MiniMax-M3` | API key in the environment | pay per token on the lab's key | always the external runner |

A gateway lane is the stock `claude` binary env-pointed at the lab's Anthropic-compatible endpoint. There is no custom agent loop and no separate harness: the same runner that spawns Codex and Grok lanes spawns gateway lanes with injected environment. Both labs document this Claude Code setup themselves (DeepSeek: `deepseek-ai/awesome-deepseek-agent`, `docs/claude_code.md`; MiniMax: platform.minimax.io, Claude Code guide).

## Gateway environment reference

Set by you:

| Variable | Required | Meaning |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` / `MINIMAX_API_KEY` | yes, per lane | the lab's API key; the lane refuses to start without it |
| `DEEPSEEK_BASE_URL` / `MINIMAX_BASE_URL` | no | endpoint override; defaults are in the flex model matrix |
| `PSTACK_FLEX_DEEPSEEK_CONFIG_DIR` / `PSTACK_FLEX_MINIMAX_CONFIG_DIR` | no | config-dir override; default `~/.pstack-flex/<provider>` |
| `DEEPSEEK_MAX_CONTEXT_TOKENS` / `MINIMAX_MAX_CONTEXT_TOKENS` | no | context-cap override for the claude CLI |

Injected by the runner at spawn time (never written to disk, never in receipts): `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, the model pins (`ANTHROPIC_MODEL`, the opus/sonnet/haiku alias defaults, `CLAUDE_CODE_SUBAGENT_MODEL`), `CLAUDE_CODE_ATTRIBUTION_HEADER=0`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, and `CLAUDE_CONFIG_DIR`. Any inherited `ANTHROPIC_*` value from the parent session is deleted first.

## Storing keys

Keys reach a lane through the environment only; the runner never writes them to disk, receipts, or sheets. So key hygiene is entirely about how your shell gets them. Do not put raw keys in dotfiles or committed `.env` files.

Recommended: your OS keychain, loaded on demand.

- **macOS** (built in, encrypted at rest, unlocks with login):

  ```zsh
  # once per key — prompts for the value, nothing lands in shell history
  security add-generic-password -a "$USER" -s pstack-deepseek -w
  security add-generic-password -a "$USER" -s pstack-minimax -w

  # in .zshrc: a function, not an export — keys enter env only when called
  pstack-keys() {
    export DEEPSEEK_API_KEY=$(security find-generic-password -a "$USER" -s pstack-deepseek -w)
    export MINIMAX_API_KEY=$(security find-generic-password -a "$USER" -s pstack-minimax -w)
  }
  ```

- **Linux**: `pass` (GPG-encrypted, git-syncable) or `secret-tool` (libsecret) with the same load-on-demand function shape.
- **1Password CLI**: `op run --env-file=.env.tpl -- claude` injects the keys at process start with biometric unlock and exports nothing into the shell permanently.
- **direnv**: fine for per-project scoping (gateway lanes are per-project opt-in anyway), but a raw `.envrc` is plaintext — have it call the keychain instead of holding the key.

Honest threat model: encryption at rest protects against dotfile repos, backups, and file theft. Once a key is in process env, any process running as your user can read it — the same exposure your CLI OAuth credential files already have. Keychain storage plus two ops controls is the right amount: **set spend caps on the DeepSeek and MiniMax dashboards** (the real blast-radius limiter) and rotate keys if a machine is ever compromised.

## Prices (verified 2026-09-25 — re-check before budgeting)

| Lane | Price per million tokens | Notes |
| --- | --- | --- |
| DeepSeek V4.1-Flash (`deepseek-flash`) | $0.30 in / $1.20 out peak; $0.15 / $0.60 off-peak; cache hits near-free | Off-peak windows: 01:00-04:00 and 06:00-10:00 UTC on weekdays. The discount is automatic on DeepSeek's side; pstack-flex surfaces the window but never delays your work to hit it. MIT open weights. |
| DeepSeek V4-Pro | $1.32 / $3.96 peak; half off-peak | Stronger model for hard lanes; assign it per role if wanted. |
| MiniMax M3 (`MiniMax-M3`) | $0.30 / $1.20 at up to 512K input; higher above | 1M context. Custom community model license (irrelevant for API use). |
| Claude / Codex / Grok subscription lanes | plan-dependent | Billed by each provider's plan, not per token here. |

Gateway receipts always report `costUsd: null`: the claude CLI computes `total_cost_usd` at Anthropic list prices, which would be fiction for third-party traffic. Token usage in receipts is real — multiply it by the table above.

## Zero-subscription walkthrough

Goal: run poteto-mode and its panels with no Claude, ChatGPT, or Grok plan — only two API keys. The Claude Code binary is a free download; a subscription is only needed to reach Anthropic's servers.

1. Install the claude CLI, Bun, and this plugin as usual. Do not run `claude login` anywhere in this setup.
2. Export `DEEPSEEK_API_KEY` and `MINIMAX_API_KEY`.
3. Make the parent session itself a DeepSeek session — same mechanism as a lane, applied to your interactive shell:

   ```shell
   export ANTHROPIC_BASE_URL="<DeepSeek's Anthropic endpoint, from their Claude Code guide>"
   export ANTHROPIC_AUTH_TOKEN="$DEEPSEEK_API_KEY"
   export ANTHROPIC_MODEL="deepseek-flash"
   export CLAUDE_CODE_SUBAGENT_MODEL="deepseek-flash"
   export CLAUDE_CONFIG_DIR="$HOME/.pstack-flex/parent-deepseek"
   claude
   ```

   Native `claude:*` lanes spawned by this parent inherit the endpoint, so the fable/opus role slots ride DeepSeek too.
4. Run `/setup-pstack`. Assign roles across the `deepseek` and `minimax` families (a `budget-duo` style panel), skip the unassigned stock families, and let the probes confirm both endpoints.
5. Panels keep real diversity: DeepSeek and MiniMax are two distinct providers, which satisfies the two-provider panel rule without any override.

Quality note: this trades peak capability for cost control. The hardest-task role on a frontier subscription lane is a config choice you can add later without touching anything else.

## Safety and policy

- **Unsupported, not prohibited.** Anthropic's docs state that routing Claude Code to non-Claude models through gateways is not supported. No terms clause or enforcement against pointing the unmodified binary at a third-party endpoint was found (2026-09-25), but a CLI update can break compatibility without notice. Pin the claude CLI version on machines that depend on gateway lanes and bump it deliberately.
- **Never a claude.ai login on a gateway path.** Do not run `claude login` or `claude setup-token` inside any `~/.pstack-flex/` config dir. The runner enforces this: a gateway lane refuses to start when its config dir carries an OAuth credentials file. Caveat: on macOS the CLI may store credentials in the Keychain where the file check cannot see them — the rule above is the real defense; the check is a backstop.
- **Privacy: gateway lanes are opt-in per project.** Do not send client or customer code to third-party providers by default. Keep sensitive repositories on subscription lanes, and enable gateway lanes deliberately, per project.
- **No silent substitution, ever.** A failed gateway lane is a named dropout receipt like any other lane. Nothing falls back to a weaker or different model.

## Optional lanes

- **OpenRouter (off by default).** OpenRouter has no Anthropic-format endpoint, so a lane needs a local translator that serves `/v1/messages` — musistudio/claude-code-router or a version-pinned LiteLLM — with `ANTHROPIC_BASE_URL` pointed at it. That is one extra long-running local process, which is why it is documented rather than shipped. Expect roughly a 5.5% credit fee on top of provider list prices. If you build it, model it as another gateway provider in `flex-providers.ts`.
- **Local via Ollama (planned).** Ollama serves an Anthropic-compatible API since v0.14, so a `local` gateway provider pointed at it is the natural next lane: full compute control, zero per-token cost, your hardware. Not wired in yet.

## Adding a gateway provider

Any lab that serves an Anthropic-compatible `/v1/messages` endpoint can become a gateway lane. The runner, parser, and preflight branch on `isGatewayProvider`, so no `switch` needs a new case.

1. Add the provider name to `GATEWAY_PROVIDERS` in `plugins/pstack/skills/poteto-mode/scripts/runner/types.ts`.
2. Add its row to `GATEWAY_SPECS` in `runner/flex-providers.ts`: API key variable, base URL default, override variables, and context-window default. Typecheck fails until this row exists.
3. Add its row to the "Flex model matrix" in `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md`. `model-matrix.test.ts` fails until the key variable and base URL match the spec.
4. Add its probe row to the table in `plugins/pstack/skills/setup-pstack/SKILL.md`, its variables to the gateway environment reference above, and its prices to the price table.
5. Run the live validation checklist below for the new lane before merging.

## Live validation checklist (post-merge, real keys, never in CI)

- V1: one DeepSeek probe through the runner (`--provider deepseek --model deepseek-flash --effort high`, read-only). Expect a `complete` receipt with `costUsd: null`; record the `reportedModel` string and confirm the base-URL default against DeepSeek's current guide; confirm `--effort` is accepted end-to-end.
- V2: same for MiniMax (`MiniMax-M3`); record the served-model casing.
- V3: run `claude auth status --json` inside a fresh flex config dir with `ANTHROPIC_AUTH_TOKEN` set and record the output here. On macOS, confirm whether `claude login` under an explicit `CLAUDE_CONFIG_DIR` writes `.credentials.json` or the Keychain.
- V4: the zero-subscription walkthrough above, end to end, on a machine with no stored provider logins.
- V5: OAuth guard live: `claude login` inside a scratch flex config dir, run a lane, confirm the refusal receipt, then delete that login.
