# FIND EVIL 5-Minute Demo Script

## 0:00 - Setup

Show the SIFT terminal, the ORPHEUS repo, and the external image path:

```bash
echo "$ORPHEUS_FIND_EVIL_IMAGE"
bun run find-evil:validate
```

## 0:45 - Start the Custom MCP Server

```bash
bun run find-evil:mcp
```

Explain that the agent receives typed tools, not shell access.

## 1:20 - First Autonomous Pass

Run:

```bash
bun run find-evil:demo
```

Show `hash_evidence` and `inspect_partitions` results.

## 2:20 - Self-Correction

If `list_files` or `build_timeline` fails because an offset is missing, open
`partitions.txt`, identify the partition start, and rerun:

```bash
bun run find-evil:demo -- --offset 2048
```

Narrate this as the agent correcting its initial assumption.

## 3:30 - Findings and Evidence Trace

Show:

```bash
ls find-evil-runs/$ORPHEUS_FIND_EVIL_CASE_ID
sed -n '1,120p' find-evil-runs/$ORPHEUS_FIND_EVIL_CASE_ID/findings-summary.md
sed -n '1,3p' find-evil-runs/$ORPHEUS_FIND_EVIL_CASE_ID/execution-log.ndjson
```

Point out timestamps, artifacts, summaries, and hashes.

## 4:30 - Evidence Integrity Close

Re-run the hash or show `evidence-hash.json`. Explain that the original image
was external, read-only, and never modified by ORPHEUS.
