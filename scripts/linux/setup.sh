#!/usr/bin/env bash
set -euo pipefail

SKIP_INSTALL=0
SKIP_BROWSER_SETUP=0

for arg in "$@"; do
	case "$arg" in
		--skip-install)
			SKIP_INSTALL=1
			;;
		--skip-browser-setup)
			SKIP_BROWSER_SETUP=1
			;;
		-h|--help)
			echo "Usage: ./scripts/linux/setup.sh [--skip-install] [--skip-browser-setup]"
			exit 0
			;;
		*)
			echo "Unknown option: $arg" >&2
			exit 1
			;;
	esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

require_command() {
	local name="$1"
	local hint="$2"
	if ! command -v "$name" >/dev/null 2>&1; then
		echo "$name is required. $hint" >&2
		exit 1
	fi
}

require_command bun "Install Bun with: curl -fsSL https://bun.sh/install | bash"
require_command git "Install Git with your distro package manager."

echo "ORPHEUS Linux setup"
echo "Repo: $REPO_ROOT"
echo "Bun:  $(bun --version)"

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
	bun install
fi

if [[ "$SKIP_BROWSER_SETUP" -eq 0 ]]; then
	bun run setup:browsers
fi

git config core.hooksPath .githooks

bun run typecheck
bun test __tests__/run-bash-windows.test.ts __tests__/cli-args.test.ts __tests__/startup-actions.test.ts

echo "ORPHEUS Linux setup complete."
echo "Start it with: ./scripts/linux/run.sh"
