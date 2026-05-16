#!/usr/bin/env bash

# Git hooks may run without the user's interactive shell profile.
# Add common Bun install locations before invoking repository scripts.
if [ -n "${BUN_INSTALL:-}" ] && [ -x "$BUN_INSTALL/bin/bun" ]; then
	export PATH="$BUN_INSTALL/bin:$PATH"
elif [ -x "$HOME/.bun/bin/bun" ]; then
	export PATH="$HOME/.bun/bin:$PATH"
fi

