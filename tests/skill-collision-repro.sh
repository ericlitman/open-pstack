#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

note() { printf '%s\n' "$*"; }

legacy_command_dir="$repo/plugins/pstack/commands"
if [ -e "$legacy_command_dir" ]; then
  note "FAIL: legacy command layer still exists: $legacy_command_dir"
  find "$legacy_command_dir" -mindepth 1 -print 2>/dev/null || true
  fail=1
else
  note "ok: native skills are the only user-facing workflow surface"
fi

bad_principle=""
for skill in "$repo"/plugins/pstack/skills/principle-*/SKILL.md; do
  if [ ! -f "$skill" ]; then
    bad_principle="no principle-* leaves found"$'\n'
    break
  fi
  front="$(sed -n '2,/^---$/p' "$skill")"
  printf '%s\n' "$front" | grep -q '^user-invocable: false$' || bad_principle="$bad_principle$skill (missing user-invocable: false)"$'\n'
  printf '%s\n' "$front" | grep -q '^disable-model-invocation: true$' && bad_principle="$bad_principle$skill (still carries disable-model-invocation)"$'\n'
done
if [ -n "$bad_principle" ]; then
  note "FAIL: principle-* leaves must be user-invocable: false and model-readable:"
  note "$bad_principle"
  fail=1
else
  note "ok: all principle-* leaves request user-hidden and remain model-readable"
fi

verof() { { grep -m1 '"version"' "$1" || true; } | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
vc="$(verof "$repo/plugins/pstack/.claude-plugin/plugin.json")"
vx="$(verof "$repo/plugins/pstack/.codex-plugin/plugin.json")"
vm="$(verof "$repo/.claude-plugin/marketplace.json")"
vu="$(sed -n 's/| open-pstack version | `\([^`]*\)` |/\1/p' "$repo/UPSTREAM.md")"
if [ -n "$vc" ] && [ "$vc" = "$vx" ] && [ "$vc" = "$vm" ] && [ "$vc" = "$vu" ]; then
  note "ok: open-pstack version matches across UPSTREAM.md and the 3 manifests ($vc)"
else
  note "FAIL: open-pstack version differs: upstream=$vu claude-plugin=$vc codex-plugin=$vx marketplace=$vm"
  fail=1
fi

# Active configuration must use Claude's rolling family aliases. Concrete
# provider reports may still appear in runner fixtures, but no shipped
# descriptor, native-agent model field, or live test invocation may pin one.
legacy_model_pins="$(
  grep -REn \
    --include='*.md' --include='*.ts' --include='*.sh' \
    'claude:claude-(fable|opus)-[0-9]|^model: claude-(fable|opus)-[0-9]|--model claude-(fable|opus)-[0-9]' \
    "$repo/plugins/pstack" "$repo/tests" "$repo/README.md" "$repo/docs/reference.md" \
    2>/dev/null || true
)"
standalone_code_pins="$(
  grep -REn \
    --include='*.ts' --include='*.js' \
    --exclude='*.test.ts' --exclude='*.test.js' \
    "['\"]claude-(fable|opus)-[0-9]" \
    "$repo/plugins/pstack" \
    2>/dev/null || true
)"
if [ -n "$legacy_model_pins" ] || [ -n "$standalone_code_pins" ]; then
  note "FAIL: active Fable or Opus configuration still pins a model revision:"
  [ -z "$legacy_model_pins" ] || note "$legacy_model_pins"
  [ -z "$standalone_code_pins" ] || note "$standalone_code_pins"
  fail=1
else
  note "ok: active Fable and Opus configuration uses rolling aliases"
fi

# Static invariant (CHANGES maintenance note): provider-dispatch owns the default
# provider/model quad and the four panel skills plus setup-pstack copy it verbatim.
setup="$repo/plugins/pstack/skills/setup-pstack/SKILL.md"
dispatch="$repo/plugins/pstack/skills/poteto-mode/references/provider-dispatch.md"
quad_of() { { grep -oE '(claude|codex|grok):[a-z0-9.-]+@(low|medium|high|xhigh|max)' || true; } | tr '\n' ' ' | sed 's/ $//'; }
canon_quad="$(awk '
  $0 == "## Model matrix" { in_matrix = 1; next }
  in_matrix && /^## / { exit }
  in_matrix && /^\|/ {
    line = $0
    sub(/^\|/, "", line)
    sub(/\|$/, "", line)
    n = split(line, cells, "|")
    for (i = 1; i <= n; i++) {
      gsub(/^ +| +$/, "", cells[i])
      gsub(/`/, "", cells[i])
    }
    family = cells[1]
    if (family == "Family" || family ~ /^:?-+:?$/) next
    provider = cells[3]
    model = cells[4]
    effort = cells[5]
    if (out != "") out = out " "
    out = out provider ":" model "@" effort
  }
  END { print out }
' "$dispatch")"
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

plugin="$repo/plugins/pstack"
canon="$plugin/skills/poteto-mode/references/bugbot-triage.md"
skill="$plugin/skills/babysit/SKILL.md"
playbook="$plugin/skills/poteto-mode/playbooks/babysit.md"
bugbot_skill_rel="../poteto-mode/references/bugbot-triage.md"
bugbot_playbook_rel="../references/bugbot-triage.md"
bugbot_bad=""
if [ ! -f "$canon" ]; then
  bugbot_bad="${bugbot_bad}canonical rubric missing: $canon"$'\n'
fi
skill_op="$(grep -F 'Review-bot comments (Bugbot and similar automation):' "$skill" || true)"
skill_n="$(printf '%s\n' "$skill_op" | awk 'NF { c++ } END { print c+0 }')"
if [ "$skill_n" != "1" ]; then
  bugbot_bad="${bugbot_bad}standalone babysit skill lost bugbot-triage operational line"$'\n'
else
  skill_dest="$(printf '%s\n' "$skill_op" | sed -n 's/.*](\([^)]*\)).*/\1/p')"
  if [ "$skill_dest" != "$bugbot_skill_rel" ]; then
    bugbot_bad="${bugbot_bad}standalone babysit Markdown destination is [$skill_dest], not [$bugbot_skill_rel]"$'\n'
  fi
  if ! printf '%s\n' "$skill_op" | grep -Fq 'classify as fix, dismiss, or ask'; then
    bugbot_bad="${bugbot_bad}standalone babysit lost fix/dismiss/ask classification"$'\n'
  fi
  if ! printf '%s\n' "$skill_op" | grep -Fq "Follow the rubric's Ask by default categories, including security, data, and high-severity findings."; then
    bugbot_bad="${bugbot_bad}standalone babysit lost ask-by-default escalation"$'\n'
  fi
fi
playbook_op="$(grep -E '^8\. \*\*Bugbot is triaged skeptically, always\.\*\*' "$playbook" || true)"
playbook_n="$(printf '%s\n' "$playbook_op" | awk 'NF { c++ } END { print c+0 }')"
if [ "$playbook_n" != "1" ]; then
  bugbot_bad="${bugbot_bad}poteto-mode babysit playbook lost step-8 Bugbot operational line"$'\n'
elif ! printf '%s\n' "$playbook_op" | grep -Fq "$bugbot_playbook_rel"; then
  bugbot_bad="${bugbot_bad}poteto-mode babysit playbook step 8 lost bugbot-triage binding ($bugbot_playbook_rel)"$'\n'
fi
copies="$(find "$plugin" -name 'bugbot-triage.md' ! -path '*/node_modules/*' -print 2>/dev/null || true)"
n="$(printf '%s\n' "$copies" | awk 'NF { c++ } END { print c+0 }')"
if [ "$n" != "1" ]; then
  bugbot_bad="${bugbot_bad}expected exactly 1 bugbot-triage.md under plugin, found $n"$'\n'
fi
if [ -n "$bugbot_bad" ]; then
  note "FAIL: babysit Bugbot binding on the packaged plugin"
  note "$bugbot_bad"
  fail=1
else
  note "ok: babysit Bugbot binding on the packaged plugin"
fi

if [ "${PSTACK_STATIC_ONLY:-0}" = "1" ]; then
  exit "$fail"
fi

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/.claude-plugin" "$scratch/skills/foo"
printf '%s\n' '{"name": "testplug", "version": "0.0.1", "description": "native skill repro"}' \
  > "$scratch/.claude-plugin/plugin.json"
cat > "$scratch/skills/foo/SKILL.md" <<'EOF'
---
name: foo
description: collision test skill
---

Say exactly: SKILL-RAN
Then stop. Do not invoke any skill or tool.
EOF

run() {
  claude -p --plugin-dir "$scratch" --model fable --effort max --max-turns 3 "$1" < /dev/null 2>&1
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

check "model-initiated Skill-tool invocation" "SKILL-RAN" "$(run "$invoke")"
check "user /testplug:foo invocation" "SKILL-RAN" "$(run '/testplug:foo')"

exit "$fail"
