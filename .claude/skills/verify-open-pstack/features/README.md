# Maintained feature map

`registry.json` is the machine-readable ownership map. `core.ts` supports exact paths and terminal `/**` only. Unknown paths fail closed; rename classification includes both paths. Runtime markdown, references, playbooks, hooks, manifests, and scripts are runtime, even when the extension is `.md`.

| Ownership | Required real surfaces |
| --- | --- |
| `skills` | One `skill-invocation:<name>` exercise per selected skill, in both harnesses |
| `shared` | All listed skills, setup, runner, shipped tools in both harnesses |
| `setup` | Installed setup/model configuration |
| `runner` | Installed parent invoking real configured provider lanes |
| `tools` | Installed parent invoking the changed shipped CLI |
| `project` | Native discovery/invocation of this verifier in both harnesses |
| `nonRuntime` | Explicit ordinary repository documentation/non-shipped assets/unit-test paths; no plugin harness launch |

Shipped `plugins/pstack/assets/**` belongs to `shared`: even a logo-only change requires both installed harness surfaces, not the no-runtime lane. `bootstrap.ts` belongs to `tools`; exercise its actual consumers, `orch` and `watch-pr`, including dependency bootstrapping rather than the unrelated external runner.

Skill-owned `SKILL.md`, `references/**`, and `playbooks/**` select their skill. Additional executable paths must be registered explicitly. Shared consumed mappings select every dependent skill conservatively. The coverage test inventories all tracked plugin files; new unmapped files block CI and runs. Deleted skill surfaces cannot silently disappear from evidence: choose a surviving documented entry point demonstrating the intended removal, or report blocked.

The four documents below define sub-features, user entry points, driving instructions, and gotchas. Review each changed sub-feature in the diff; one aggregate observation cannot replace distinct selected skills. Record all changed sub-feature actions in the feature's transcript and artifact. Do not run destructive application work in the maintainer checkout.

- `skill-invocation.md`: installed native skills, principle leaves, and project-skill self-test.
- `setup.md`: setup/routing/model configuration.
- `runner.md`: parent-to-child provider dispatch and receipts.
- `shipped-tools.md`: orchestration, watch, plan checks, audit, and evidence logging.

Consumed `AGENTS.md`/`CLAUDE.md` instructions and `tests/skill-collision-repro.sh` select `project-skill`. There are no blanket no-runtime exemptions for `.github/**`, `tests/**`, or `scripts/**`: unregistered instruction/enforcement paths fail closed until their runtime ownership is reviewed and mapped.

Explicit non-runtime repository changes are `no runtime change`. Changes to this verifier always select `project-skill`; they cannot bypass native proof. `--self-test` also selects that exercise, deduplicated in each harness, and is mandatory for this skill's delivery PR. Plugin-runtime proof and local CLI proof remain separate.
