[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ProductionRoot = 'C:\ObserraAcademyProduction',
    [string]$RepositoryRoot,
    [switch]$Rollback,
    [switch]$ForceMerge
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-RepositoryRoot {
    param([string]$ExplicitRoot)

    if ($ExplicitRoot) {
        $resolved = Resolve-Path -LiteralPath $ExplicitRoot
        return $resolved.Path
    }

    $candidate = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path -LiteralPath (Join-Path $candidate 'courses'))) {
        throw ('Could not locate repository root from script path: {0}' -f $candidate)
    }
    return (Resolve-Path -LiteralPath $candidate).Path
}

function Ensure-Directory {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-DirectoryHasContent {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    return $null -ne (Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop | Select-Object -First 1)
}

function Get-ReparseTarget {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $item = Get-Item -LiteralPath $Path -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
    try {
        return $item.Target
    } catch {
        return $null
    }
}

function Invoke-RobocopyMove {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    Ensure-Directory -Path $Destination
    if (-not (Get-DirectoryHasContent -Path $Source)) { return }

    & robocopy.exe $Source $Destination /E /MOVE /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH /NJS
    $code = $LASTEXITCODE
    if ($code -gt 7) {
        throw ('Robocopy move failed with exit code {0}: {1} -> {2}' -f $code, $Source, $Destination)
    }
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Value
    )

    Ensure-Directory -Path (Split-Path -Parent $Path)
    $json = $Value | ConvertTo-Json -Depth 10
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8NoBom)
}

$repoRoot = Resolve-RepositoryRoot -ExplicitRoot $RepositoryRoot
$productionRootFull = [IO.Path]::GetFullPath($ProductionRoot)
$coursesRoot = Join-Path $repoRoot 'courses'
$mappingRoot = Join-Path $productionRootFull 'mapping'
$mappingFile = Join-Path $mappingRoot 'academy-local-storage-map.json'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if ($Rollback) {
    if (-not (Test-Path -LiteralPath $mappingFile)) {
        throw ('No local-storage mapping manifest exists at {0}' -f $mappingFile)
    }

    $state = Get-Content -LiteralPath $mappingFile -Raw | ConvertFrom-Json
    foreach ($mapping in $state.mappings) {
        $repoGenerated = [string]$mapping.repositoryGeneratedPath
        $localGenerated = [string]$mapping.localGeneratedPath

        if (Test-Path -LiteralPath $repoGenerated) {
            $item = Get-Item -LiteralPath $repoGenerated -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                if ($PSCmdlet.ShouldProcess($repoGenerated, 'Remove Academy local-storage junction')) {
                    Remove-Item -LiteralPath $repoGenerated -Force
                }
            } elseif (Get-DirectoryHasContent -Path $repoGenerated) {
                throw ('Rollback stopped because repository path contains non-junction data: {0}' -f $repoGenerated)
            } else {
                Remove-Item -LiteralPath $repoGenerated -Force
            }
        }

        if ($PSCmdlet.ShouldProcess($repoGenerated, 'Restore local Academy generated files into repository working tree')) {
            Ensure-Directory -Path $repoGenerated
            Invoke-RobocopyMove -Source $localGenerated -Destination $repoGenerated
        }
    }

    $rollbackRecord = [ordered]@{
        schemaVersion = '1.0'
        rolledBackAt = (Get-Date).ToString('o')
        productionRoot = $productionRootFull
        repositoryRoot = $repoRoot
        priorMappingFile = $mappingFile
    }
    Write-JsonFile -Path (Join-Path $mappingRoot ('rollback-{0}.json' -f $timestamp)) -Value $rollbackRecord
    Write-Host ('Rollback completed. Generated course data is back under {0}\courses.' -f $repoRoot) -ForegroundColor Green
    exit 0
}

$requiredDirectories = @(
    $productionRootFull,
    (Join-Path $productionRootFull 'courses'),
    (Join-Path $productionRootFull 'checkpoints'),
    (Join-Path $productionRootFull 'media'),
    (Join-Path $productionRootFull 'catalog'),
    (Join-Path $productionRootFull 'logs'),
    (Join-Path $productionRootFull 'cache'),
    (Join-Path $productionRootFull 'backups'),
    (Join-Path $productionRootFull 'final'),
    $mappingRoot
)
foreach ($directory in $requiredDirectories) {
    if ($PSCmdlet.ShouldProcess($directory, 'Create Academy production directory')) {
        Ensure-Directory -Path $directory
    }
}

$courseManifests = @(Get-ChildItem -LiteralPath $coursesRoot -Directory | ForEach-Object {
    $manifest = Join-Path $_.FullName 'course-manifest.json'
    if (Test-Path -LiteralPath $manifest) { $manifest }
} | Sort-Object)

if ($courseManifests.Count -ne 61) {
    throw ('Expected exactly 61 Academy course manifests, found {0}. No mapping changes were made after this validation point.' -f $courseManifests.Count)
}

$mappings = New-Object System.Collections.Generic.List[object]
foreach ($manifestPath in $courseManifests) {
    $courseDirectory = Split-Path -Parent $manifestPath
    $courseId = Split-Path -Leaf $courseDirectory
    $repoGenerated = Join-Path $courseDirectory 'generated'
    $localGenerated = Join-Path (Join-Path (Join-Path $productionRootFull 'courses') $courseId) 'generated'
    Ensure-Directory -Path (Split-Path -Parent $localGenerated)
    Ensure-Directory -Path $localGenerated

    $existingTarget = Get-ReparseTarget -Path $repoGenerated
    if ($existingTarget) {
        $normalizedExisting = [IO.Path]::GetFullPath([string]$existingTarget)
        $normalizedExpected = [IO.Path]::GetFullPath($localGenerated)
        if ($normalizedExisting.TrimEnd('\') -ieq $normalizedExpected.TrimEnd('\')) {
            $mappings.Add([ordered]@{
                courseId = $courseId
                repositoryGeneratedPath = $repoGenerated
                localGeneratedPath = $localGenerated
                status = 'already-mapped'
            })
            continue
        }
        throw ('Course {0} already uses a reparse point to a different target: {1}' -f $courseId, $existingTarget)
    }

    $sourceHasContent = Get-DirectoryHasContent -Path $repoGenerated
    $targetHasContent = Get-DirectoryHasContent -Path $localGenerated
    if ($sourceHasContent -and $targetHasContent -and -not $ForceMerge) {
        throw ('Both repository and local production storage contain data for {0}. Re-run with -ForceMerge only after confirming the two copies may be merged safely.' -f $courseId)
    }

    if ($sourceHasContent) {
        $backupPath = Join-Path (Join-Path (Join-Path $productionRootFull 'backups') ('pre-map-{0}' -f $timestamp)) $courseId
        if ($PSCmdlet.ShouldProcess($repoGenerated, ('Move generated data to {0}' -f $localGenerated))) {
            Ensure-Directory -Path $backupPath
            & robocopy.exe $repoGenerated $backupPath /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH /NJS
            $backupExitCode = $LASTEXITCODE
            if ($backupExitCode -gt 7) {
                throw ('Safety backup failed for {0} with robocopy exit code {1}' -f $courseId, $backupExitCode)
            }
            Invoke-RobocopyMove -Source $repoGenerated -Destination $localGenerated
        }
    }

    if (Test-Path -LiteralPath $repoGenerated) {
        if (Get-DirectoryHasContent -Path $repoGenerated) {
            throw ('Repository generated directory is still non-empty after migration: {0}' -f $repoGenerated)
        }
        Remove-Item -LiteralPath $repoGenerated -Force
    }

    if ($PSCmdlet.ShouldProcess($repoGenerated, ('Create junction to {0}' -f $localGenerated))) {
        New-Item -ItemType Junction -Path $repoGenerated -Target $localGenerated | Out-Null
    }

    $mappings.Add([ordered]@{
        courseId = $courseId
        repositoryGeneratedPath = $repoGenerated
        localGeneratedPath = $localGenerated
        status = 'mapped'
    })
}

$state = [ordered]@{
    schemaVersion = '1.0'
    configuredAt = (Get-Date).ToString('o')
    repositoryRoot = $repoRoot
    productionRoot = $productionRootFull
    checkpointRoot = (Join-Path $productionRootFull 'checkpoints')
    mediaRoot = (Join-Path $productionRootFull 'media')
    catalogRoot = (Join-Path $productionRootFull 'catalog')
    logsRoot = (Join-Path $productionRootFull 'logs')
    cacheRoot = (Join-Path $productionRootFull 'cache')
    finalRoot = (Join-Path $productionRootFull 'final')
    courseCount = $mappings.Count
    mappings = $mappings
}
Write-JsonFile -Path $mappingFile -Value $state

$envFile = Join-Path $productionRootFull 'academy-local-paths.ps1'
$checkpointRoot = Join-Path $productionRootFull 'checkpoints'
$mediaRoot = Join-Path $productionRootFull 'media'
$catalogRootLocal = Join-Path $productionRootFull 'catalog'
$logsRoot = Join-Path $productionRootFull 'logs'
$cacheRoot = Join-Path $productionRootFull 'cache'
$finalRoot = Join-Path $productionRootFull 'final'
$envContent = @"
`$env:OBSERRA_ACADEMY_PRODUCTION_ROOT = '$productionRootFull'
`$env:ACADEMY_LOCAL_CHECKPOINT_DIR = '$checkpointRoot'
`$env:ACADEMY_LOCAL_MEDIA_ROOT = '$mediaRoot'
`$env:ACADEMY_LOCAL_CATALOG_ROOT = '$catalogRootLocal'
`$env:ACADEMY_LOCAL_LOG_ROOT = '$logsRoot'
`$env:ACADEMY_LOCAL_CACHE_ROOT = '$cacheRoot'
`$env:ACADEMY_LOCAL_FINAL_ROOT = '$finalRoot'
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($envFile, $envContent.TrimStart() + [Environment]::NewLine, $utf8NoBom)

[Environment]::SetEnvironmentVariable('OBSERRA_ACADEMY_PRODUCTION_ROOT', $productionRootFull, 'User')
[Environment]::SetEnvironmentVariable('ACADEMY_LOCAL_CHECKPOINT_DIR', $checkpointRoot, 'User')
$env:OBSERRA_ACADEMY_PRODUCTION_ROOT = $productionRootFull
$env:ACADEMY_LOCAL_CHECKPOINT_DIR = $checkpointRoot

$validationFailures = New-Object System.Collections.Generic.List[string]
foreach ($mapping in $mappings) {
    $source = [string]$mapping.repositoryGeneratedPath
    $target = [string]$mapping.localGeneratedPath
    if (-not (Test-Path -LiteralPath $source)) {
        $validationFailures.Add(('Missing mapped repository path: {0}' -f $source))
        continue
    }
    $actualTarget = Get-ReparseTarget -Path $source
    if (-not $actualTarget) {
        $validationFailures.Add(('Repository path is not a junction: {0}' -f $source))
        continue
    }
    $normalizedActual = [IO.Path]::GetFullPath([string]$actualTarget).TrimEnd('\')
    $normalizedExpected = [IO.Path]::GetFullPath($target).TrimEnd('\')
    if ($normalizedActual -ine $normalizedExpected) {
        $validationFailures.Add(('Junction target mismatch: {0} -> {1}, expected {2}' -f $source, $actualTarget, $target))
    }
}

if ($validationFailures.Count -gt 0) {
    $validationFailures | ForEach-Object { Write-Error $_ }
    throw ('Academy local production storage validation failed with {0} problem(s).' -f $validationFailures.Count)
}

Write-Host ''
Write-Host 'Obserra Academy local production storage is ready.' -ForegroundColor Green
Write-Host ('Production root : {0}' -f $productionRootFull)
Write-Host ('Courses mapped   : {0}' -f $mappings.Count)
Write-Host ('Checkpoints      : {0}' -f $checkpointRoot)
Write-Host ('Media            : {0}' -f $mediaRoot)
Write-Host ('Final packages   : {0}' -f $finalRoot)
Write-Host ('Mapping manifest : {0}' -f $mappingFile)
Write-Host ''
Write-Host 'The repository continues to use courses\<course>\generated, but those paths now resolve physically to C:\ObserraAcademyProduction.' -ForegroundColor Cyan
