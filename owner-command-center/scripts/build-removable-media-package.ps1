[CmdletBinding()]
param(
    [string]$Destination,
    [string]$TargetHostname = "*",
    [switch]$CleanDestination
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDirectory "..")).Path
$dist = Join-Path $root "dist"
$templateBootstrap = Join-Path $root "resources\Obserra-Command-Center-Bootstrap.json"
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $root "release-media"
}
$destinationPath = [System.IO.Path]::GetFullPath($Destination)

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $algorithm.ComputeHash($stream)
            return ([System.BitConverter]::ToString($bytes)).Replace("-", "")
        } finally { $algorithm.Dispose() }
    } finally { $stream.Dispose() }
}

Push-Location $root
try {
    npm run verify
    npm run package:windows
} finally { Pop-Location }

if (-not (Test-Path $dist)) { throw "Packaging output was not created at $dist" }
if (-not (Test-Path $templateBootstrap)) { throw "Generic bootstrap template is missing at $templateBootstrap" }

if (Test-Path $destinationPath) {
    $existing = @(Get-ChildItem -LiteralPath $destinationPath -Force -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0) {
        if ($CleanDestination) {
            try {
                Remove-Item -LiteralPath $destinationPath -Recurse -Force -ErrorAction Stop
            } catch {
                throw "The requested release directory cannot be cleaned because a file is open. Close any running portable Command Center and retry, or omit -CleanDestination to create a versioned folder. $($_.Exception.Message)"
            }
        } else {
            $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
            $destinationPath = Join-Path $destinationPath "Obserra-Command-Center-$timestamp"
        }
    }
}
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null

$installer = Get-ChildItem $dist -Filter "Obserra-Owner-AI-Command-Center-Setup-*.exe" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$portable = Get-ChildItem $dist -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $installer) { throw "Standard Windows setup executable was not produced." }
if (-not $portable) { throw "Portable executable was not produced." }

Copy-Item $installer.FullName (Join-Path $destinationPath $installer.Name)
Copy-Item $portable.FullName (Join-Path $destinationPath $portable.Name)
Copy-Item (Join-Path $root "INSTALL-AND-RECOVERY.md") (Join-Path $destinationPath "INSTALL-AND-RECOVERY.md")
Copy-Item (Join-Path $root "HIGH-AVAILABILITY.md") (Join-Path $destinationPath "HIGH-AVAILABILITY.md")
Copy-Item (Join-Path $root "ENDPOINT-OPERATIONS.md") (Join-Path $destinationPath "ENDPOINT-OPERATIONS.md")
Copy-Item (Join-Path $root "scripts\Install-Obserra-Command-Center.ps1") (Join-Path $destinationPath "Install-Obserra-Command-Center.ps1")
Copy-Item (Join-Path $root "scripts\Test-Obserra-Command-Center-Endpoint.ps1") (Join-Path $destinationPath "Test-Obserra-Command-Center-Endpoint.ps1")

$bootstrap = Get-Content $templateBootstrap -Raw | ConvertFrom-Json
$normalizedTarget = if ([string]::IsNullOrWhiteSpace($TargetHostname)) { "*" } else { $TargetHostname.Trim().ToLowerInvariant() }
$bootstrap.targetHostname = $normalizedTarget
$bootstrap.generatedAt = (Get-Date).ToUniversalTime().ToString("o")
$bootstrap.autoEnroll = $normalizedTarget -ne "*"
$bootstrap.enrollmentMode = if ($bootstrap.autoEnroll) { "target-bound-automatic-enrollment" } else { "explicit-owner-device-enrollment" }
$bootstrapPath = Join-Path $destinationPath "Obserra-Command-Center-Bootstrap.json"
$bootstrap | ConvertTo-Json -Depth 8 | Set-Content $bootstrapPath -Encoding UTF8

$hashTargets = Get-ChildItem $destinationPath -File | Where-Object { $_.Name -notin @("SHA256SUMS.json", "SHA256SUMS.txt") }
$hashes = $hashTargets | ForEach-Object {
    [pscustomobject]@{
        File = $_.Name
        SHA256 = Get-Sha256Hex -Path $_.FullName
        Bytes = $_.Length
    }
}
$hashes | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $destinationPath "SHA256SUMS.json") -Encoding UTF8
$hashes | ForEach-Object { "{0}  {1}" -f $_.SHA256, $_.File } | Set-Content (Join-Path $destinationPath "SHA256SUMS.txt") -Encoding ASCII

Write-Host "[Obserra] Standard release media created at $destinationPath"
Write-Host "[Obserra] Normal owner installation: double-click $($installer.Name). No PowerShell is required."
Write-Host "[Obserra] The PowerShell installer remains only for optional enterprise automation and endpoint evidence collection."
