#!/usr/bin/env bash
# Repro and regression check for the command/skill name-collision fix (CHANGES 0.9.7).
#
# The Skill tool resolves a name shared by commands/<name>.md and
# skills/<name>/SKILL.md to the command; disable-model-invocation: true on the
# command flips resolution to the skill. That precedence is UNDOCUMENTED
# upstream, so re-run this after Claude Code upgrades. Last verified on 2.1.195.
#
# Beyond the collision repro, this enforces the static maintenance invariants from
# CHANGES.md: the command/skill/leaf flags, version parity across the three manifests,
# and the default model quad's identity across provider dispatch, the panel skills,
# and setup-pstack. The
# static checks need no CLI; only the behavioral legs below do.
#
# Manual test: the behavioral legs need the claude CLI and API access; four Fable calls.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

note() { printf '%s\n' "$*"; }

legacy_commands="$(find "$repo/plugins/pstack/commands" -type f -name '*.md' -print 2>/dev/null || true)"
if [ -n "$legacy_commands" ]; then
  note "FAIL: legacy command trampolines create duplicate Source Command skills in Codex:"
  note "$legacy_commands"
  fail=1
else
  note "ok: native skills are the only user-facing workflow surface"
fi

# Static invariant: every command trampoline carries the flag.
missing="$(grep -L 'disable-model-invocation: true' "$repo"/plugins/pstack/commands/*.md || true)"
if [ -n "$missing" ]; then
  note "FAIL: commands missing 'disable-model-invocation: true':"
  note "$missing"
  fail=1
else
  note "ok: all commands carry disable-model-invocation: true"
fi

# Mirror invariant (CHANGES 0.9.8): no skill that has a same-named command may
# carry the flag. Every command body is "invoke the skill", so a flagged skill
# makes the Skill tool refuse both the model path and the user-typed /command.
# The command-less principle-* leaves use user-invocable: false instead (0.9.9).
flagged=""
for cmd in "$repo"/plugins/pstack/commands/*.md; do
  skill="$repo/plugins/pstack/skills/$(basename "$cmd" .md)/SKILL.md"
  # Frontmatter only (lines between the opening and closing ---): skill bodies
  # may legitimately mention the flag in prose (automate-me does).
  if [ -f "$skill" ] && sed -n '2,/^---$/p' "$skill" | grep -q '^disable-model-invocation: true$'; then
    flagged="$flagged$skill"$'\n'
  fi
done
if [ -n "$flagged" ]; then
  note "FAIL: skills with a same-named command must not carry 'disable-model-invocation: true':"
  note "$flagged"
  fail=1
else
  note "ok: no command-paired skill carries disable-model-invocation: true"
fi

# Principle invariant (CHANGES 0.9.9): every command-less principle-* leaf carries
# user-invocable: false (hidden from the / menu, read by path from poteto-mode) and
# NOT disable-model-invocation (the pair cancels to a dead skill).
bad_principle=""
for skill in "$repo"/plugins/pstack/skills/principle-*/SKILL.md; do
  front="$(sed -n '2,/^---$/p' "$skill")"
  printf '%s\n' "$front" | grep -q '^user-invocable: false$' || bad_principle="$bad_principle$skill (missing user-invocable: false)"$'\n'
  printf '%s\n' "$front" | grep -q '^disable-model-invocation: true$' && bad_principle="$bad_principle$skill (still carries disable-model-invocation)"$'\n'
done
if [ -n "$bad_principle" ]; then
  note "FAIL: principle-* leaves must carry user-invocable: false and not disable-model-invocation:"
  note "$bad_principle"
  fail=1
else
  note "ok: all principle-* leaves carry user-invocable: false"
fi

# Static invariant (CHANGES maintenance note): the plugin version string is
# duplicated across three manifests and must move together on a bump.
verof() { { grep -m1 '"version"' "$1" || true; } | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
vc="$(verof "$repo/plugins/pstack/.claude-plugin/plugin.json")"
vx="$(verof "$repo/plugins/pstack/.codex-plugin/plugin.json")"
vm="$(verof "$repo/.claude-plugin/marketplace.json")"
if [ -n "$vc" ] && [ "$vc" = "$vx" ] && [ "$vc" = "$vm" ]; then
  note "ok: plugin version matches across the 3 manifests ($vc)"
else
  note "FAIL: plugin version differs across manifests: claude-plugin=$vc codex-plugin=$vx marketplace=$vm"
  fail=1
fi

# Static invariant (CHANGES maintenance note): provider-dispatch owns the default
# provider/model quad and the four panel skills plus setup-pstack copy it verbatim.
# Derive the canonical ordered quad from provider-dispatch and assert every copy
# matches, so a partial model bump fails here instead of drifting silently.
setup="$repo/plugins/pstack/skills/setup-pstack/SKILL.md"
dispatch="$repo/plugins/pstack/skills/poteto-mode/references/provider-dispatch.md"
quad_of() { { grep -oE '(claude|codex|grok):[a-z0-9.-]+@(low|medium|high|xhigh|max)' || true; } | tr '\n' ' ' | sed 's/ $//'; }
canon_quad="$(sed -n '/^The frontier defaults are:/,/^## /p' "$dispatch" | quad_of || true)"
quad_bad=""
[ -n "$canon_quad" ] || quad_bad="could not read the canonical quad from $dispatch"$'\n'
# Anchor on the quad's last slug rather than a hard-coded one, so a model swap in
# setup-pstack cannot leave this check hunting for a slug nobody ships any more.
anchor="${canon_quad##* }"
# arena, architect, and how each state the quad on one line; interrogate lists it
# as one slug per row of its Reviewer A/B/C/D table (upstream #167).
for name in arena architect how; do
  skill="$repo/plugins/pstack/skills/$name/SKILL.md"
  n="$(grep -Fc "$anchor" "$skill" || true)"
  if [ "$n" != "1" ]; then
    quad_bad="$quad_bad$skill: expected exactly 1 default-quad line, found $n"$'\n'
    continue
  fi
  got="$(grep -F "$anchor" "$skill" | quad_of)"
  [ "$got" = "$canon_quad" ] || quad_bad="$quad_bad$skill: [$got] != [$canon_quad]"$'\n'
done
interrogate="$repo/plugins/pstack/skills/interrogate/SKILL.md"
got="$(grep -E '^\| Reviewer [A-Z] \|' "$interrogate" | quad_of)"
[ "$got" = "$canon_quad" ] || quad_bad="$quad_bad$interrogate reviewer table: [$got] != [$canon_quad]"$'\n'
# The setup-pstack role rows must all carry the same quad (excludes the line 24
# "currently available" enumeration, which is a different, longer list by design).
while IFS= read -r line; do
  got="$(printf '%s\n' "$line" | quad_of)"
  [ "$got" = "$canon_quad" ] || quad_bad="$quad_bad$setup role row: [$got] != [$canon_quad]"$'\n'
done < <(grep -E '^(arena runners|arena cross-judge pool|architect runners|interrogate reviewers|how critics):' "$setup")
if [ -n "$quad_bad" ]; then
  note "FAIL: the default model quad is not identical across provider dispatch, the panel skills, and setup-pstack:"
  note "$quad_bad"
  fail=1
else
  note "ok: default model quad identical across provider dispatch + 4 panel skills + setup-pstack ($canon_quad)"
fi

if [ "${PSTACK_STATIC_ONLY:-0}" = "1" ]; then
  exit "$fail"
fi

# Behavioral checks against a minimal colliding plugin.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/.claude-plugin" "$scratch/commands" "$scratch/skills/foo"
printf '%s\n' '{"name": "testplug", "version": "0.0.1", "description": "collision repro"}' \
  > "$scratch/.claude-plugin/plugin.json"
cat > "$scratch/skills/foo/SKILL.md" <<'EOF'
---
name: foo
description: collision test skill
---

Say exactly: SKILL-RAN
Then stop. Do not invoke any skill or tool.
EOF

write_command() { # $1 = extra frontmatter line ("" for none)
  {
    printf -- '---\nname: foo\ndescription: collision test command\n'
    [ -n "$1" ] && printf '%s\n' "$1"
    printf -- '---\n\nSay exactly: CMD-RAN\nThen stop. Do not invoke any skill or tool.\n'
  } > "$scratch/commands/foo.md"
}

run() {
  claude -p --plugin-dir "$scratch" --model claude-fable-5 --effort max --max-turns 3 "$1" < /dev/null 2>&1
}

check() { # $1 label, $2 expected marker, $3 output
  if printf '%s' "$3" | grep -q "$2"; then
    note "ok: $1 -> $2"
  else
    note "FAIL: $1 expected $2, got: $3"
    fail=1
  fi
}

invoke='Call the Skill tool with skill "testplug:foo" exactly once and follow what it says.'

# Precedence detector: without the flag, the command wins. If this check ever
# fails, upstream changed the (undocumented) resolution order — revisit whether
# the flag is still needed rather than treating the fix as broken.
write_command ""
check "collision without flag: Skill tool resolves to command" "CMD-RAN" "$(run "$invoke")"

# The fix: with the flag, the Skill tool reaches the skill...
write_command "disable-model-invocation: true"
check "collision with flag: Skill tool resolves to skill" "SKILL-RAN" "$(run "$invoke")"

# ...and the user-typed command still runs.
check "collision with flag: /command still runs the command" "CMD-RAN" "$(run '/testplug:foo')"

# The 0.9.8 regression: the flag on the SKILL blocks the Skill tool outright,
# so a flagged skill is unreachable even once the command stops shadowing it.
cat > "$scratch/skills/foo/SKILL.md" <<'EOF'
---
name: foo
description: collision test skill
disable-model-invocation: true
---

Say exactly: SKILL-RAN
Then stop. Do not invoke any skill or tool.
EOF
out="$(run "$invoke")"
if printf '%s' "$out" | grep -q 'SKILL-RAN'; then
  note "FAIL: flagged skill unexpectedly ran via Skill tool: $out"
  fail=1
else
  note "ok: flag on the skill blocks Skill-tool invocation (0.9.8 regression guard)"
fi

exit "$fail"
