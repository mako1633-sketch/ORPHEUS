param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$OrpheusArgs
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Error "Bun is required. Install Bun for Windows from https://bun.sh/docs/installation, then reopen PowerShell."
}

bun run src/index.tsx @OrpheusArgs
