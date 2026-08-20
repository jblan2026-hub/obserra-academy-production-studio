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
        }
        finally {
            $algorithm.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Get-LatestReleaseExecutable {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][ValidateSet("installer", "portable")][string]$Kind
    )

    $files = @(Get-ChildItem -LiteralPath $Directory -File -Filter "*.exe")
    if ($Kind -eq "portable") {
        $matches = @(
            $files | Where-Object {
                $_.Name -match '^Obserra-(?:Academy|Owner-AI)-Command-Center-Portable-[0-9]+\.[0-9]+\.[0-9]+-x64\.exe$'
            }
        )
    }
    else {
        $matches = @(
            $files | Where-Object {
                $_.Name -match '^Obserra-(?:Academy|Owner-AI)-Command-Center-[0-9]+\.[0-9]+\.[0-9]+-x64\.exe$'
                -and $_.Name -notlike '*Portable*'
                -and $_.Name -notlike '*uninstaller*'
            }
        )
    }

    return $matches | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
}

Push-Location $root
try {
    npm run verify
    npm run package:windows
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $dist)) {
    throw "Packaging output was not created at $dist"
}
if (Test-Path -LiteralPath $destinationPath) {
    Remove-Item -LiteralPath $destinationPath -Recurse -Force
}
New-Item -ItemType Directory -Path $destinationPath | Out-Null

$installer = Get-LatestReleaseExecutable -Directory $dist -Kind installer
$portable = Get-LatestReleaseExecutable -Directory $dist -Kind portable
if (-not $installer) {
    $available = @(Get-ChildItem -LiteralPath $dist -File | Select-Object -ExpandProperty Name) -join ", "
    throw "One-click installer executable was not produced. Available dist files: $available"
}
if (-not $portable) {
    $available = @(Get-ChildItem -LiteralPath $dist -File | Select-Object -ExpandProperty Name) -join ", "
    throw "Portable executable was not produced. Available dist files: $available"
}

Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $destinationPath $installer.Name)
Copy-Item -LiteralPath $portable.FullName -Destination (Join-Path $destinationPath $portable.Name)
Copy-Item -LiteralPath (Join-Path $root "INSTALL-AND-RECOVERY.md") -Destination (Join-Path $destinationPath "INSTALL-AND-RECOVERY.md")
Copy-Item -LiteralPath (Join-Path $root "HIGH-AVAILABILITY.md") -Destination (Join-Path $destinationPath "HIGH-AVAILABILITY.md")
Copy-Item -LiteralPath (Join-Path $root "ENDPOINT-OPERATIONS.md") -Destination (Join-Path $destinationPath "ENDPOINT-OPERATIONS.md")
Copy-Item -LiteralPath (Join-Path $root "scripts\Install-Obserra-Command-Center.ps1") -Destination (Join-Path $destinationPath "Install-Obserra-Command-Center.ps1")
Copy-Item -LiteralPath (Join-Path $root "scripts\Test-Obserra-Command-Center-Endpoint.ps1") -Destination (Join-Path $destinationPath "Test-Obserra-Command-Center-Endpoint.ps1")

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
    zeroDowntimeReleaseRequired = $true
    installer = $installer.Name
    portable = $portable.Name
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
$bootstrap | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $bootstrapPath -Encoding UTF8

$hashTargets = Get-ChildItem -LiteralPath $destinationPath -File | Where-Object {
    $_.Name -notin @("SHA256SUMS.json", "SHA256SUMS.txt")
}
$hashes = $hashTargets | ForEach-Object {
    [pscustomobject]@{
        File = $_.Name
        SHA256 = Get-Sha256Hex -Path $_.FullName
        Bytes = $_.Length
    }
}
$hashes | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $destinationPath "SHA256SUMS.json") -Encoding UTF8
$hashes | ForEach-Object {
    "{0}  {1}" -f $_.SHA256, $_.File
} | Set-Content -LiteralPath (Join-Path $destinationPath "SHA256SUMS.txt") -Encoding ASCII

Write-Host "[Obserra] Target-bound Command Center release media created at $destinationPath for machine $TargetHostname"
Write-Host "[Obserra] Installer: $($installer.Name)"
Write-Host "[Obserra] Portable: $($portable.Name)"
Write-Host "[Obserra] Run .\Install-Obserra-Command-Center.ps1 and require endpoint receipt verification before declaring the installation live."
