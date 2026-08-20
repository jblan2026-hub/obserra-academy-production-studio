[CmdletBinding()]
param(
    [int]$TimeoutSeconds = 120,
    [string]$ExpectedHostname = $env:COMPUTERNAME,
    [switch]$RequireControlPlaneOperational
)

$ErrorActionPreference = "Stop"
$endpointDirectory = Join-Path $env:LOCALAPPDATA "Obserra\OwnerCommandCenter"
$receiptPath = Join-Path $endpointDirectory "endpoint-status.json"
$installationReceiptPath = Join-Path $endpointDirectory "installation-receipt.json"
$deadline = (Get-Date).ToUniversalTime().AddSeconds([Math]::Max(10, $TimeoutSeconds))
$lastError = $null

function Test-Receipt {
    param([Parameter(Mandatory = $true)][object]$Receipt)

    if ($Receipt.schemaVersion -ne "1.0") { throw "Unsupported endpoint receipt schema." }
    if ([string]::IsNullOrWhiteSpace([string]$Receipt.deviceId)) { throw "Endpoint device identity is missing." }
    if ([string]::IsNullOrWhiteSpace([string]$Receipt.deviceFingerprint)) { throw "Endpoint device fingerprint is missing." }
    if ([string]$Receipt.hostname -ine $ExpectedHostname) { throw "Endpoint receipt hostname does not match $ExpectedHostname." }
    if ($Receipt.localOnly -ne $true) { throw "Endpoint is not reporting the local-only security boundary." }
    if ($Receipt.windowsEncryption -ne $true) { throw "Windows credential encryption is not available." }
    if ($Receipt.bootstrap.applied -ne $true) { throw "Target bootstrap is not applied." }
    if ([string]$Receipt.enrollment.state -ne "enrolled") { throw "Endpoint enrollment is not verified." }
    if ($Receipt.endpointReady -ne $true) { throw "Endpoint readiness is blocked." }
    if ($RequireControlPlaneOperational -and $Receipt.controlPlaneOperational -ne $true) { throw "The Academy control plane is not operational." }
    if ([string]::IsNullOrWhiteSpace([string]$Receipt.healthServer.readinessUrl)) { throw "Loopback readiness URL is missing." }

    $heartbeat = [DateTimeOffset]::Parse([string]$Receipt.lastHeartbeatAt).UtcDateTime
    $ageSeconds = ((Get-Date).ToUniversalTime() - $heartbeat).TotalSeconds
    if ($ageSeconds -lt 0 -or $ageSeconds -gt 60) { throw "Endpoint heartbeat is stale at $([Math]::Round($ageSeconds, 1)) seconds." }

    $ready = Invoke-RestMethod -Method Get -Uri ([string]$Receipt.healthServer.readinessUrl) -TimeoutSec 10
    if ([string]$ready.status -ne "ready" -or $ready.endpointReady -ne $true) {
        throw "Loopback readiness service did not confirm endpoint readiness."
    }
    if ([string]$ready.deviceId -ne [string]$Receipt.deviceId) {
        throw "Loopback readiness identity does not match the endpoint receipt."
    }

    return [pscustomobject]@{
        Verified = $true
        Hostname = [string]$Receipt.hostname
        DeviceId = [string]$Receipt.deviceId
        DeviceFingerprint = [string]$Receipt.deviceFingerprint
        AppVersion = [string]$Receipt.appVersion
        EndpointReady = [bool]$Receipt.endpointReady
        ControlPlaneOperational = [bool]$Receipt.controlPlaneOperational
        EnrollmentState = [string]$Receipt.enrollment.state
        BootstrapProfileId = [string]$Receipt.bootstrap.profileId
        HeartbeatAgeSeconds = [Math]::Round($ageSeconds, 1)
        ReadinessUrl = [string]$Receipt.healthServer.readinessUrl
        ReceiptPath = $receiptPath
        InstallationReceiptPath = $installationReceiptPath
        VerifiedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
}

while ((Get-Date).ToUniversalTime() -lt $deadline) {
    try {
        if (-not (Test-Path $receiptPath)) { throw "Endpoint receipt has not been created." }
        $receipt = Get-Content $receiptPath -Raw | ConvertFrom-Json
        $result = Test-Receipt -Receipt $receipt
        if (-not (Test-Path $installationReceiptPath)) { throw "Installation receipt has not been created." }
        $installationReceipt = Get-Content $installationReceiptPath -Raw | ConvertFrom-Json
        if ($installationReceipt.endpointReady -ne $true) { throw "Installation receipt is not endpoint ready." }
        if ([string]$installationReceipt.deviceId -ne [string]$result.DeviceId) { throw "Installation and endpoint receipts do not share the same device identity." }
        $result
        exit 0
    } catch {
        $lastError = $_.Exception.Message
        Start-Sleep -Seconds 2
    }
}

throw "Obserra Command Center endpoint verification did not pass within $TimeoutSeconds seconds. Last condition: $lastError"
