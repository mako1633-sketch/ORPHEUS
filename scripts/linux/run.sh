#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if ! command -v bun >/dev/null 2>&1; then
	echo "Bun is required. Install it with: curl -fsSL https://bun.sh/install | bash" >&2
	exit 1
fi

exec bun run src/index.tsx "$@"
