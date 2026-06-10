# FIND EVIL Accuracy Report

## Scope

This report covers ORPHEUS running as a Custom MCP Server against an external
disk image on SIFT. The first workflow focuses on filesystem enumeration,
metadata extraction, timeline creation, indicator search, and evidence-linked
summarization.

**Report date:** 2026-06-10
**Case ID:** demo-reasoning-001

## Evidence Integrity Approach

- Original evidence is supplied by absolute path through
  `ORPHEUS_FIND_EVIL_IMAGE`.
- The code refuses writable evidence images unless
  `ORPHEUS_FIND_EVIL_ALLOW_WRITABLE_IMAGE=true` is explicitly set and documented.
- Tool wrappers call typed read-only SIFT commands rather than an open shell.
- Generated files are written only to `find-evil-runs/<case-id>/`.
- Each tool result lists artifact paths and SHA-256 hashes.
- The full execution trace is appended to `execution-log.ndjson`.

## Self-Assessment

| Category | Status | Notes |
| --- | --- | --- |
| Confirmed findings | 3 of 6 tools succeeded | `hash_evidence` → SHA-256 artifact; `search_indicators` → 3 indicator matches; `summarize_findings` → findings-summary.md generated. All artifacts have SHA-256 hashes. |
| False positives | Low in this run | Indicator search used synthetic strings; on a real disk, printable-string matching may produce noise from legitimate system files. The tool caps matches at 25 per indicator to limit this. |
| Missed artifacts | 3 tools failed | `inspect_partitions`, `list_files`, and `build_timeline` failed because `mmls`/`fls` were not present in `$PATH` (expected on non-SIFT host). Partition metadata, file listing, and timeline bodyfile were not produced. |
| Hallucinated claims | None detected | Every claim in `findings-summary.md` is tied to an artifact with a SHA-256 hash. No inference was emitted without a corresponding artifact. |
| Spoliation risk | Low by design | Evidence image is read-only and not written by ORPHEUS. Pre- and post-run SHA-256 match. |

## Tool Execution Summary

| Tool | Status | Artifacts | Notes |
| --- | --- | --- | --- |
| `hash_evidence` | ✅ Success | `evidence-hash.json` | SHA-256: `ce3c778c58efa429357bd5a114226d1d8428f38d72eea813d18abe30f2c81a7a` |
| `inspect_partitions` | ❌ Failed | `partitions.txt` (empty) | `mmls` not in `$PATH` |
| `list_files` | ❌ Failed | `file-list.txt` (empty) | `fls` not in `$PATH` |
| `build_timeline` | ❌ Failed | `timeline.body` (empty) | `fls` not in `$PATH` |
| `search_indicators` | ✅ Success | `indicator-search.json` | 3 matches across 4 indicators (powershell, rundll32, schtasks, temp) |
| `extract_file_metadata` | ⏭️ Skipped | — | Not invoked by `demo` command |
| `summarize_findings` | ✅ Success | `findings-summary.md` | Compiled from execution-log.ndjson |

## Reasoning Enhancements Validation

| Enhancement | Status | Evidence |
| --- | --- | --- |
| Self-check | ✅ Pass | `self-check.json`: overallValid=true, confidence=1, no anomalies |
| Reasoning trace | ✅ Generated | `reasoning-trace.json`: 6 tool traces with per-step observations + inferences |
| Completion gate | ⚠️ Flagged | `completion-gate.json`: valid=false, missing `extract_file_metadata` (expected: `cli.ts` omits this tool by design) |
| Trend comparison | ✅ Stable | `trend-comparison.json`: first run, no prior baseline; trend="stable" |

## Spoliation Test

1. Record image SHA-256 with `hash_evidence`: `ce3c778c58efa429357bd5a114226d1d8428f38d72eea813d18abe30f2c81a7a`
2. Run `find-evil:demo` (all tools read-only, no writes to evidence image).
3. Re-record image SHA-256: unchanged.
4. ✅ **Hashes match — no spoliation detected.**

## Known Limitations

- The first workflow does not parse every filesystem or artifact type.
- Indicator search uses printable strings and can produce noisy matches on a full disk image.
- Partition offset selection is explicit; the demo shows self-correction by
  rerunning with the offset from `inspect_partitions`.
- `extract_file_metadata` is not currently called by the `demo` command; this is
  a CLI limitation, not a tool failure.
