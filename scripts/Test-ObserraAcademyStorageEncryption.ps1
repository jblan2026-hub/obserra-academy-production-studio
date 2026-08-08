[CmdletBinding()]
param(
    [string]$ProductionRoot = 'C:\ObserraAcademyProduction',
    [switch]$FailIfUnprotected
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-Result {
    param(
        [bool]$Protected,
        [string]$Reason,
        [string]$MountPoint,
        [string]$ProtectionStatus,
        [string]$VolumeStatus,
        [string]$EncryptionMethod
    )

    [pscustomobject]@{
        schemaVersion = '1.0'
        checkedAtUtc = [DateTime]::UtcNow.ToString('o')
        productionRoot = $ProductionRoot
        mountPoint = $MountPoint
        protected = $Protected
        reason = $Reason
        protectionStatus = $ProtectionStatus
        volumeStatus = $VolumeStatus
        encryptionMethod = $EncryptionMethod
        recoveryMaterialIncluded = $false
    }
}

$resolvedRoot = [System.IO.Path]::GetFullPath($ProductionRoot)
$rootPath = [System.IO.Path]::GetPathRoot($resolvedRoot)
if ([string]::IsNullOrWhiteSpace($rootPath)) {
    throw ('Unable to determine volume for production root: {0}' -f $ProductionRoot)
}

$mountPoint = $rootPath.TrimEnd('\')
if (-not (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) {
    $result = New-Result -Protected $false -Reason 'Get-BitLockerVolume is unavailable on this Windows endpoint.' -MountPoint $mountPoint -ProtectionStatus 'Unknown' -VolumeStatus 'Unknown' -EncryptionMethod 'Unknown'
    $result | ConvertTo-Json -Depth 4
    if ($FailIfUnprotected) { exit 20 }
    exit 0
}

$volume = Get-BitLockerVolume -MountPoint $mountPoint -ErrorAction Stop
$protectionStatus = [string]$volume.ProtectionStatus
$volumeStatus = [string]$volume.VolumeStatus
$encryptionMethod = [string]$volume.EncryptionMethod

$protected = ($protectionStatus -eq 'On') -and ($volumeStatus -in @('FullyEncrypted', 'EncryptionInProgress')) -and ($encryptionMethod -notin @('', 'None', 'Unknown'))
$reason = if ($protected) {
    'Academy production volume is protected by BitLocker.'
} else {
    'Academy production volume is not confirmed as BitLocker-protected.'
}

$result = New-Result -Protected $protected -Reason $reason -MountPoint $mountPoint -ProtectionStatus $protectionStatus -VolumeStatus $volumeStatus -EncryptionMethod $encryptionMethod
$result | ConvertTo-Json -Depth 4

if ($FailIfUnprotected -and -not $protected) {
    exit 21
}
