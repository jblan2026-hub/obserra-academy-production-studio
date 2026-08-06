[CmdletBinding()]
param(
    [string]$Destination,
    [string]$TargetHostname = "obserra"
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDirectory "..")).Path
$dist = Join-Path $root "dist"
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
if (Test-Path $destinationPath) { Remove-Item $destinationPath -Recurse -Force }
New-Item -ItemType Directory -Path $destinationPath | Out-Null

$installer = Get-ChildItem $dist -Filter "Obserra-Owner-AI-Command-Center-*.exe" | Where-Object { $_.Name -notlike "*Portable*" } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$portable = Get-ChildItem $dist -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $installer) { throw "One-click installer executable was not produced." }
if (-not $portable) { throw "Portable executable was not produced." }

Copy-Item $installer.FullName (Join-Path $destinationPath $installer.Name)
Copy-Item $portable.FullName (Join-Path $destinationPath $portable.Name)
Copy-Item (Join-Path $root "INSTALL-AND-RECOVERY.md") (Join-Path $destinationPath "INSTALL-AND-RECOVERY.md")
Copy-Item (Join-Path $root "HIGH-AVAILABILITY.md") (Join-Path $destinationPath "HIGH-AVAILABILITY.md")

$bootstrap = [ordered]@{
    schemaVersion = "1.0"
    profileId = "obserra-owner-command-center-default"
    targetHostname = $TargetHostname.ToLowerInvariant()
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    connectors = @(
        @{ id = "lcms"; url = "https://www.obserrallc.com" },
        @{ id = "academy"; url = "https://www.obserrallc.com" },
        @{ id = "website"; url = "https://www.obserrallc.com" },
        @{ id = "store"; url = "https://www.obserrallc.com" },
        @{ id = "stripe"; url = "https://api.stripe.com" },
        @{ id = "github"; url = "https://api.github.com" },
        @{ id = "vercel"; url = "https://api.vercel.com" },
        @{ id = "clerk"; url = "https://api.clerk.com" },
        @{ id = "localAi"; url = "http://127.0.0.1:11434" }
    )
}
$bootstrapPath = Join-Path $destinationPath "Obserra-Command-Center-Bootstrap.json"
$bootstrap | ConvertTo-Json -Depth 5 | Set-Content $bootstrapPath -Encoding UTF8

$installScript = @'
[CmdletBinding()]
param(
    [switch]$Portable,
    [switch]$SkipHostnameCheck
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bootstrap = Join-Path $here "Obserra-Command-Center-Bootstrap.json"
$manifestPath = Join-Path $here "SHA256SUMS.json"
if (-not (Test-Path $bootstrap)) { throw "Bootstrap profile is missing." }
if (-not (Test-Path $manifestPath)) { throw "SHA-256 manifest is missing." }

$profile = Get-Content $bootstrap -Raw | ConvertFrom-Json
$target = [string]$profile.targetHostname
if (-not $SkipHostnameCheck -and $target -and $target -ne "*" -and $env:COMPUTERNAME.ToLowerInvariant() -ne $target.ToLowerInvariant()) {
    throw "This package targets Windows machine '$target', but it is running on '$env:COMPUTERNAME'. Use -SkipHostnameCheck only after intentional owner review."
}

$manifest = @(Get-Content $manifestPath -Raw | ConvertFrom-Json)
foreach ($entry in $manifest) {
    $filePath = Join-Path $here $entry.File
    if (-not (Test-Path $filePath)) { throw "Release file missing: $($entry.File)" }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $filePath).Hash
    if ($actual -ne $entry.SHA256) { throw "SHA-256 verification failed for $($entry.File)" }
}

$bootstrapDirectory = Join-Path $env:LOCALAPPDATA "Obserra\OwnerCommandCenter"
New-Item -ItemType Directory -Force -Path $bootstrapDirectory | Out-Null
Copy-Item $bootstrap (Join-Path $bootstrapDirectory "Obserra-Command-Center-Bootstrap.json") -Force

if ($Portable) {
    $app = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $app) { throw "Portable Obserra executable was not found on this media." }
    $env:OBSERRA_COMMAND_CENTER_BOOTSTRAP = $bootstrap
    Start-Process -FilePath $app.FullName
} else {
    $app = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-*.exe" | Where-Object { $_.Name -notlike "*Portable*" } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $app) { throw "One-click Obserra installer was not found on this media." }
    Start-Process -FilePath $app.FullName -Wait
}

Write-Host "[Obserra] Command Center package verified and launched for $env:COMPUTERNAME."
'@
Set-Content (Join-Path $destinationPath "Install-Obserra-Command-Center.ps1") $installScript -Encoding UTF8

$hashTargets = Get-ChildItem $destinationPath -File | Where-Object { $_.Name -notin @("SHA256SUMS.json", "SHA256SUMS.txt") }
$hashes = $hashTargets | ForEach-Object {
    [pscustomobject]@{ File = $_.Name; SHA256 = Get-Sha256Hex -Path $_.FullName; Bytes = $_.Length }
}
$hashes | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $destinationPath "SHA256SUMS.json") -Encoding UTF8
$hashes | ForEach-Object { "{0}  {1}" -f $_.SHA256, $_.File } | Set-Content (Join-Path $destinationPath "SHA256SUMS.txt") -Encoding ASCII

Write-Host "[Obserra] Removable-media package created at $destinationPath for machine $TargetHostname"
