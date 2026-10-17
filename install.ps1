param([int]$Port = 3082, [switch]$NoStart)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
# Fail closed: two first-party rc.2 runtime dependencies received BLOCK.
# This reduced profile excludes all six blocked third-party pins, but that does
# not make the first-party dependencies eligible for installation. Do not bypass.
throw 'Installation disabled: @deepseek-ai/dsh and @deepseek-ai/dsh-client-locale at 0.2.0-rc.2 received BLOCK. See README.md.'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'Install Node.js 22 or newer from https://nodejs.org/ and retry.' }
$nodeVersion = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') { throw 'Unable to read Node.js version.' }
if ([int]$Matches[1] -lt 22) { throw "Node.js 22 or newer is required; found $nodeVersion." }
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) { throw 'Install pnpm 11 (for example: npm install -g pnpm@11.25.0) and retry.' }
$pnpmVersion = (& pnpm --version).Trim()
if ($LASTEXITCODE -ne 0 -or $pnpmVersion -notmatch '^11\.') { throw "pnpm 11 is required; found $pnpmVersion." }
& (Join-Path $root 'verify-release.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed; refusing to install.' }
$template = Join-Path $root 'profiles/web/cordis.patch.yml.in'
$generated = Join-Path $root 'profiles/web/cordis.patch.yml'
if (-not (Test-Path -LiteralPath $generated)) {
    $source = [IO.File]::ReadAllText($template)
    $marker = '__DSH_HOME__'
    if ($source.Split(@($marker), [StringSplitOptions]::None).Length -ne 2) { throw 'Expected one home placeholder in profile template.' }
    $homePath = $root.Replace('\', '/')
    if ($homePath.Contains('"') -or $homePath.Contains('`')) { throw 'Unsupported characters in installation path.' }
    $content = $source.Replace($marker, $homePath)
    [IO.File]::WriteAllText($generated, $content, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Created local profile configuration.'
} else {
    Write-Host 'Keeping your existing local profile configuration.'
}
foreach ($layer in @('runtime','profiles/web')) {
    Write-Host "Installing $layer from the frozen lockfile..."
    Push-Location (Join-Path $root $layer)
    try {
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed in $layer (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
}
Write-Host 'Dependencies installed. Add your own credentials in the Harness UI before sending model requests.'
if (-not $NoStart) { & (Join-Path $root 'Start-Harness.ps1') -Port $Port }
