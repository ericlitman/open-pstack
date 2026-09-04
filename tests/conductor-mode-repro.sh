#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$ROOT/plugins/pstack/skills/poteto-mode/SKILL.md"
REFERENCE="$ROOT/plugins/pstack/skills/poteto-mode/references/conductor-dispatch.md"
SETUP="$ROOT/plugins/pstack/skills/setup-pstack/SKILL.md"
POTETO_AGENT="$ROOT/plugins/pstack/agents/poteto-agent.md"

test -f "$REFERENCE"
grep -Fq 'PSTACK_WORKER=1' "$SKILL"
grep -Fq '.conductor/poteto-mode.json' "$SKILL"
grep -Fq 'references/conductor-dispatch.md' "$SKILL"
grep -Fq 'mode` is `conductor' "$REFERENCE"
grep -Fq 'CONDUCTOR_SESSION_ID' "$REFERENCE"
grep -Fq 'one isolated Conductor workspace' "$REFERENCE"
grep -Fq 'whoami' "$REFERENCE"
grep -Fq 'list_models' "$REFERENCE"
grep -Fq 'create_workspace' "$REFERENCE"
grep -Fq 'without an initial message' "$REFERENCE"
grep -Fq 'list_project_workspaces' "$REFERENCE"
grep -Fq 'list_workspace_sessions' "$REFERENCE"
grep -Fq 'get_session' "$REFERENCE"
grep -Fq 'send_message' "$REFERENCE"
grep -Fq 'get_session_status' "$REFERENCE"
grep -Fq 'list_messages' "$REFERENCE"
grep -Fq 'cancel_session' "$REFERENCE"
grep -Fq 'archive_workspace' "$REFERENCE"
grep -Fq 'pstack-conductor' "$REFERENCE"
grep -Fq '.conductor/poteto-mode.json' "$SETUP"
grep -Fq 'pstack-conductor policy validate' "$SETUP"
grep -Fq 'PSTACK_WORKER=1' "$POTETO_AGENT"

for name in arena architect how interrogate reflect swarm; do
  grep -Fq 'parent-selected Poteto dispatch reference' \
    "$ROOT/plugins/pstack/skills/$name/SKILL.md"
done

if grep -REq --include='*.ts' \
  'https://api\.conductor\.build|Authorization:|CONDUCTOR_API_KEY' \
  "$ROOT/plugins/pstack/skills/poteto-mode/scripts/conductor"; then
  printf 'Conductor helper code must not make network calls or read credentials\n' >&2
  exit 1
fi

if grep -Fq 'scripts/runner/pstack-runner' "$REFERENCE"; then
  printf 'Conductor dispatch must not invoke the legacy runner\n' >&2
  exit 1
fi
