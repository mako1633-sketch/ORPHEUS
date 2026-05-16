# Changelog

All notable enhancements to the Orpheus capability suite are documented in this file.

## [2026-05-16] Enhancement Sprint: Operational Maturity

### Overview
A concentrated effort to move the system from "functional" to "accountable" — with isolated execution, structured telemetry, immutable audit trails, and cross-system observability.

### Added

#### `orpheus-startup` v2 — Isolated Execution + Timing Telemetry
- **Previous behavior:** Sequential startup where any step failure blocked the entire chain. SSH warning → session BLOCKED.
- **New behavior:** All 8 steps execute independently. Failures surface in JSON output but NEVER block the session.
- **Timing telemetry:** Per-step wall-clock duration captured. Steps taking >5s flagged with ⚠️ "SLOW" warning.
- **Structured state:** JSON written to `~/.config/orpheus/.state/orpheus-state.json` with pass/fail/warn/unknown counts.
- **Key design decision:** `exit 0` always. Zero is success; non-zero is reserved for tool-level errors, not policy enforcement.

**Benefit:** Startup failures no longer strand the user. Performance regressions are visible. Downstream systems (like `orpheus-digest`) have reliable data to consume.

---

#### `auto-remediate` v4 — Append-Only ndjson Audit Log
- **Previous behavior:** JSON array log with read-modify-write risk; no per-finding risk tracking.
- **New behavior:** Append-only ndjson — each finding is one line, fsync'd, no corruption risk.
- **Risk classification per finding:** `safe` ✅ / `medium` ⚠️ / `high` ❌ / `review` 👁️ (not just global `safe_mode` boolean).
- **Before/after delta:** Captures permission changes, pattern additions, and any state transform.
- **Session grouping:** All fixes from one run share a `session_id` (UUID v4) for multi-file batch correlation.
- **Built-in log viewer:** `auto-remediate log --tail 10` prints human-readable table grouped by session. `auto-remediate log --rotate` enforces 90-day retention + 5000-entry cap atomically.
- **Integration:** `--yes` flag auto-approves only `safe`-risk fixes; blocks (exit 5) if any higher-risk fixes exist.

**Benefit:** Remediation is no longer opaque. You can see exactly what changed, when, at what risk level, and whether it was automatic or manual. Accountability replaces trust.

---

#### `suggest-next` v1.2 — Task Visibility + Non-Interactive Mode
- **Task visibility:** Now surfaces stale pending tasks (>48h) and orphan detection. If >3 pending tasks with none in-progress, suggests `task-orchestrator resume`.
- **Non-interactive support:** `--no-input` flag + `sys.stdin.isatty()` auto-detection. Script never blocks when called from scripts or startup chains.
- **`--auto` execution:** Injects `auto-remediate --yes` (position-aware, before subcommand) so safe remediations execute hands-off.
- **Risk-labeled suggestions:** Scanner findings shown with clear risk labels.

**Benefit:** `suggest-next` goes from purely informational to action-capable in headless environments. The gap between "I detected this" and "I fixed this" closes.

---

#### `preflight-git` v1.1 — Warning-Safe Pre-Push Checks
- **Previous behavior:** Warnings returned exit code 2, causing any dependent workflow to halt.
- **New behavior:** Warnings-only returns `0` by default. `--strict` flag for environments where warnings *should* block.
- **Integration:** Consumed by `workflow run deploy-safe`; no longer blocked by benign SSH-agent warnings on HTTPS remotes.

**Benefit:** Git pre-flight checks stop being noisy and start being useful. The tool respects Unix exit-code conventions.

---

#### `workflow` v1.1 — Project-Type Aware Automation
- **Previous behavior:** Hardcoded `npm test` / `npm run build` for all projects.
- **New behavior:** Auto-detects `bun`, `go`, `python` projects from lockfiles and `package.json`/`go.mod`/`pyproject.toml`. Reads `project-registry` for stored commands. Falls back to file-system detection.
- **Template regeneration:** `workflow refresh` regenerates built-in recipes (`deploy-safe`, etc.) with project-specific commands.

**Benefit:** `deploy-safe` now works out-of-the-box for Bun, Go, and Python repos without manual configuration.

---

#### `project-registry` v1.1 — `bun` Type Detection + Command Extraction
- **Previous behavior:** `type: None` for projects; no command awareness.
- **New behavior:** Reads `package.json` `scripts` to auto-fill `test_cmd`, `build_cmd`, `lint_cmd`. Added `bun` as a project type alongside existing `npm`, `poetry`, `pipenv`, `go`.

**Benefit:** One `project-registry detect && register` call captures the project's validated build pipeline for reuse by `workflow`, `suggest-next`, and any future tool.

---

#### `orpheus-digest` v1 — Cross-System Session Summary
- **New command:** Consumes startup state, task backlog, and remediation audit log.
- **Output sections:**
  - Session Health (since timestamp, pass/warn/fail counts, total duration)
  - Tasks (total, pending count, stale count, orphaned count)
  - Remediations (last N entries grouped by session)
  - Anomalies (startup warnings, orphaned tasks, stale findings, remediation dry-runs, etc.)

**Benefit:** No more hunting across multiple files and tools to understand current state. One command gives you the picture.

---

### Changed
- `bin/README.md`: Added per-script documentation for new capabilities, updated scripts table, fixed section ordering.

---

### How This Changes the System

| Before | After |
|--------|-------|
| Startup failures block session | All steps run; failures reported but not blocking |
| No insight into startup performance | Per-step timing with slow-step ⚠️ warnings |
| Remediation is opaque: trust-based | Audit trail with risk classification and before/after delta |
| `suggest-next` is read-only | `--auto` mode executes safe fixes hands-off |
| `deploy-safe` breaks on `bun` repos | Project-aware with `bun`/`go`/`python` support |
| State scattered across files | `orpheus-digest` provides unified cross-system view |
| Workflow warnings halt execution | `preflight-git` respects conventions; `--strict` opt-in only |

### Risk / Migration Notes
- Existing `remediation-log.json` users: v4 writes to a new file (`*.log.ndjson`) for safety. The old file remains for reference.
- `workflow refresh` must be run after upgrading to regenerate project-aware built-in recipes.
- `preflight-git` callers relying on exit code 2 for warnings should add `--strict`.

---

## Future Areas

- **Suggestion accuracy telemetry:** Track which `suggest-next` recommendations were acted on, which were ignored, and why. Requires weeks of accumulated data before actionable.
- **Workflow chaining:** Allow `workflow run` to trigger dependent workflows automatically on success (e.g., `deploy-safe` → `security-sweep` → `dependency-audit`).
- **Task orchestrator drift auto-escalation:** Currently detects 6 stale pending tasks. Auto-promote to `in_progress` on `--auto` flag or surface an explicit triage suggestion.

---

*Changelog maintained by ORPHEUS enhancement sprint.*
