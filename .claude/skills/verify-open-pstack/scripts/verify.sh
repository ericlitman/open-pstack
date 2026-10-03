#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v bun >/dev/null || { printf '%s\n' 'Bun is required; no fallback runtime.' >&2; exit 1; }
if [[ ! -d "$HERE/node_modules/typescript" ]]; then
  (cd "$HERE" && bun install --frozen-lockfile --ignore-scripts)
fi
exec bun "$HERE/scripts/cli.ts" "$@"
