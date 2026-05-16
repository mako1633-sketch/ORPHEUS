# ORPHEUS Local Enhancement Scripts

This directory contains the local enhancement tooling that powers ORPHEUS's
operational awareness, preflight validation, and automated workflows.

These scripts are meant to live on `PATH` (e.g. via the ORPHEUS enhancement
install process, or by symlinking this directory into `~/.local/bin`).

## Scripts

| Script | Purpose | Language |
|--------|---------|----------|
| `preflight-git` | Pre-push safety checks for git repos | Bash |
| `workflow` | Multi-step automation engine (test → lint → build → push) | Bash |
| `suggest-next` | Proactive context engine: suggests next actions based on repo state | Python 3 |
| `project-registry` | Auto-detects project type and stores per-project preferences | Bash |

## Usage

### preflight-git — Pre-flight Checks

Run before any push, clone, or GitHub operation to avoid auth loops or broken
remotes.

```bash
preflight-git
```

By default, **warnings do not block** the pipeline:
- Missing SSH agent on an HTTPS remote → *warning, exit 0*
- Remote unreachable → *error, exit 1*

If you want warnings to be treated as blockers (CI mode):

```bash
preflight-git --strict   # exits 2 on warnings
```

| Exit Code | Meaning |
|-----------|---------|
| 0 | All clear (or warnings only, non-strict) |
| 1 | Error(s) — do not proceed |
| 2 | Warning(s) — strict mode only |

### workflow — Automation Engine

Define and run reusable multi-step command chains:

```bash
workflow list                       # Show all workflows
workflow show deploy-safe           # Display a workflow
workflow run deploy-safe            # Execute it
workflow refresh                    # Rebuild built-ins for current project
```

Built-in workflows are **project-type aware**: when run inside a repo with
`bun.lock` / `package.json`, the steps resolve to `bun test`, `bun run lint`,
etc. For Python repos they resolve to `pytest`, `ruff`, etc.

### suggest-next — Proactive Suggestions

Analyzes the current project and suggests the highest-priority next actions:

```bash
suggest-next                        # Interactive mode
suggest-next --auto                 # Execute top suggestion automatically
suggest-next --quiet                # JSON output for scripting
suggest-next --no-input            # Never prompt (for non-interactive callers)
```

It checks for:
- Uncommitted changes (and how many staged/unstaged)
- Commits behind origin
- Outdated dependencies
- Pending ORPHEUS tasks (and stale tasks >48h)
- Security issues (world-writable files, un-gitignored .env files)

### project-registry — Project Intelligence

Auto-detects project type and stores per-project command preferences:

```bash
project-registry detect             # Auto-detect and register current directory
project-registry list               # Show all registered projects
project-registry info Orpheus       # Show stored preferences for a project
```

The registry is read by `workflow refresh` to generate project-aware pipeline
steps.

## Project-Aware Command Resolution

When `workflow` generates built-in workflows, it uses this resolution order:

1. **project-registry** — Looks up the registered project and reads stored
   `test_cmd`, `build_cmd`, `lint_cmd`.
2. **File-system detection** (fallback):
   - `bun.lock` / `bun.lockb` → `bun test`, `bun run build`, `bun run lint`
   - `package.json` (only) → `npm test`, `npm run build`, `npm run lint`
   - `pyproject.toml` / `requirements.txt` → `pytest`, `python -m build`, `ruff`
   - `go.mod` → `go test ./...`, `go build`

## Integration with `orpheus-startup`

These scripts are invoked during the ORPHEUS startup protocol:
- `health-check` validates that required tools (git, python3, bun) are present
- `preflight-git` runs before git operations in `deploy-safe`
- `suggest-next --no-input` feeds the launch briefing with actionable items
- `workflow refresh` regenerates project-specific steps when project type changes

## Changelog

### 2026-05-16
- `preflight-git`: warnings now exit `0` by default. Added `--strict` flag.
- `workflow`: built-ins are now project-type aware (reads `bun.lock`, `go.mod`, `pyproject.toml`).
- `suggest-next`: added `--no-input` + `isatty()` auto-detection, stale-task heuristics, pending backlog suggestions.
- `project-registry`: added `bun` type detection, auto-reads `package.json` scripts.
