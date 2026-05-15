#!/usr/bin/env bash
set -euo pipefail

SKIP_INSTALL=0
RUN_BROWSER_SETUP=0
CHECK_ONLY=0

for arg in "$@"; do
	case "$arg" in
		--skip-install)
			SKIP_INSTALL=1
			;;
		--with-browser-setup)
			RUN_BROWSER_SETUP=1
			;;
		--skip-browser-setup)
			RUN_BROWSER_SETUP=0
			;;
		--check-only)
			SKIP_INSTALL=1
			RUN_BROWSER_SETUP=0
			CHECK_ONLY=1
			;;
		-h|--help)
			echo "Usage: ./scripts/linux/setup.sh [--skip-install] [--with-browser-setup] [--check-only]"
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

if [[ "$RUN_BROWSER_SETUP" -eq 1 ]]; then
	bun run setup:browsers
else
	echo "Skipping optional Playwright browser setup. Run with --with-browser-setup to install Chromium."
fi

if [[ "$CHECK_ONLY" -eq 0 && -d .git && -d .githooks ]]; then
	git config core.hooksPath .githooks
elif [[ "$CHECK_ONLY" -eq 0 ]]; then
	echo "Skipping git hook setup outside a full git checkout."
fi

bun run typecheck
bun test __tests__/run-bash-windows.test.ts __tests__/cli-args.test.ts __tests__/startup-actions.test.ts

echo "ORPHEUS Linux setup complete."
echo "Start it with: ./scripts/linux/run.sh"
