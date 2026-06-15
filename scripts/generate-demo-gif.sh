#!/bin/bash
set -euo pipefail

OUTPUT_DIR="${PWD}/docs/find-evil"
GIF_FILE="${OUTPUT_DIR}/orpheus-demo.gif"
MP4_FILE="${OUTPUT_DIR}/orpheus-demo.mp4"
TEMP_DIR="$(mktemp -d)"

TERM_WIDTH=820
TERM_HEIGHT=560
POS_X=300
POS_Y=200

RECORD_FPS=15
RECORD_DURATION=55
SCREEN_DEVICE="3"

GIF_WIDTH=720
GIF_FPS=12
GIF_COLORS=128

cleanup() {
    pkill -f "ffmpeg.*orpheus-demo" 2>/dev/null || true
    pkill -f "bun.*find-evil/cli.ts demo" 2>/dev/null || true
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "══════════════════════════════════════════════════════════"
echo "  ORPHEUS DFIR Demo GIF Generator"
echo "══════════════════════════════════════════════════════════"
echo ""

if ! command -v ffmpeg &>/dev/null; then
    echo "❌ ffmpeg not found. Install with: brew install ffmpeg"
    exit 1
fi
echo "✅ ffmpeg found"

if [[ ! -f /tmp/test-evidence.raw ]]; then
    echo "📦 Creating test evidence image..."
    dd if=/dev/zero of=/tmp/test-evidence.raw bs=1M count=10 2>/dev/null
fi
chmod 444 /tmp/test-evidence.raw
echo "✅ Evidence image ready (read-only)"

mkdir -p "$OUTPUT_DIR"
rm -f "$GIF_FILE" "$MP4_FILE"

echo ""
echo "📺 Stage 1: Opening Terminal window..."

REPO_PATH="$(pwd)"
END_X=$((POS_X + TERM_WIDTH))
END_Y=$((POS_Y + TERM_HEIGHT))

# Write AppleScript using printf to avoid all quoting issues
SCRIPT_FILE="${TEMP_DIR}/open_terminal.scpt"
printf '%s\n' 'tell application "Terminal"' > "$SCRIPT_FILE"
printf '%s\n' '    activate' >> "$SCRIPT_FILE"
printf '%s\n' "    set startX to ${POS_X}" >> "$SCRIPT_FILE"
printf '%s\n' "    set startY to ${POS_Y}" >> "$SCRIPT_FILE"
printf '%s\n' "    set endX to ${END_X}" >> "$SCRIPT_FILE"
printf '%s\n' "    set endY to ${END_Y}" >> "$SCRIPT_FILE"
printf '%s\n' '    set newWindow to do script "cd '"${REPO_PATH}"' && clear && sleep 0.5 && echo ORPHEUS DFIR Demo starting... && sleep 1 && bun run src/find-evil/cli.ts demo -- --image /tmp/test-evidence.raw --enable-reasoning --judge-mode"' >> "$SCRIPT_FILE"
printf '%s\n' '    set custom title of newWindow to "ORPHEUS DFIR Demo"' >> "$SCRIPT_FILE"
printf '%s\n' '    set bounds of front window to {startX, startY, endX, endY}' >> "$SCRIPT_FILE"
printf '%s\n' '    set background color of front window to {10487, 11051, 14392}' >> "$SCRIPT_FILE"
printf '%s\n' '    set normal text color of front window to {49344, 51968, 62976}' >> "$SCRIPT_FILE"
printf '%s\n' 'end tell' >> "$SCRIPT_FILE"

osascript "$SCRIPT_FILE"
sleep 3

echo ""
echo "📹 Stage 2: Recording screen ( ${RECORD_DURATION}s )..."

ffmpeg -y \
    -f avfoundation \
    -framerate ${RECORD_FPS} \
    -i "${SCREEN_DEVICE}:none" \
    -vf "crop=${TERM_WIDTH}:${TERM_HEIGHT}:${POS_X}:${POS_Y},fps=${RECORD_FPS}" \
    -t ${RECORD_DURATION} \
    -pix_fmt yuv420p \
    -an \
    -movflags +faststart \
    "${MP4_FILE}" 2> "${TEMP_DIR}/ffmpeg.log" &

FFMPEG_PID=$!

for i in $(seq 1 $RECORD_DURATION); do
    printf "\r   Recording: %2d/%ds [%s%s]" \
        "$i" "$RECORD_DURATION" \
        "$(printf '%*s' $((i * 50 / RECORD_DURATION)) '' | tr ' ' '#')" \
        "$(printf '%*s' $(((RECORD_DURATION - i) * 50 / RECORD_DURATION)) '' | tr ' ' '-')"
    sleep 1
done
printf "\n"

wait $FFMPEG_PID 2>/dev/null || true

pkill -f "bun.*find-evil/cli.ts demo" 2>/dev/null || true
osascript -e 'tell application "Terminal" to close front window' 2>/dev/null || true

echo "✅ Recording complete"

echo ""
echo "🎨 Stage 3: Converting to optimized GIF..."

ffmpeg -y -i "${MP4_FILE}" \
    -vf "fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${GIF_COLORS}[p];[s1][p]paletteuse=dither=bayer" \
    -loop 0 \
    "${GIF_FILE}" 2> "${TEMP_DIR}/gif.log"

GIF_SIZE=$(du -h "$GIF_FILE" | cut -f1)
MP4_SIZE=$(du -h "$MP4_FILE" | cut -f1)

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Demo GIF Generated Successfully"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "   📁 Files:"
echo "      GIF:  docs/find-evil/orpheus-demo.gif  (${GIF_SIZE})"
echo "      MP4:  docs/find-evil/orpheus-demo.mp4  (${MP4_SIZE})"
echo ""
echo "   📋 Next steps:"
echo "      1. Preview: open docs/find-evil/orpheus-demo.gif"
echo "      2. Add to README:"
echo '         ![ORPHEUS DFIR Demo](docs/find-evil/orpheus-demo.gif)'
echo ""

GIF_BYTES=$(stat -f%z "$GIF_FILE" 2>/dev/null || echo "0")
if [[ $GIF_BYTES -gt 5242880 ]]; then
    echo "   ⚠️  GIF is > 5MB. For README, optimize with:"
    echo "      ffmpeg -i docs/find-evil/orpheus-demo.gif -vf 'fps=10,scale=640:-1' docs/find-evil/orpheus-demo-sm.gif"
fi
