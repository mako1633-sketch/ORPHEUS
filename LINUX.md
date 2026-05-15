# ORPHEUS for Linux

This folder is prepared to run ORPHEUS on Linux terminals through Bun and Bash.

## Requirements

- A modern Linux distribution with a UTF-8 terminal
- Bash
- Git
- Bun
- Optional: Ollama for local models
- Optional voice tools: `sox`, `ffmpeg`, and a working ALSA/PulseAudio/PipeWire input device
- Optional browser rendering: Playwright Chromium installed with `--with-browser-setup`

## Install System Packages

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl sox libsox-fmt-pulse ffmpeg
```

Fedora:

```bash
sudo dnf install -y git curl sox sox-plugins-freeworld ffmpeg
```

Arch:

```bash
sudo pacman -S git curl sox ffmpeg
```

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
exec "$SHELL"
```

## First Run

Open a terminal in this folder and run:

```bash
./scripts/linux/setup.sh
./scripts/linux/run.sh
```

If dependencies are already installed:

```bash
./scripts/linux/setup.sh --skip-install
```

If you want the optional Playwright-backed browser renderer:

```bash
./scripts/linux/setup.sh --with-browser-setup
```

For CI or a quick readiness check without dependency downloads:

```bash
./scripts/linux/setup.sh --check-only
```

## Daily Use

```bash
./scripts/linux/run.sh
```

You can also use Bun directly:

```bash
bun run dev
bun run check
bun test
```

## Linux Behavior

- Local shell commands use Bash.
- ORPHEUS stores configuration under `~/.config/orpheus` unless overridden.
- Voice capture uses `rec`/SoX and expects `sox` to be available on `PATH`.
- Browser rendering uses Playwright Chromium when installed with `--with-browser-setup` or `bun run setup:browsers`.
- The release workflow is available through `bun run release:patch`, `release:minor`, `release:major`, and `release:notes`.

## Useful Checks

```bash
bun run typecheck
bun x biome lint src __tests__ scripts
bun x biome format src __tests__ scripts
bun test
./scripts/linux/setup.sh --check-only
```

## Troubleshooting

If `bun` is not found after installation, restart the terminal or run:

```bash
source ~/.bashrc
```

If voice capture fails, confirm:

```bash
sox --version
ffmpeg -version
```

If the terminal UI looks broken, try a modern terminal emulator and make sure `$TERM` is set to a color-capable value such as `xterm-256color`.
