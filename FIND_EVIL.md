# ORPHEUS FIND EVIL Submission

ORPHEUS is prepared for FIND EVIL as a Custom MCP Server that exposes typed,
read-only SIFT disk-image triage tools to an autonomous agent. The goal is to
make the agent behave more like a senior incident responder: preserve evidence,
sequence tools deliberately, record every step, and self-correct when an early
assumption such as a partition offset is wrong.

## What It Does

- Wraps SIFT/Sleuth Kit commands as typed MCP tools instead of exposing an open
  shell.
- Accepts the case image through `ORPHEUS_FIND_EVIL_IMAGE`; large evidence is
  never committed to git.
- Writes every generated artifact under `find-evil-runs/<case-id>/`.
- Appends structured NDJSON execution logs with timestamps, inputs, summaries,
  warnings, artifact paths, and SHA-256 hashes.
- Produces a final Markdown findings summary from the execution trace.

## How It Is Built

The submission path lives under `src/find-evil/` and runs separately from the
main ORPHEUS terminal UI:

- `find-evil:mcp` starts the HTTP MCP endpoint at `/mcp`.
- `find-evil:validate` checks evidence path, output directory, and SIFT tools.
- `find-evil:demo` runs a repeatable disk-image triage sequence.

The MCP server exposes seven tools: `hash_evidence`, `inspect_partitions`,
`list_files`, `extract_file_metadata`, `build_timeline`, `search_indicators`,
and `summarize_findings`.

## Challenges

The main tradeoff is scope. SIFT has hundreds of tools, but a broad wrapper
would make the trust boundary fuzzy. This submission starts with a small typed
core so judges can inspect the safety model and reproduce the workflow.

## What We Learned

Autonomy is only useful in incident response when it is paired with evidence
discipline. ORPHEUS logs the chain from tool call to artifact so every claim can
be traced back to a concrete command result.

## What's Next

- Add typed wrappers for selected Volatility and log-parsing workflows.
- Add automatic offset retry when `fls` or `mactime` fails after partition
  discovery.
- Add benchmark cases with ground-truth scoring across false positives, missed
  artifacts, and unsupported claims.

## Submission Materials

- Try-it-out instructions: `docs/find-evil/TRY_IT_OUT.md`
- Dataset documentation: `docs/find-evil/DATASET.md`
- Accuracy report: `docs/find-evil/ACCURACY_REPORT.md`
- Architecture: `docs/find-evil/ARCHITECTURE.md`
- Demo script: `docs/find-evil/DEMO_SCRIPT.md`
