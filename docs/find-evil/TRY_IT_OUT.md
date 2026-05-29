# FIND EVIL Try-It-Out Instructions

These steps are written for a SANS SIFT workstation or any Linux host with
Sleuth Kit tools installed.

## 1. Prepare SIFT

Install the SIFT workstation and Protocol SIFT per the hackathon instructions.
Confirm these commands are available:

```bash
which mmls fls istat mactime strings
```

## 2. Clone and Install ORPHEUS

```bash
git clone https://github.com/mako1633-sketch/ORPHEUS.git
cd ORPHEUS
bun install
```

## 3. Point ORPHEUS at External Evidence

Keep the case image outside git. Prefer making the image read-only before
analysis:

```bash
export ORPHEUS_FIND_EVIL_IMAGE="/absolute/path/to/case-image.dd"
export ORPHEUS_FIND_EVIL_CASE_ID="find-evil-case-001"
export ORPHEUS_FIND_EVIL_OUTPUT_DIR="$PWD/find-evil-runs"
chmod a-w "$ORPHEUS_FIND_EVIL_IMAGE"
```

If the image cannot be made read-only in the judging environment, document the
reason and set:

```bash
export ORPHEUS_FIND_EVIL_ALLOW_WRITABLE_IMAGE=true
```

## 4. Validate the Environment

```bash
bun run find-evil:validate
```

Expected result: JSON with `success: true`, the case id, run directory, and all
SIFT tools marked available.

## 5. Run the Scripted Demo Flow

```bash
bun run find-evil:demo
```

If `list_files` or `build_timeline` fails because a partition offset is needed,
read the `inspect_partitions` artifact and rerun:

```bash
bun run find-evil:demo -- --offset 2048
```

That rerun is the expected self-correction sequence for the demo video.

## 6. Use the Custom MCP Server

Start the server:

```bash
bun run find-evil:mcp
```

Configure a Streamable HTTP MCP client with:

```json
{
  "mcpServers": [
    {
      "id": "orpheus-find-evil",
      "type": "http",
      "url": "http://localhost:3333/mcp"
    }
  ]
}
```

The MCP client should call `hash_evidence` first, then `inspect_partitions`,
then continue with file listing, timeline generation, indicator search, and
summary generation.

## 7. Submission Artifacts

After a run, submit or reference:

- `find-evil-runs/<case-id>/execution-log.ndjson`
- `find-evil-runs/<case-id>/evidence-hash.json`
- `find-evil-runs/<case-id>/partitions.txt`
- `find-evil-runs/<case-id>/file-list.txt`
- `find-evil-runs/<case-id>/timeline.csv`
- `find-evil-runs/<case-id>/indicator-search.json`
- `find-evil-runs/<case-id>/findings-summary.md`
