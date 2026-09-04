#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$ROOT/plugins/pstack/skills/poteto-mode/SKILL.md"
REFERENCE="$ROOT/plugins/pstack/skills/poteto-mode/references/conductor-dispatch.md"

test -f "$REFERENCE"
grep -Fq 'PSTACK_WORKER=1' "$SKILL"
grep -Fq '.conductor/poteto-mode.json' "$SKILL"
grep -Fq 'references/conductor-dispatch.md' "$SKILL"
grep -Fq 'mode` is `conductor' "$REFERENCE"
grep -Fq 'CONDUCTOR_SESSION_ID' "$REFERENCE"
grep -Fq 'one isolated Conductor workspace' "$REFERENCE"

if grep -Fq 'scripts/runner/pstack-runner' "$REFERENCE"; then
  printf 'Conductor dispatch must not invoke the legacy runner\n' >&2
  exit 1
fi
