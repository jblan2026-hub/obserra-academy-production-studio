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
Copy-Item (Join-Path $root "ENDPOINT-OPERATIONS.md") (Join-Path $destinationPath "ENDPOINT-OPERATIONS.md")
Copy-Item (Join-Path $root "scripts\Install-Obserra-Command-Center.ps1") (Join-Path $destinationPath "Install-Obserra-Command-Center.ps1")
Copy-Item (Join-Path $root "scripts\Test-Obserra-Command-Center-Endpoint.ps1") (Join-Path $destinationPath "Test-Obserra-Command-Center-Endpoint.ps1")

$bootstrap = [ordered]@{
    schemaVersion = "1.0"
    profileId = "obserra-owner-command-center-live-endpoint"
    targetHostname = $TargetHostname.ToLowerInvariant()
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    localOnly = $true
    requireEnrollment = $true
    autoEnroll = $true
    autoStart = $true
    heartbeatIntervalSeconds = 15
    expectedCourseWorkerTarget = 36
    expectedApplicationWorkerAllocation = 0
    requiredWorkerMode = "interchangeable-course-production"
    publicationAuthorityGranted = $false
    connectors = @(
        @{ id = "lcms"; url = "https://www.obserrallc.com" },
        @{ id = "academy"; url = "https://www.obserrallc.com" },
        @{ id = "website"; url = "https://www.obserrallc.com" },
        @{ id = "store"; url = "https://www.obserrallc.com" },
        @{ id = "eios"; url = "https://obserra-eios-console.vercel.app" },
        @{ id = "stripe"; url = "https://api.stripe.com" },
        @{ id = "github"; url = "https://api.github.com" },
        @{ id = "vercel"; url = "https://api.vercel.com" },
        @{ id = "clerk"; url = "https://api.clerk.com" },
        @{ id = "localAi"; url = "http://127.0.0.1:11434" }
    )
}
$bootstrapPath = Join-Path $destinationPath "Obserra-Command-Center-Bootstrap.json"
$bootstrap | ConvertTo-Json -Depth 6 | Set-Content $bootstrapPath -Encoding UTF8

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

Write-Host "[Obserra] Target-bound Command Center release media created at $destinationPath for machine $TargetHostname"
Write-Host "[Obserra] Run .\Install-Obserra-Command-Center.ps1 and require endpoint receipt verification before declaring the installation live."
