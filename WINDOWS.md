# ORPHEUS for Windows

This folder is prepared to run ORPHEUS on Windows through PowerShell, Windows Terminal, and Bun for Windows.

## Requirements

- Windows 10 or Windows 11
- PowerShell 5.1 or newer
- Git for Windows
- Bun for Windows
- Optional: Ollama for local models
- Optional voice tools: `sox` and `ffmpeg` available on `PATH`
- Optional browser rendering: Playwright browsers installed by the setup script

## First Run

Open PowerShell in this folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\windows\setup.ps1
.\scripts\windows\run.ps1
```

If dependencies are already installed, use:

```powershell
.\scripts\windows\setup.ps1 -SkipInstall
```

## Daily Use

```powershell
.\scripts\windows\run.ps1
```

You can also use Bun directly:

```powershell
bun run dev
bun run check
bun test
```

## Windows Behavior

- Local shell commands use Windows PowerShell, not Bash.
- Windows security assessment flows use built-in, read-only PowerShell commands first.
- ORPHEUS stores configuration under `%APPDATA%\orpheus`.
- The report generator writes to the Windows Desktop when available and otherwise falls back to the user profile folder.
- The release workflow is available through `bun run release:patch`, `release:minor`, `release:major`, and `release:notes` without requiring Bash.

## Useful Checks

```powershell
bun run typecheck
bun x biome lint src __tests__ scripts
bun x biome format src __tests__ scripts
bun test __tests__/run-bash-windows.test.ts __tests__/windows-assessment-context.test.ts
```

## Troubleshooting

If PowerShell blocks local scripts for this session:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

If `bun` is not found after installation, close and reopen PowerShell so `PATH` refreshes.

If voice capture is unavailable, confirm `sox` and `ffmpeg` are installed and visible:

```powershell
sox --version
ffmpeg -version
```
