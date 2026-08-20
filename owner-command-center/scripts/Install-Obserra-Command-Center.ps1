[CmdletBinding()]
param(
    [switch]$Portable,
    [switch]$SkipHostnameCheck,
    [switch]$RequireControlPlaneOperational,
    [int]$VerificationTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bootstrapSource = Join-Path $here "Obserra-Command-Center-Bootstrap.json"
$manifestPath = Join-Path $here "SHA256SUMS.json"
$verificationScript = Join-Path $here "Test-Obserra-Command-Center-Endpoint.ps1"
$endpointDirectory = Join-Path $env:LOCALAPPDATA "Obserra\OwnerCommandCenter"
$portableInstallDirectory = Join-Path $endpointDirectory "Portable"
$installedBootstrap = Join-Path $endpointDirectory "Obserra-Command-Center-Bootstrap.json"
$runtimeInstallationReceiptPath = Join-Path $endpointDirectory "installation-receipt.json"
$installerVerificationPath = Join-Path $endpointDirectory "installer-verification.json"

function Assert-PackageIntegrity {
    if (-not (Test-Path $bootstrapSource)) { throw "Bootstrap profile is missing." }
    if (-not (Test-Path $manifestPath)) { throw "SHA-256 manifest is missing." }
    if (-not (Test-Path $verificationScript)) { throw "Endpoint verification script is missing." }

    $manifest = @(Get-Content $manifestPath -Raw | ConvertFrom-Json)
    if ($manifest.Count -lt 7) { throw "Release hash manifest is incomplete." }
    foreach ($entry in $manifest) {
        $filePath = Join-Path $here $entry.File
        if (-not (Test-Path $filePath)) { throw "Release file missing: $($entry.File)" }
        $actual = (Get-FileHash -Algorithm SHA256 -Path $filePath).Hash
        if ($actual -ne $entry.SHA256) { throw "SHA-256 verification failed for $($entry.File)" }
    }
}

function Assert-TargetProfile {
    $profile = Get-Content $bootstrapSource -Raw | ConvertFrom-Json
    if ($profile.schemaVersion -ne "1.0") { throw "Unsupported bootstrap schema." }
    if ($profile.localOnly -ne $true) { throw "Bootstrap must enforce localOnly=true." }
    if ($profile.requireEnrollment -ne $true) { throw "Bootstrap must require endpoint enrollment." }
    if ($profile.autoEnroll -ne $true) { throw "Target package must enable target-bound automatic enrollment." }
    if ($profile.autoStart -ne $true) { throw "Target package must enable Command Center auto-start." }
    if ([int]$profile.heartbeatIntervalSeconds -lt 5 -or [int]$profile.heartbeatIntervalSeconds -gt 300) {
        throw "Bootstrap heartbeat interval is outside the allowed range."
    }
    $target = [string]$profile.targetHostname
    if (-not $SkipHostnameCheck -and $target -and $target -ne "*" -and $env:COMPUTERNAME.ToLowerInvariant() -ne $target.ToLowerInvariant()) {
        throw "This package targets Windows machine '$target', but it is running on '$env:COMPUTERNAME'. Use -SkipHostnameCheck only after intentional owner review."
    }
    return $profile
}

function Find-InstalledExecutable {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Obserra Owner AI Command Center\Obserra Owner AI Command Center.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\obserra-owner-ai-command-center\Obserra Owner AI Command Center.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
    }
    $programs = Join-Path $env:LOCALAPPDATA "Programs"
    if (Test-Path $programs) {
        $match = Get-ChildItem $programs -Recurse -File -Filter "Obserra Owner AI Command Center.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) { return $match.FullName }
    }
    return $null
}

function Wait-ForEndpointReceipt {
    param([int]$Seconds)
    $receipt = Join-Path $endpointDirectory "endpoint-status.json"
    $deadline = (Get-Date).ToUniversalTime().AddSeconds($Seconds)
    while ((Get-Date).ToUniversalTime() -lt $deadline) {
        if (Test-Path $receipt) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

Assert-PackageIntegrity
$profile = Assert-TargetProfile
New-Item -ItemType Directory -Force -Path $endpointDirectory | Out-Null
Copy-Item $bootstrapSource $installedBootstrap -Force

if ($Portable) {
    $application = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $application) { throw "Portable Obserra executable was not found on this media." }
    New-Item -ItemType Directory -Force -Path $portableInstallDirectory | Out-Null
    $installedPortable = Join-Path $portableInstallDirectory $application.Name
    Copy-Item $application.FullName $installedPortable -Force
    $sourceHash = (Get-FileHash -Algorithm SHA256 -Path $application.FullName).Hash
    $installedHash = (Get-FileHash -Algorithm SHA256 -Path $installedPortable).Hash
    if ($sourceHash -ne $installedHash) { throw "Portable executable copy failed integrity verification." }
    $env:OBSERRA_COMMAND_CENTER_BOOTSTRAP = $installedBootstrap
    Start-Process -FilePath $installedPortable
} else {
    $application = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-*.exe" | Where-Object { $_.Name -notlike "*Portable*" } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $application) { throw "One-click Obserra installer was not found on this media." }
    Start-Process -FilePath $application.FullName -Wait

    if (-not (Wait-ForEndpointReceipt -Seconds 10)) {
        $installedExecutable = Find-InstalledExecutable
        if (-not $installedExecutable) { throw "Installed Command Center executable could not be located." }
        Start-Process -FilePath $installedExecutable
    }
}

$verificationParameters = @{
    TimeoutSeconds = $VerificationTimeoutSeconds
    ExpectedHostname = $env:COMPUTERNAME
}
if ($RequireControlPlaneOperational) { $verificationParameters.RequireControlPlaneOperational = $true }
$verification = & $verificationScript @verificationParameters
if (-not $verification.Verified) { throw "Endpoint verification did not return a verified result." }
if (-not (Test-Path $runtimeInstallationReceiptPath)) { throw "The running Command Center did not create installation-receipt.json." }
$runtimeInstallationReceipt = Get-Content $runtimeInstallationReceiptPath -Raw | ConvertFrom-Json
if ($runtimeInstallationReceipt.endpointReady -ne $true) { throw "The runtime installation receipt is not endpoint ready." }
if ([string]$runtimeInstallationReceipt.deviceId -ne [string]$verification.DeviceId) { throw "Runtime installation receipt identity mismatch." }

$installerReceipt = [ordered]@{
    schemaVersion = "1.0"
    packageProfileId = [string]$profile.profileId
    targetHostname = [string]$profile.targetHostname
    installedHostname = $env:COMPUTERNAME
    portable = [bool]$Portable
    endpointReady = [bool]$verification.EndpointReady
    controlPlaneOperational = [bool]$verification.ControlPlaneOperational
    deviceId = [string]$verification.DeviceId
    deviceFingerprint = [string]$verification.DeviceFingerprint
    appVersion = [string]$verification.AppVersion
    enrollmentState = [string]$verification.EnrollmentState
    bootstrapProfileId = [string]$verification.BootstrapProfileId
    readinessUrl = [string]$verification.ReadinessUrl
    receiptPath = [string]$verification.ReceiptPath
    runtimeInstallationReceiptPath = $runtimeInstallationReceiptPath
    verifiedAt = (Get-Date).ToUniversalTime().ToString("o")
}
$installerReceipt | ConvertTo-Json -Depth 5 | Set-Content $installerVerificationPath -Encoding UTF8

Write-Host "[Obserra] Command Center is installed or launched, endpoint-enrolled, heartbeat-current, and loopback-ready on $env:COMPUTERNAME."
if (-not $verification.ControlPlaneOperational) {
    Write-Warning "The endpoint is live, but the Academy control plane still reports governed blockers. Review the Command Center Academy Production Evidence panel."
}
$installerReceipt
