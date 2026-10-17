$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { throw 'Release verification requires a Git checkout.' }
Push-Location $root
try {
    # A review of working files cannot approve different bytes already staged for commit.
    git diff --quiet --
    if ($LASTEXITCODE -ne 0) { throw 'Unstaged changes exist. Review and stage them before release verification.' }
    $names = @(git ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0 -or $names.Count -eq 0) { throw 'Cannot enumerate release files.' }
    $bad = @()
    $rules = @(
        @{ Name = 'personal Windows path'; Regex = 'C:[/\\]Users[/\\]|C:[/\\]All[/\\]Project|AppData[/\\]Local' },
        @{ Name = 'private key header'; Regex = '-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----' },
        @{ Name = 'credential value'; Regex = '(?i)(?:access_token|refresh_token|client_secret|password)\s*[:=]\s*["'' ]*[A-Za-z0-9_\-]{20,}' },
        @{ Name = 'API token pattern'; Regex = '(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})' },
        @{ Name = 'URL token'; Regex = '(?i)https?://[^\s"'']+[?&](?:token|key|auth|secret)=[^\s&"'']+' }
    )
    foreach ($name in $names) {
        if ($name -match '(^|/)(?:\.git|sessions|attachments|storages|logs|node_modules|source-snapshot|dsh-config-manager|dsh-checkpoint-rewind)(/|$)' -or
            $name -match '(^|/)(?:\.credentials[^/]*|settings\.yaml(?:\.imported)?|auth\.json|\.anonymous-user-id|\.env(?:\..*)?|\.npmrc|\.pypirc|id_(?:rsa|ed25519)|[^/]+\.(?:pem|p12|pfx|key))$' -or
            $name -eq 'profiles/web/cordis.patch.yml' -or
            $name -match '\.(?:png|jpe?g|zip|zstd|db|sqlite|token|log)$') {
            $bad += "$name : forbidden private/state path"; continue
        }
        $item = Get-Item -LiteralPath (Join-Path $root $name) -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $bad += "$name : reparse point"; continue }
        if ($item.Length -gt 8MB) { $bad += "$name : too large to inspect"; continue }
        $content = [IO.File]::ReadAllText($item.FullName)
        if ($content.Contains([char]0)) { $bad += "$name : binary file"; continue }
        foreach ($rule in $rules) { if ([regex]::IsMatch($content, $rule.Regex)) { $bad += "$name : $($rule.Name)" } }
    }
    if ($bad.Count -gt 0) { foreach ($finding in $bad) { Write-Error $finding -ErrorAction Continue }; exit 1 }
    Write-Host "PASS: inspected $($names.Count) release files; no known private/state paths or token signatures."
    exit 0
} finally { Pop-Location }
