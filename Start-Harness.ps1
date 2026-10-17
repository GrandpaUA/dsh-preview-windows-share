param([int]$Port = 3082)
$ErrorActionPreference = 'Stop'
# First-party gate findings manually reviewed in the official checkout and
# confirmed benign; see SECURITY-REVIEW.md.
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
$root = $PSScriptRoot
$bin = Join-Path $root 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'
if (-not (Test-Path -LiteralPath $bin -PathType Leaf)) { throw 'Runtime missing. Run install.ps1 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'profiles/web/cordis.patch.yml') -PathType Leaf)) { throw 'Local profile missing. Run install.ps1 first.' }
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) { throw "Port $Port is already in use. Choose another port with -Port." }
$oldHome = $env:DSH_HOME
try {
    $env:DSH_HOME = $root
    Push-Location $root
    try {
        & node --expose-internals $bin web --host 127.0.0.1 --port $Port
        if ($LASTEXITCODE -ne 0) { throw "Harness exited with code $LASTEXITCODE." }
    } finally { Pop-Location }
} finally { $env:DSH_HOME = $oldHome }
