# ORPHEUS 90-Second Demo Script

**Purpose:** A silent, visual proof of ORPHEUS self-correction for hackathon judges.

**Format:** Screen recording → GIF or MP4 (recommend MP4 for quality, convert to GIF for README)

**Tools:** Any screen recorder (QuickTime, OBS, ScreenFlow). Target: 1920×1080, 30fps.

---

## Scene 1: The Terminal (0:00–0:10)

**Visual:** Clean terminal window, dark background, ORPHEUS prompt visible.

**Action:** Type the demo command slowly, with pauses so viewers can read:

```bash
bun run find-evil:demo -- --enable-reasoning
```

**Press Enter.**

**Caption overlay (optional):** "ORPHEUS: Autonomous DFIR Agent"

---

## Scene 2: Phase 1 — Evidence Integrity (0:10–0:20)

**Visual:** Terminal output scrolling. Green text for success.

**What happens:**
```
🔍 Phase 1: hash_evidence
   → Computing SHA-256...
   → Artifact: evidence-hash.json
   → Status: ✅ SUCCESS
```

**Pause 2 seconds** on the SHA-256 hash line. Let viewers see it.

**Caption:** "Step 1: Lock the evidence. Every bit fingerprinted."

---

## Scene 3: Phase 2 — Failure & Diagnosis (0:20–0:35)

**Visual:** Red text appears. This is the critical moment.

**What happens:**
```
🔍 Phase 2: inspect_partitions
   → Running mmls...
   → Status: ❌ FAILED
   → Error: "Executable not found in $PATH: mmls"
```

**Pause 3 seconds.** The failure must be visible and readable.

**Then yellow inference text appears:**
```
   💡 Inference: "sleuthkit may not be installed.
                  Partition tools need SIFT environment."
```

**Caption:** "It fails. But it *knows* why."

---

## Scene 4: Phase 3 — Graceful Degradation (0:35–0:50)

**Visual:** More red text, then a yellow fallback message.

**What happens:**
```
🔍 Phase 3: list_files
   → Checking for auto-extracted offset...
   → partitions.txt missing
   → Attempting fls without -o...
   → Status: ❌ FAILED

   💡 Inference: "Will retry with explicit offset on next run."
```

**Then cut to the analyst typing:**
```bash
bun run find-evil:demo -- --offset 2048 --enable-reasoning
```

**Caption:** "Self-correction: the analyst provides the offset. ORPHEUS adapts."

---

## Scene 5: Phase 5 — Success Despite Missing Tools (0:50–1:05)

**Visual:** Green text. This shows ORPHEUS doesn't give up.

**What happens:**
```
🔍 Phase 5: search_indicators
   → Running strings + regex...
   → Indicators: powershell, rundll32, schtasks, temp
   → Matches found: 3
   → Artifact: indicator-search.json
   → SHA-256: c4eec0be9cd5994c...
   → Status: ✅ SUCCESS
```

**Pause 2 seconds** on the match count and SHA-256.

**Caption:** "Even with missing tools, it finds what it can. Degrades gracefully."

---

## Scene 6: The Report (1:05–1:15)

**Visual:** Switch to a browser or cat command showing `findings-summary.md`.

**What happens:**
```bash
cat find-evil-runs/demo-reasoning-001/findings-summary.md
```

Show the table of claims with artifact references and SHA-256 hashes.

**Caption:** "Every claim hash-linked. Zero hallucination."

---

## Scene 7: The Timeline Viewer (1:15–1:25)

**Visual:** Open `docs/find-evil/timeline-viewer.html` in a browser.

**What happens:** The interactive timeline auto-plays. Cards expand showing the reasoning chain.

Show:
- The red failure card for `inspect_partitions`
- The yellow inference card
- The green success cards
- The "Case Summary" box at the top

**Caption:** "Interactive proof of self-correction. Judges can inspect every step."

---

## Scene 8: Final Summary Box (1:25–1:30)

**Visual:** Back to terminal. A box appears (this is what `--judge-mode` prints):

```
╔══════════════════════════════════════════════════════════════╗
║  ORPHEUS INVESTIGATION SUMMARY                               ║
╠══════════════════════════════════════════════════════════════╣
║  Case ID:        demo-reasoning-001                          ║
║  Tools executed: 6 / 7                                       ║
║  Successful:     3                                           ║
║  Failed:         3 (diagnosed, not hidden)                   ║
║  Hallucinations: 0                                           ║
║  Spoliation:     0                                           ║
║  Self-check:     confidence = 1.0                            ║
╚══════════════════════════════════════════════════════════════╝
```

**Caption:** "This is what honest AI looks like."

**Fade to black.**

---

## Production Tips

| Tip | Why |
|---|---|
| **No narration** | Judges scroll with sound off. Text captions only. |
| **Use a monospace font** | Terminal authenticity. Recommend JetBrains Mono or Fira Code. |
| **Color code consistently** | Green = success, Red = failure, Yellow = inference/warning, White = info |
| **Pause on critical lines** | SHA-256 hashes, failure messages, and the final summary need 2–3 seconds |
| **Keep terminal size consistent** | 100×30 characters is readable on all screens |
| **Export as MP4 first, then GIF** | MP4 for DevPost, GIF for README embedding |
| **Target < 5 MB GIF** | GitHub README loads slowly with large GIFs. Compress with `gifsicle` or `ffmpeg` |

---

## Recording Commands

```bash
# If using ffmpeg to convert MP4 to optimized GIF
ffmpeg -i orpheus-demo.mp4 -vf "fps=30,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" orpheus-demo.gif

# Or use gifsicle for even smaller files
gifsicle --optimize=3 --colors 128 orpheus-demo.gif > orpheus-demo-optimized.gif
```

---

## README Embedding

Add this to your `README.md` or DevPost submission:

```markdown
## 🔍 90-Second Demo: Self-Correction in Action

![ORPHEUS DFIR Demo](docs/find-evil/orpheus-demo.gif)

**What you see:**
1. ✅ Evidence hashed (SHA-256)
2. ❌ Tool fails (mmls missing)
3. 💡 ORPHEUS diagnoses the failure
4. 🔄 Analyst reruns with offset
5. ✅ Indicators found despite missing tools
6. 📋 Every claim hash-linked in final report
7. 🌐 Interactive timeline viewer opens in browser

**Zero hallucination. Zero spoliation. Full transparency.**
```

---

## Optional: Add Judge Mode

The `--judge-mode` flag (see `src/find-evil/cli.ts`) adds:
- 2-second pauses between tools
- Narrative context printed to stdout
- Auto-opens the timeline viewer
- Prints the summary box

Use it for your live demo presentation:

```bash
bun run find-evil:demo -- --enable-reasoning --judge-mode
```
