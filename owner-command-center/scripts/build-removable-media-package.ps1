[CmdletBinding()]
param(
    [string]$Destination,
    [string]$TargetHostname = "obserra",
    [string]$AcademyStudioRootHint = ""
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDirectory "..")).Path
$repositoryRoot = (Resolve-Path (Join-Path $root "..")).Path
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

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path -PathType Leaf)) { throw "Required JSON file is missing: $Path" }
    return Get-Content $Path -Raw | ConvertFrom-Json
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

$workerContractPath = Join-Path $repositoryRoot "policy\elastic-worker-pool-contract.json"
$productionStandardPath = Join-Path $repositoryRoot "policy\commercial-cinematic-course-production-standard.json"
$packageLockPath = Join-Path $root "package-lock.json"
$dependencyLockFileName = "Obserra-Command-Center-Dependency-Lock.json"
$workerContract = Read-JsonFile -Path $workerContractPath
$productionStandard = Read-JsonFile -Path $productionStandardPath
$packageLock = Read-JsonFile -Path $packageLockPath
Copy-Item $workerContractPath (Join-Path $destinationPath "Obserra-Worker-Pool-Contract.json")
Copy-Item $productionStandardPath (Join-Path $destinationPath "Obserra-Commercial-Course-Production-Standard.json")
Copy-Item $packageLockPath (Join-Path $destinationPath $dependencyLockFileName)

$packageJson = Read-JsonFile -Path (Join-Path $root "package.json")
if ([string]$packageLock.name -ne [string]$packageJson.name -or [string]$packageLock.version -ne [string]$packageJson.version) {
    throw "Command Center package-lock identity does not match package.json."
}
$dependencyLockSha256 = Get-Sha256Hex -Path $packageLockPath
$dependencyLockPackageCount = @($packageLock.packages.PSObject.Properties).Count
$installerSignature = Get-AuthenticodeSignature -FilePath $installer.FullName
$portableSignature = Get-AuthenticodeSignature -FilePath $portable.FullName
$release = [ordered]@{
    schemaVersion = "1.1"
    productName = [string]$packageJson.build.productName
    appId = [string]$packageJson.build.appId
    version = [string]$packageJson.version
    targetHostname = $TargetHostname.ToLowerInvariant()
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    workerContractId = [string]$workerContract.contractId
    totalLogicalWorkers = [int]$workerContract.totalLogicalWorkers
    productionStandardId = [string]$productionStandard.standardId
    qualityTier = [string]$productionStandard.qualityTier
    dependencyLock = [ordered]@{
        file = $dependencyLockFileName
        packageManager = [string]$packageJson.packageManager
        lockfileVersion = [int]$packageLock.lockfileVersion
        packageCount = [int]$dependencyLockPackageCount
        sha256 = $dependencyLockSha256
    }
    defaultParallelAllocation = [ordered]@{
        academyWorkers = 28
        commandCenterWorkers = 8
        unrelatedApplicationWorkers = 0
        idleWorkers = 0
    }
    installer = [ordered]@{
        file = $installer.Name
        authenticodeStatus = [string]$installerSignature.Status
        signer = if ($installerSignature.SignerCertificate) { $installerSignature.SignerCertificate.Subject } else { $null }
    }
    portable = [ordered]@{
        file = $portable.Name
        authenticodeStatus = [string]$portableSignature.Status
        signer = if ($portableSignature.SignerCertificate) { $portableSignature.SignerCertificate.Subject } else { $null }
    }
    productionDistributionRequiresTrustedCodeSigning = $true
    ownerEndpointInstallationMayProceedAfterHashVerification = $true
}
$releasePath = Join-Path $destinationPath "Obserra-Command-Center-Release.json"
$release | ConvertTo-Json -Depth 8 | Set-Content $releasePath -Encoding UTF8

$bootstrap = [ordered]@{
    schemaVersion = "1.0"
    profileId = "obserra-owner-command-center-default"
    targetHostname = $TargetHostname.ToLowerInvariant()
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    academyStudioRootHint = $AcademyStudioRootHint
    workerContractId = [string]$workerContract.contractId
    productionStandardId = [string]$productionStandard.standardId
    dependencyLockSha256 = $dependencyLockSha256
    connectors = @(
        @{ id = "lcms"; url = "https://www.obserrallc.com" },
        @{ id = "academy"; url = "https://www.obserrallc.com" },
        @{ id = "website"; url = "https://www.obserrallc.com" },
        @{ id = "store"; url = "https://www.obserrallc.com" },
        @{ id = "eios"; url = "https://obserra-eios-dual-mode-module-platform.vercel.app" },
        @{ id = "stripe"; url = "https://api.stripe.com" },
        @{ id = "github"; url = "https://api.github.com" },
        @{ id = "vercel"; url = "https://api.vercel.com" },
        @{ id = "clerk"; url = "https://api.clerk.com" },
        @{ id = "localAi"; url = "http://127.0.0.1:11434" }
    )
}
$bootstrapPath = Join-Path $destinationPath "Obserra-Command-Center-Bootstrap.json"
$bootstrap | ConvertTo-Json -Depth 8 | Set-Content $bootstrapPath -Encoding UTF8

$testScript = @'
[CmdletBinding()]
param(
    [switch]$Portable,
    [switch]$SkipHostnameCheck,
    [switch]$RequireAuthenticode,
    [string]$StudioRoot = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$localRoot = Join-Path $env:LOCALAPPDATA "Obserra\OwnerCommandCenter"
$bootstrapPath = Join-Path $localRoot "Obserra-Command-Center-Bootstrap.json"
$releasePath = Join-Path $here "Obserra-Command-Center-Release.json"
if (-not (Test-Path $bootstrapPath -PathType Leaf)) { throw "Installed bootstrap profile is missing: $bootstrapPath" }
if (-not (Test-Path $releasePath -PathType Leaf)) { throw "Release descriptor is missing: $releasePath" }
$profile = Get-Content $bootstrapPath -Raw | ConvertFrom-Json
$release = Get-Content $releasePath -Raw | ConvertFrom-Json
$hostname = $env:COMPUTERNAME.ToLowerInvariant()
$target = [string]$profile.targetHostname
if (-not $SkipHostnameCheck -and $target -and $target -ne "*" -and $hostname -ne $target.ToLowerInvariant()) {
    throw "Installed profile targets '$target', but this endpoint is '$hostname'."
}

$dependencyLockPath = Join-Path $here ([string]$release.dependencyLock.file)
if (-not (Test-Path $dependencyLockPath -PathType Leaf)) {
    throw "Dependency lock evidence is missing: $dependencyLockPath"
}
$dependencyLockSha256 = (Get-FileHash -Algorithm SHA256 -Path $dependencyLockPath).Hash
if ($dependencyLockSha256 -ne [string]$release.dependencyLock.sha256) {
    throw "Dependency lock evidence does not match the governed release descriptor."
}
if ([string]$profile.dependencyLockSha256 -ne $dependencyLockSha256) {
    throw "Installed bootstrap dependency-lock identity does not match the governed release."
}

$executable = $null
if ($Portable) {
    $portableRoot = Join-Path $localRoot "Portable"
    $executable = Get-ChildItem $portableRoot -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
} else {
    $knownCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Obserra Owner AI Command Center\Obserra Owner AI Command Center.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\obserra-owner-ai-command-center\Obserra Owner AI Command Center.exe")
    )
    $executable = $knownCandidates | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
    if (-not $executable) {
        $programsRoot = Join-Path $env:LOCALAPPDATA "Programs"
        if (Test-Path $programsRoot) {
            $executable = Get-ChildItem $programsRoot -Filter "Obserra Owner AI Command Center.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        }
    }
}
if (-not $executable) { throw "Installed Command Center executable could not be located." }
$executablePath = if ($executable -is [System.IO.FileInfo]) { $executable.FullName } else { [string]$executable }
$signature = Get-AuthenticodeSignature -FilePath $executablePath
if ($RequireAuthenticode -and $signature.Status -ne "Valid") {
    throw "Trusted Authenticode signature is required, but status is '$($signature.Status)'."
}

$effectiveStudioRoot = $StudioRoot
if ([string]::IsNullOrWhiteSpace($effectiveStudioRoot)) {
    $effectiveStudioRoot = [Environment]::GetEnvironmentVariable("OBSERRA_ACADEMY_STUDIO_ROOT", "User")
}
$studioReady = $false
if (-not [string]::IsNullOrWhiteSpace($effectiveStudioRoot)) {
    $candidate = [System.IO.Path]::GetFullPath($effectiveStudioRoot)
    $studioReady = (Test-Path (Join-Path $candidate "package.json")) -and (Test-Path (Join-Path $candidate "courses")) -and (Test-Path (Join-Path $candidate "studio")) -and (Test-Path (Join-Path $candidate "policy\elastic-worker-pool-contract.json"))
}

$health = [ordered]@{
    schemaVersion = "1.1"
    verifiedAt = (Get-Date).ToUniversalTime().ToString("o")
    hostname = $hostname
    targetHostname = $target
    executablePath = $executablePath
    executableSha256 = (Get-FileHash -Algorithm SHA256 -Path $executablePath).Hash
    authenticodeStatus = [string]$signature.Status
    signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    bootstrapPath = $bootstrapPath
    bootstrapEnvironment = [Environment]::GetEnvironmentVariable("OBSERRA_COMMAND_CENTER_BOOTSTRAP", "User")
    academyStudioRoot = $effectiveStudioRoot
    academyStudioReady = $studioReady
    workerContractId = [string]$release.workerContractId
    productionStandardId = [string]$release.productionStandardId
    qualityTier = [string]$release.qualityTier
    packageManager = [string]$release.dependencyLock.packageManager
    dependencyLockFile = [string]$release.dependencyLock.file
    dependencyLockSha256 = $dependencyLockSha256
    dependencyLockPackageCount = [int]$release.dependencyLock.packageCount
    dependencyLockVerified = $true
    localOnly = $true
    ready = $true
    productionDistributionSigningReady = ($signature.Status -eq "Valid")
}
$healthPath = Join-Path $localRoot "endpoint-health.json"
$health | ConvertTo-Json -Depth 8 | Set-Content $healthPath -Encoding UTF8
Write-Host "[Obserra] Endpoint verification passed."
Write-Host "Executable: $executablePath"
Write-Host "Authenticode: $($signature.Status)"
Write-Host "Academy Studio ready: $studioReady"
Write-Host "Dependency lock verified: $dependencyLockSha256"
Write-Host "Evidence: $healthPath"
'@
$testScriptPath = Join-Path $destinationPath "Test-Obserra-Command-Center-Installation.ps1"
Set-Content $testScriptPath $testScript -Encoding UTF8

$installScript = @'
[CmdletBinding()]
param(
    [switch]$Portable,
    [switch]$SkipHostnameCheck,
    [switch]$NoLaunch,
    [switch]$RequireAuthenticode,
    [string]$StudioRoot = ""
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bootstrap = Join-Path $here "Obserra-Command-Center-Bootstrap.json"
$manifestPath = Join-Path $here "SHA256SUMS.json"
$releasePath = Join-Path $here "Obserra-Command-Center-Release.json"
$testScript = Join-Path $here "Test-Obserra-Command-Center-Installation.ps1"
foreach ($required in @($bootstrap, $manifestPath, $releasePath, $testScript)) {
    if (-not (Test-Path $required -PathType Leaf)) { throw "Required release file is missing: $required" }
}

$profile = Get-Content $bootstrap -Raw | ConvertFrom-Json
$release = Get-Content $releasePath -Raw | ConvertFrom-Json
$dependencyLockPath = Join-Path $here ([string]$release.dependencyLock.file)
if (-not (Test-Path $dependencyLockPath -PathType Leaf)) {
    throw "Required dependency lock evidence is missing: $dependencyLockPath"
}
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
    if ([long]$entry.Bytes -ne (Get-Item $filePath).Length) { throw "File-size verification failed for $($entry.File)" }
}
$dependencyLockSha256 = (Get-FileHash -Algorithm SHA256 -Path $dependencyLockPath).Hash
if ($dependencyLockSha256 -ne [string]$release.dependencyLock.sha256) {
    throw "Dependency lock evidence does not match the governed release descriptor."
}
if ([string]$profile.dependencyLockSha256 -ne $dependencyLockSha256) {
    throw "Bootstrap dependency-lock identity does not match the governed release."
}

$localRoot = Join-Path $env:LOCALAPPDATA "Obserra\OwnerCommandCenter"
New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
$installedBootstrap = Join-Path $localRoot "Obserra-Command-Center-Bootstrap.json"
Copy-Item $bootstrap $installedBootstrap -Force
Copy-Item $releasePath (Join-Path $localRoot "Obserra-Command-Center-Release.json") -Force
Copy-Item $dependencyLockPath (Join-Path $localRoot ([string]$release.dependencyLock.file)) -Force
Copy-Item (Join-Path $here "Obserra-Worker-Pool-Contract.json") (Join-Path $localRoot "Obserra-Worker-Pool-Contract.json") -Force
Copy-Item (Join-Path $here "Obserra-Commercial-Course-Production-Standard.json") (Join-Path $localRoot "Obserra-Commercial-Course-Production-Standard.json") -Force
[Environment]::SetEnvironmentVariable("OBSERRA_COMMAND_CENTER_BOOTSTRAP", $installedBootstrap, "User")
$env:OBSERRA_COMMAND_CENTER_BOOTSTRAP = $installedBootstrap

function Test-StudioRoot {
    param([string]$Candidate)
    if ([string]::IsNullOrWhiteSpace($Candidate)) { return $false }
    try { $resolved = [System.IO.Path]::GetFullPath($Candidate) } catch { return $false }
    return (Test-Path (Join-Path $resolved "package.json")) -and (Test-Path (Join-Path $resolved "courses")) -and (Test-Path (Join-Path $resolved "studio")) -and (Test-Path (Join-Path $resolved "policy\elastic-worker-pool-contract.json"))
}

$studioCandidates = @(
    $StudioRoot,
    [string]$profile.academyStudioRootHint,
    (Join-Path $HOME "source\repos\obserra-academy-production-studio"),
    (Join-Path $HOME "Documents\GitHub\obserra-academy-production-studio"),
    (Join-Path $HOME "GitHub\obserra-academy-production-studio")
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$resolvedStudioRoot = $studioCandidates | Where-Object { Test-StudioRoot $_ } | Select-Object -First 1
if (-not [string]::IsNullOrWhiteSpace($StudioRoot) -and -not $resolvedStudioRoot) {
    throw "The supplied StudioRoot is not a valid Obserra Academy Studio repository: $StudioRoot"
}
if ($resolvedStudioRoot) {
    $resolvedStudioRoot = [System.IO.Path]::GetFullPath($resolvedStudioRoot)
    [Environment]::SetEnvironmentVariable("OBSERRA_ACADEMY_STUDIO_ROOT", $resolvedStudioRoot, "User")
    $env:OBSERRA_ACADEMY_STUDIO_ROOT = $resolvedStudioRoot
} else {
    Write-Warning "Academy Studio repository was not discovered. The Command Center will install, but Academy execution remains detached until OBSERRA_ACADEMY_STUDIO_ROOT is configured."
}

$launchPath = $null
if ($Portable) {
    $app = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $app) { throw "Portable Obserra executable was not found on this media." }
    $portableRoot = Join-Path $localRoot "Portable"
    New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
    $launchPath = Join-Path $portableRoot $app.Name
    Copy-Item $app.FullName $launchPath -Force
} else {
    $app = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-*.exe" | Where-Object { $_.Name -notlike "*Portable*" } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $app) { throw "One-click Obserra installer was not found on this media." }
    $signature = Get-AuthenticodeSignature -FilePath $app.FullName
    if ($RequireAuthenticode -and $signature.Status -ne "Valid") {
        throw "Trusted Authenticode signature is required, but installer status is '$($signature.Status)'."
    }
    Start-Process -FilePath $app.FullName -Wait
}

$testArguments = @{}
if ($Portable) { $testArguments.Portable = $true }
if ($SkipHostnameCheck) { $testArguments.SkipHostnameCheck = $true }
if ($RequireAuthenticode) { $testArguments.RequireAuthenticode = $true }
if ($resolvedStudioRoot) { $testArguments.StudioRoot = $resolvedStudioRoot }
& $testScript @testArguments

$healthPath = Join-Path $localRoot "endpoint-health.json"
$installationRecord = [ordered]@{
    schemaVersion = "1.1"
    installedAt = (Get-Date).ToUniversalTime().ToString("o")
    hostname = $env:COMPUTERNAME.ToLowerInvariant()
    targetHostname = $target
    mode = if ($Portable) { "portable" } else { "nsis-per-user" }
    bootstrapPath = $installedBootstrap
    academyStudioRoot = $resolvedStudioRoot
    endpointHealthPath = $healthPath
    packageManifestSha256 = (Get-FileHash -Algorithm SHA256 -Path $manifestPath).Hash
    releaseDescriptorSha256 = (Get-FileHash -Algorithm SHA256 -Path $releasePath).Hash
    dependencyLockSha256 = $dependencyLockSha256
    dependencyLockPackageCount = [int]$release.dependencyLock.packageCount
    ownerAuthorized = $true
}
$installationRecord | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $localRoot "installation-record.json") -Encoding UTF8

if (-not $NoLaunch) {
    if ($Portable -and $launchPath) {
        Start-Process -FilePath $launchPath
    } else {
        $knownCandidates = @(
            (Join-Path $env:LOCALAPPDATA "Programs\Obserra Owner AI Command Center\Obserra Owner AI Command Center.exe"),
            (Join-Path $env:LOCALAPPDATA "Programs\obserra-owner-ai-command-center\Obserra Owner AI Command Center.exe")
        )
        $installed = $knownCandidates | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
        if (-not $installed) {
            $programsRoot = Join-Path $env:LOCALAPPDATA "Programs"
            if (Test-Path $programsRoot) {
                $installed = Get-ChildItem $programsRoot -Filter "Obserra Owner AI Command Center.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1
            }
        }
        if ($installed) { Start-Process -FilePath $installed }
    }
}

Write-Host "[Obserra] Command Center package verified, installed, post-install tested, and recorded for $env:COMPUTERNAME."
Write-Host "[Obserra] Academy Studio root: $resolvedStudioRoot"
Write-Host "[Obserra] Dependency lock: $dependencyLockSha256"
Write-Host "[Obserra] Installation evidence: $(Join-Path $localRoot 'installation-record.json')"
'@
Set-Content (Join-Path $destinationPath "Install-Obserra-Command-Center.ps1") $installScript -Encoding UTF8

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

Write-Host "[Obserra] Removable-media package created at $destinationPath for machine $TargetHostname"
Write-Host "[Obserra] Dependency lock SHA-256: $dependencyLockSha256"
Write-Host "[Obserra] Installer Authenticode status: $($installerSignature.Status)"
Write-Host "[Obserra] Portable Authenticode status: $($portableSignature.Status)"
