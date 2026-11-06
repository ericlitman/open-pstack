# open-pstack

[![CI](https://github.com/ericlitman/open-pstack/actions/workflows/ci.yml/badge.svg)](https://github.com/ericlitman/open-pstack/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/ericlitman/open-pstack)](https://github.com/ericlitman/open-pstack/releases/latest)
[![MIT license](https://img.shields.io/github/license/ericlitman/open-pstack)](LICENSE)

**Open Pstack brings [Lauren Tan (@poteto)](https://x.com/poteto)'s [pstack](https://github.com/cursor/plugins/tree/main/pstack) to Claude Code and Codex.** Its job is to stay as close to her original work as possible while translating the parts that depend on Cursor.

Lauren built pstack from the skills she uses to ship code at Cursor. In a [55-minute interview with Denis Labelle](https://x.com/DenisLabelle/status/2091337807939706928), she says that she shipped 1,000 pull requests in one month after steadily improving how her agents work and verify their results.

> If you want to go fast, go deep first.

Open Pstack is an unofficial community project. In Cursor, use [Lauren's original pstack](https://github.com/cursor/plugins/tree/main/pstack). In Codex, use Open Pstack. In Claude Code, you have two choices. Lauren's `pstack@cursor-plugins` has Claude models only and runs the Grok and GPT roles on the session's Claude model. Open Pstack also runs in Codex, and runs other providers' models through their own command-line tools. Install only one of the two in Claude Code, because both use the `pstack:` prefix.

## What Open Pstack adds

Compared with Lauren's pstack, Open Pstack adds:

- **A model and provider registry.** Models, efforts and providers live in one typed [registry](plugins/pstack/skills/poteto-mode/scripts/runner/registry/). The [model catalog](plugins/pstack/skills/poteto-mode/references/model-catalog.md) and the Claude-native agent files are generated from it, and the skills point at the catalog's role defaults instead of naming models. A new model is one registry entry. A new command-line provider is one adapter module and one line in the provider list. See the [design](docs/plans/2026-10-11-model-provider-registry.md).
- **One skill tree for Claude Code and Codex.** Both apps read the same skills, and one [reference](plugins/pstack/skills/poteto-mode/references/codex-tools.md) maps how each app starts them. Lauren's pstack does not run in Codex. See [Claude Code and Codex](#claude-code-and-codex) below.
- **Models from other providers.** Claude Code and Codex hand work to other providers' models through each provider's own command-line tool, started by one [runner](plugins/pstack/skills/poteto-mode/references/provider-dispatch.md). The runner supports nine providers. Claude, Codex and Grok run lanes that read or write files. Devin, DeepSeek Harness, Antigravity, OpenCode, Amp and Cursor CLI run read-only lanes. The model catalog's [routes table](plugins/pstack/skills/poteto-mode/references/model-catalog.md#routes) lists how each one starts. Each run leaves a receipt with the exact model flags and, where the provider reports it, the model that answered. Every provider except Claude and Codex gets only an allowlisted environment. A Claude lane that writes files runs in Claude Code's Bash sandbox, with writes to the shared Git directory denied. A model that cannot run fails visibly; the runner never switches to a weaker model.
- **A checked model sheet.** [`setup-pstack`](plugins/pstack/skills/setup-pstack/SKILL.md) records each role as `provider:model@effort`, asks for one effort per model family, and probes each chosen model before it saves anything. A rerun that changes nothing keeps the sheet without asking again.
- **Three-model panels.** `arena`, `architect` and `interrogate` default to Opus, Sol and Grok. Lauren's pstack defaults to Opus 5.5 and Grok; Open Pstack keeps three ([UPSTREAM.md](UPSTREAM.md)).
- **Changes tested where they run.** Before a change merges, the exact candidate is installed in each app it affects and the changed behavior is tested there. The pull request records the result ([AGENTS.md](AGENTS.md)).

## What pstack does

pstack is a plugin for coding agents. It is not a new model or a hosted service. It gives your agent engineering rules, step-by-step workflows for different kinds of work, focused skills, and small local tools.

The normal entry point is `poteto-mode`. You give it a task in plain language. It then:

- reads the task and chooses a workflow that fits;
- learns how the current system works before changing it;
- compares designs when the choice matters;
- favors small, simple changes over extra machinery;
- asks several models to challenge important decisions when useful;
- runs the code and checks real behavior instead of stopping at “the tests pass”; and
- carries the work through review, continuous integration (CI), and a ready-to-merge pull request when asked.

![How pstack routes a task through focused skills, real-app proof, and a review-ready pull request](assets/pstack-workflow.png)

pstack does not ask you to trust an agent on day one. It helps the agent leave evidence you can inspect. Start with supervised work. Let it run more work in parallel only after its checks have earned that trust in your own repositories.

## Install

You need a current Claude Code or Codex installation. For the default three-model review, install and authenticate the Claude Code, Codex, and Grok command-line tools. [Bun](https://bun.sh) runs the small local tool that starts models outside the app you are using. You can still use the core workflows with fewer models. You need another provider's command-line tool only when your model sheet assigns that provider.

### Claude Code

Run these commands inside Claude Code:

```text
/plugin marketplace add ericlitman/open-pstack
/plugin install pstack@open-pstack
/reload-plugins
```

Claude Code leaves auto-update off for third-party marketplaces, so Open Pstack stays on the version you installed. To turn it on, run `/plugin`, open the **Marketplaces** tab, select `open-pstack`, and choose **Enable auto-update**. To update once by hand, run `claude plugin update pstack@open-pstack`.

### Codex

Run these commands in your shell:

```shell
codex plugin marketplace add ericlitman/open-pstack --ref main
codex plugin add pstack@open-pstack
```

Turn on Codex subagents in `~/.codex/config.toml` so pstack can compare work in parallel:

```toml
[features]
multi_agent = true
```

Start a new Codex task after installation so it can discover the new skills and setting.

## Get started

Lauren's original setup has two steps. Open Pstack keeps the same flow.

### 1. Set up the models

In Claude Code, run:

```text
/pstack:setup-pstack
```

In Codex, ask:

```text
Use pstack:setup-pstack to configure pstack.
```

Setup checks the role assignments, shows how each model will start, and probes each assigned model before saving. The default review panel uses Opus, Sol and Grok. The [model catalog](plugins/pstack/skills/poteto-mode/references/model-catalog.md) lists every other choice.

The first run asks before saving. A rerun also asks when you name a change, or when it finds an invalid sheet or a choice only you can make. A failed probe stops setup before it saves anything. A rerun that changes nothing prints what it kept and saves without asking. After its smoke test, setup offers to generate a verification skill when the project has no way to drive the real app for proof, and a formal verification skill when it has none. A rerun that changes nothing only mentions each offer.

### 2. Use poteto-mode

Start any task that needs careful engineering with `poteto-mode`.

In Claude Code:

```text
/pstack:poteto-mode Add saved filters to search. Keep the design simple, verify it in the real app, and open a pull request.
```

In Codex:

```text
Use pstack:poteto-mode. Add saved filters to search. Keep the design simple, verify it in the real app, and open a pull request.
```

For that feature, poteto-mode should first understand how search works today. It should decide how the data should be represented before writing code, implement the smallest complete version, run the feature the way a user would, review the result, and prepare the pull request.

That is the main workflow. The other skills are there when poteto-mode needs them or when you want to call one directly.

## Useful skills

| Skill | Use it when |
| --- | --- |
| `how` | You want a clear explanation of how part of the system works. |
| `why` | You want evidence for why the system was built that way. |
| `architect` | A change crosses a function or module boundary and the design needs to be settled first. |
| `arena` | You want several complete attempts, followed by a comparison of their best parts. |
| `interrogate` | You want different models to try to break a design or diff. |
| `create-verification-skill` | Your project has no repeatable way for an agent to prove real behavior. |
| `maintain-verification-skill` | The project's verification instructions no longer match the product. |
| `create-formal-verification-skill` | A race, an invariant, or another property needs a proof that tests rarely reach. |
| `maintain-formal-verification-skill` | The code a formal verification covers has changed, and you need to know whether a failure is drift or a bug. |
| `babysit` | A pull request needs CI failures and review comments handled until it is ready. |
| `reflect` | A hard task is finished and its lessons should improve the next run. |
| `correct` | Agents keep making the same mistake in a repository and you want a check that stops it. |
| `poteto-help` | You want to know which skill, playbook, or principle fits a question. |
| `in-your-own-words` | You want the agent to restate your goal and the problem before it starts. |
| `sharpen` | You want a prompt rewritten deeper, not bigger, before you send it. It returns the rewritten prompt and does not do the task. |

Plugin skills include `pstack:` in their name. In Claude Code, invoke a native skill such as `/pstack:architect`. In Codex, ask for the skill, such as `Use pstack:architect for this design.` See the [technical reference](docs/reference.md) for the full list.

## Models and token use

Some pstack workflows use one model. Skills such as `architect`, `arena`, and `interrogate` can run several models in parallel. Each model run uses the account and allowance of the tool that runs it.

`setup-pstack` lets you choose the models, one requested effort per model family you assign, and how many run in parallel. A model from the app you are using runs inside that app. Other models run through their own command-line tools, as the [routes table](plugins/pstack/skills/poteto-mode/references/model-catalog.md#routes) shows. Open Pstack does not quietly replace a failed model with a weaker one.

## Claude Code and Codex

Both apps read the same pstack skills. Only the way they start those skills and models is different.

| | Claude Code | Codex |
| --- | --- | --- |
| Start poteto-mode | Claude loads a small startup instruction that can route non-trivial work into it. You can also run `/pstack:poteto-mode` yourself. | Ask for `pstack:poteto-mode` by name. Codex does not load the Claude startup instruction. |
| Runs inside the app | Claude models stay inside Claude Code. | Codex models, such as Sol, stay inside Codex. |
| Other models | Codex, Grok and the other external providers run through their command-line tools ([routes](plugins/pstack/skills/poteto-mode/references/model-catalog.md#routes)). | Claude, Grok and the other external providers run through their command-line tools ([routes](plugins/pstack/skills/poteto-mode/references/model-catalog.md#routes)). |
| Skills and workflows | Shared with Codex. | Shared with Claude Code. |

The other providers take part only through the runner. Open Pstack itself runs inside Claude Code or Codex.

## Learn from the original

Lauren's [pstack guide](https://github.com/cursor/plugins/tree/main/pstack/docs/guide) walks through a real task, verification, and longer unattended runs. It uses Cursor's interface, but the ideas are the same. Use the translated skill invocations above in Claude Code or Codex.

This repository also keeps:

- [the original README](README-UPSTREAM.md), unchanged;
- [the technical reference](docs/reference.md) for every skill, dependency, and Claude Code or Codex detail;
- [the upstream sync record](UPSTREAM.md) and update process;
- [the change record](CHANGES.md) for every adaptation; and
- [the attribution record](NOTICE.md) for pstack and the imported Cursor Team Kit skills.

## Staying close to Lauren's pstack

Open Pstack 1.17.0 tracks pstack 0.15.36 at Cursor commit [`2776ddd2355d6d6c8747d3964600f28daf62f049`](https://github.com/cursor/plugins/commit/2776ddd2355d6d6c8747d3964600f28daf62f049).

The two projects have separate version numbers. The pstack version identifies Lauren's upstream content. The Open Pstack version identifies the Claude Code and Codex package built from it.

In this repository, “upstream” means Lauren's original pstack. Open Pstack does not promise instant updates. It records the exact version it follows and each upstream change it leaves out in [UPSTREAM.md](UPSTREAM.md), reviews new changes in order, and describes its adaptations in [CHANGES.md](CHANGES.md). New pstack behavior belongs in Lauren's project first whenever possible.

## Contributing

Fixes for Claude Code or Codex and help bringing over new pstack releases are welcome. Search [GitHub Issues](https://github.com/ericlitman/open-pstack/issues) before opening a new issue. For larger behavior changes, explain why the change belongs in Open Pstack instead of Lauren's original project.

Read [UPSTREAM.md](UPSTREAM.md) before changing content brought over from Lauren's pstack. Pull requests must keep one shared skill tree for Claude Code and Codex and pass the repository's tests, type checks, plugin validation, and static checks.

## License

MIT. pstack was created by Lauren Tan. Open Pstack builds on Michael Denyer's [pstack-claude](https://github.com/michael-denyer/pstack-claude) port and includes attributed MIT-licensed work from Cursor Team Kit and Superpowers. See [NOTICE.md](NOTICE.md) and the preserved license files for details.
