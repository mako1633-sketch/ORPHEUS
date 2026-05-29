# FIND EVIL Accuracy Report

## Scope

This report covers ORPHEUS running as a Custom MCP Server against an external
disk image on SIFT. The first workflow focuses on filesystem enumeration,
metadata extraction, timeline creation, indicator search, and evidence-linked
summarization.

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
| Confirmed findings | TBD | Populate from `findings-summary.md`. |
| False positives | TBD | List unsupported or overbroad indicator matches. |
| Missed artifacts | TBD | Compare against known ground truth or manual review. |
| Hallucinated claims | TBD | Any claim without artifact support is a failure. |
| Spoliation risk | Low by design | Evidence image is read-only and not written by ORPHEUS. |

## Spoliation Test

1. Record image SHA-256 with `hash_evidence`.
2. Run `find-evil:demo`.
3. Record image SHA-256 again.
4. Confirm both hashes match.

## Known Limitations

- The first workflow does not parse every filesystem or artifact type.
- Indicator search uses printable strings and can produce noisy matches.
- Partition offset selection is explicit; the demo shows self-correction by
  rerunning with the offset from `inspect_partitions`.
