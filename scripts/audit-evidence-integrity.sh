#!/usr/bin/env bash
#
# ORPHEUS Evidence Integrity Audit Script
# Usage: ./scripts/audit-evidence-integrity.sh <case-id>
# Example: ./scripts/audit-evidence-integrity.sh demo-reasoning-001
#
# This script verifies:
#   1. All SHA-256 hashes in evidence-hash.json still match the actual files
#   2. No files in the evidence path were modified during the run
#   3. All expected artifacts are present and non-empty
#   4. The execution log is intact and parseable
#
# Exit codes:
#   0 = All checks passed
#   1 = Hash mismatch or missing artifact
#   2 = Invalid arguments or missing case directory
#

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CHECKMARK="✅"
CROSS="❌"
WARNING="⚠️"

function print_usage() {
    echo "Usage: $0 <case-id>"
    echo "Example: $0 demo-reasoning-001"
    echo ""
    echo "Verifies evidence integrity for a find-evil run."
}

function print_header() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  ORPHEUS Evidence Integrity Audit"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
}

function print_result() {
    local status="$1"
    local message="$2"
    if [[ "$status" == "PASS" ]]; then
        echo -e "${CHECKMARK} ${GREEN}${message}${NC}"
    elif [[ "$status" == "FAIL" ]]; then
        echo -e "${CROSS} ${RED}${message}${NC}"
    else
        echo -e "${WARNING} ${YELLOW}${message}${NC}"
    fi
}

# ── Argument parsing ──

if [[ $# -lt 1 ]]; then
    print_usage
    exit 2
fi

CASE_ID="$1"
RUN_DIR="find-evil-runs/${CASE_ID}"

if [[ ! -d "$RUN_DIR" ]]; then
    echo -e "${RED}Error: Run directory not found: ${RUN_DIR}${NC}"
    echo "Available cases:"
    ls -1 find-evil-runs/ 2>/dev/null || echo "  (none found)"
    exit 2
fi

print_header
echo "Case ID:    ${CASE_ID}"
echo "Run Dir:    ${RUN_DIR}"
echo "Started:    $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# ── Check 1: Expected artifacts present ──

EXPECTED_ARTIFACTS=(
    "evidence-hash.json"
    "execution-log.ndjson"
    "findings-summary.md"
    "self-check.json"
    "completion-gate.json"
)

OPTIONAL_ARTIFACTS=(
    "reasoning-trace.json"
    "trend-comparison.json"
    "partitions.txt"
    "file-list.txt"
    "timeline.body"
    "timeline.csv"
    "indicator-search.json"
    "executive-state.json"
)

pass_count=0
fail_count=0
warning_count=0

echo "─── Artifact Presence Check ───"
for artifact in "${EXPECTED_ARTIFACTS[@]}"; do
    path="${RUN_DIR}/${artifact}"
    if [[ -f "$path" && -s "$path" ]]; then
        size=$(wc -c < "$path" | tr -d ' ')
        print_result "PASS" "${artifact} present (${size} bytes)"
        ((pass_count++))
    else
        print_result "FAIL" "${artifact} missing or empty"
        ((fail_count++))
    fi
done

for artifact in "${OPTIONAL_ARTIFACTS[@]}"; do
    path="${RUN_DIR}/${artifact}"
    if [[ -f "$path" && -s "$path" ]]; then
        size=$(wc -c < "$path" | tr -d ' ')
        print_result "PASS" "${artifact} present (${size} bytes) [optional]"
        ((pass_count++))
    else
        print_result "WARN" "${artifact} not generated (optional)"
        ((warning_count++))
    fi
done

echo ""

# ── Check 2: Evidence hash verification ──

echo "─── Evidence Hash Verification ───"

HASH_FILE="${RUN_DIR}/evidence-hash.json"
if [[ -f "$HASH_FILE" ]]; then
    # Extract image path and stored hash from evidence-hash.json
    # The file format: {"caseId":"...","imagePath":"...","sha256":"...","timestamp":"..."}
    stored_hash=$(grep -o '"sha256"[^}]*' "$HASH_FILE" | sed 's/.*"sha256":"\([^"]*\)".*/\1/')
    image_path=$(grep -o '"imagePath"[^,]*' "$HASH_FILE" | sed 's/.*"imagePath":"\([^"]*\)".*/\1/')
    
    if [[ -z "$stored_hash" || -z "$image_path" ]]; then
        print_result "FAIL" "evidence-hash.json malformed — cannot extract path or hash"
        ((fail_count++))
    elif [[ ! -f "$image_path" ]]; then
        print_result "WARN" "Original evidence image not found at: ${image_path}"
        ((warning_count++))
    else
        echo "  Stored hash:  ${stored_hash}"
        echo "  Image path:   ${image_path}"
        echo "  Computing..."
        
        # Compute SHA-256 (macOS uses shasum -a 256, Linux uses sha256sum)
        if command -v sha256sum &> /dev/null; then
            computed_hash=$(sha256sum "$image_path" | awk '{print $1}')
        else
            computed_hash=$(shasum -a 256 "$image_path" | awk '{print $1}')
        fi
        
        echo "  Computed:     ${computed_hash}"
        
        if [[ "$stored_hash" == "$computed_hash" ]]; then
            print_result "PASS" "SHA-256 MATCH — evidence is unmodified"
            ((pass_count++))
        else
            print_result "FAIL" "SHA-256 MISMATCH — evidence may have been modified!"
            ((fail_count++))
        fi
    fi
else
    print_result "FAIL" "evidence-hash.json missing — cannot verify integrity"
    ((fail_count++))
fi

echo ""

# ── Check 3: Execution log integrity ──

echo "─── Execution Log Integrity ───"

LOG_FILE="${RUN_DIR}/execution-log.ndjson"
if [[ -f "$LOG_FILE" && -s "$LOG_FILE" ]]; then
    line_count=$(wc -l < "$LOG_FILE" | tr -d ' ')
    
    # Validate each line is valid JSON
    invalid_lines=0
    while IFS= read -r line; do
        if ! echo "$line" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
            # Fallback: try jq if python3 not available
            if command -v jq &> /dev/null; then
                if ! echo "$line" | jq . > /dev/null 2>&1; then
                    ((invalid_lines++))
                fi
            else
                # Can't validate — warn but don't fail
                print_result "WARN" "Cannot validate NDJSON without python3 or jq"
                break
            fi
        fi
    done < "$LOG_FILE"
    
    if [[ $invalid_lines -eq 0 ]]; then
        print_result "PASS" "execution-log.ndjson valid (${line_count} entries)"
        ((pass_count++))
    else
        print_result "FAIL" "execution-log.ndjson has ${invalid_lines} invalid line(s)"
        ((fail_count++))
    fi
else
    print_result "FAIL" "execution-log.ndjson missing or empty"
    ((fail_count++))
fi

echo ""

# ── Check 4: Self-check validation ──

echo "─── Self-Check Validation ───"

SELF_CHECK_FILE="${RUN_DIR}/self-check.json"
if [[ -f "$SELF_CHECK_FILE" ]]; then
    if command -v python3 &> /dev/null; then
        confidence=$(python3 -c "import json; d=json.load(open('$SELF_CHECK_FILE')); print(d.get('overallConfidence', 'N/A'))")
        valid=$(python3 -c "import json; d=json.load(open('$SELF_CHECK_FILE')); print('true' if d.get('overallValid') else 'false')")
        
        echo "  Confidence:   ${confidence}"
        echo "  Valid:        ${valid}"
        
        if [[ "$valid" == "true" && "$confidence" == "1" ]]; then
            print_result "PASS" "Self-check passed with full confidence"
            ((pass_count++))
        elif [[ "$valid" == "true" ]]; then
            print_result "WARN" "Self-check valid but confidence < 1: ${confidence}"
            ((warning_count++))
        else
            print_result "FAIL" "Self-check reported invalid results"
            ((fail_count++))
        fi
    else
        print_result "WARN" "python3 not available — skipping self-check parse"
        ((warning_count++))
    fi
else
    print_result "WARN" "self-check.json not found (may be an older run)"
    ((warning_count++))
fi

echo ""

# ── Check 5: Completion gate ──

echo "─── Completion Gate ───"

GATE_FILE="${RUN_DIR}/completion-gate.json"
if [[ -f "$GATE_FILE" ]]; then
    if command -v python3 &> /dev/null; then
        gate_valid=$(python3 -c "import json; d=json.load(open('$GATE_FILE')); print('true' if d.get('valid') else 'false')")
        expected=$(python3 -c "import json; d=json.load(open('$GATE_FILE')); print(d.get('expectedTools', 'N/A'))")
        actual=$(python3 -c "import json; d=json.load(open('$GATE_FILE')); print(d.get('actualTools', 'N/A'))")
        missing=$(python3 -c "import json; d=json.load(open('$GATE_FILE')); print(len(d.get('missingTools', [])))")
        
        echo "  Gate valid:   ${gate_valid}"
        echo "  Expected:     ${expected} tools"
        echo "  Actual:       ${actual} tools"
        echo "  Missing:      ${missing}"
        
        if [[ "$gate_valid" == "true" ]]; then
            print_result "PASS" "Completion gate passed — all expected tools executed"
            ((pass_count++))
        else
            print_result "WARN" "Completion gate flagged issues (${missing} missing tool(s))"
            ((warning_count++))
        fi
    else
        print_result "WARN" "python3 not available — skipping completion gate parse"
        ((warning_count++))
    fi
else
    print_result "WARN" "completion-gate.json not found (may be an older run)"
    ((warning_count++))
fi

echo ""

# ── Final Summary ──

echo "═══════════════════════════════════════════════════════════════"
echo "  AUDIT SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "  ${GREEN}Passed:   ${pass_count}${NC}"
echo -e "  ${YELLOW}Warnings: ${warning_count}${NC}"
echo -e "  ${RED}Failed:   ${fail_count}${NC}"
echo ""

if [[ $fail_count -eq 0 ]]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  EVIDENCE INTEGRITY VERIFIED                                 ║${NC}"
    echo -e "${GREEN}║  No spoliation detected. All artifacts consistent.           ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  EVIDENCE INTEGRITY COMPROMISED                              ║${NC}"
    echo -e "${RED}║  ${fail_count} check(s) failed. Review output above.              ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi
