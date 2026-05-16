param(
    [switch]$SkipInstall,
    [switch]$SkipBrowserSetup
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

function Require-Command {
    param([string]$Name, [string]$Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "$Name is required. $Hint"
    }
}

Require-Command "bun" "Install Bun for Windows from https://bun.sh/docs/installation, then reopen PowerShell."
Require-Command "git" "Install Git for Windows from https://git-scm.com/download/win."

Write-Host "ORPHEUS Windows setup" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"
Write-Host "Bun:  $(bun --version)"

if (-not $SkipInstall) {
    bun install
}

if (-not $SkipBrowserSetup) {
    bun run setup:browsers
}

git config core.hooksPath .githooks

bun run typecheck
bun test __tests__/run-bash-windows.test.ts (Get-ChildItem "__tests__/windows-*.test.ts" | ForEach-Object { $_.FullName })

Write-Host "ORPHEUS Windows setup complete." -ForegroundColor Green
Write-Host "Start it with: .\scripts\windows\run.ps1"
