#!/usr/bin/env python3
"""
Convert daemon.gif into Apple Watch-friendly assets.

Outputs:
  - daemon-watch-square.gif   (optimized, cropped GIF for Telegram preview)
  - daemon-watch-live.mp4     (H.264 short loop for Live Photo / intoLive)
  - daemon-watch-static.png   (single-frame square crop for static face)
"""
import os, sys, subprocess, tempfile, shutil
from pathlib import Path
from PIL import Image

GIF_PATH = Path("img/daemon.gif")
OUT_DIR  = Path("watch-assets")

APWATCH = {
    "41mm":   {"w": 396, "h": 484},
    "45mm":   {"w": 430, "h": 529},
    "ultra":  {"w": 458, "h": 562},
}

def extract_frames() -> list[Image.Image]:
    gif = Image.open(GIF_PATH)
    frames, seen = [], set()
    while True:
        try:
            frame = gif.copy()
            # Ensure RGBA for consistent processing
            if frame.mode != 'RGBA':
                frame = frame.convert('RGBA')
            # Deduplicate identical consecutive frames
            hashable = frame.tobytes()
            if hashable not in seen:
                seen.add(hashable)
                frames.append(frame)
            gif.seek(gif.tell() + 1)
        except EOFError:
            break
    print(f"[+] Extracted {len(frames)} unique frames from {GIF_PATH}")
    return frames

def crop_center_square(frames: list[Image.Image]) -> list[Image.Image]:
    """Crop to centered square preserving the daemon in frame."""
    cropped = []
    for frame in frames:
        w, h = frame.size
        # 960x551 -> crop to 551x551, centered x
        size = min(w, h)
        left = (w - size) // 2
        top  = (h - size) // 2
        cropped.append(frame.crop((left, top, left + size, top + size)))
    return cropped

def resize_all(frames: list[Image.Image], size: tuple[int,int]) -> list[Image.Image]:
    return [f.copy().resize(size, Image.LANCZOS) for f in frames]

def save_optimized_gif(frames: list[Image.Image], path: Path, duration: int = 80):
    """Save optimized GIF. Duration in ms per frame."""
    if not frames:
        return
    base = frames[0].convert('RGB')
    rest = [f.convert('RGBA') for f in frames[1:]]
    base.save(
        path,
        save_all=True,
        append_images=rest,
        optimize=True,
        duration=duration,
        loop=0,
        disposal=2,
    )
    print(f"[+] Saved optimized GIF: {path} ({os.path.getsize(path)//1024} KB)")

def save_static_png(frames: list[Image.Image], path: Path):
    """Pick a mid-sequence frame for a polished still."""
    frame = frames[len(frames)//2].convert('RGB')
    frame.save(path)
    print(f"[+] Saved static PNG: {path}")

def export_video(frames: list[Image.Image], path: Path, fps: int = 14):
    """Export frames as H.264 MP4 via ffmpeg."""
    tmpdir = tempfile.mkdtemp()
    try:
        for i, frame in enumerate(frames):
            frame.convert('RGB').save(os.path.join(tmpdir, f"f{i:04d}.png"))
        # Use yuv420p for maximum compatibility (including Watch/iOS)
        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", os.path.join(tmpdir, "f%04d.png"),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-crf", "22",
            "-movflags", "+faststart",
            "-vf", "format=yuv420p",
            str(path)
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"[+] Saved video: {path} ({os.path.getsize(path)//1024} KB)")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

def main():
    if not GIF_PATH.exists():
        print(f"[!] Not found: {GIF_PATH}")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    frames = extract_frames()
    frames = crop_center_square(frames)

    # --- Static / GIF outputs at Ultra res (largest common) ---
    ultra = APWATCH["ultra"]
    square_size = (ultra["w"], ultra["h"])  # Actually watch is not square. Use 484x484 or 562x562
    # Wait: Apple Watch faces can use any photo, but they crop to the screen shape.
    # For animated faces, Photos face crops to a circle-in-square.
    # For best results on ALL models, keep square at the SMALLER edge of the largest
    # screen, so at least the full screen is covered no matter what.
    # Let's use square 484 for safety? No, let's use 562x562.
    sq = (562, 562)

    print(f"[+] Processing to {sq[0]}x{sq[1]} square crop...")

    # Re-sample to final pixel size
    final = resize_all(frames, sq)

    save_optimized_gif(final, OUT_DIR / "daemon-watch-square.gif", duration=80)
    save_static_png(final, OUT_DIR / "daemon-watch-static.png")

    # Ultra-size video (not square but covers entire display)
    ultra_wh = (ultra["w"], ultra["h"])
    final_ultra = resize_all(frames, ultra_wh)
    export_video(final_ultra, OUT_DIR / "daemon-watch-live.mp4", fps=14)

    print("\n[+] Done. Assets in:", OUT_DIR.resolve())

if __name__ == "__main__":
    main()
