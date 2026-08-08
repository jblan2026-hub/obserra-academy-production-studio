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
        throw "Could not locate repository root from script path: $candidate"
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
        throw "Robocopy move failed with exit code $code: $Source -> $Destination"
    }
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Value
    )

    Ensure-Directory -Path (Split-Path -Parent $Path)
    $json = $Value | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

$repoRoot = Resolve-RepositoryRoot -ExplicitRoot $RepositoryRoot
$productionRootFull = [IO.Path]::GetFullPath($ProductionRoot)
$coursesRoot = Join-Path $repoRoot 'courses'
$mappingRoot = Join-Path $productionRootFull 'mapping'
$mappingFile = Join-Path $mappingRoot 'academy-local-storage-map.json'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if ($Rollback) {
    if (-not (Test-Path -LiteralPath $mappingFile)) {
        throw "No local-storage mapping manifest exists at $mappingFile"
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
                throw "Rollback stopped because repository path contains non-junction data: $repoGenerated"
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
    Write-JsonFile -Path (Join-Path $mappingRoot "rollback-$timestamp.json") -Value $rollbackRecord
    Write-Host "Rollback completed. Generated course data is back under $repoRoot\courses." -ForegroundColor Green
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

$courseManifests = Get-ChildItem -LiteralPath $coursesRoot -Directory | ForEach-Object {
    $manifest = Join-Path $_.FullName 'course-manifest.json'
    if (Test-Path -LiteralPath $manifest) { $manifest }
} | Sort-Object

if ($courseManifests.Count -ne 61) {
    throw "Expected exactly 61 Academy course manifests, found $($courseManifests.Count). No mapping changes were made after this validation point."
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
        throw "Course $courseId already uses a reparse point to a different target: $existingTarget"
    }

    $sourceHasContent = Get-DirectoryHasContent -Path $repoGenerated
    $targetHasContent = Get-DirectoryHasContent -Path $localGenerated
    if ($sourceHasContent -and $targetHasContent -and -not $ForceMerge) {
        throw "Both repository and local production storage contain data for $courseId. Re-run with -ForceMerge only after confirming the two copies may be merged safely."
    }

    if ($sourceHasContent) {
        $backupPath = Join-Path (Join-Path (Join-Path $productionRootFull 'backups') "pre-map-$timestamp") $courseId
        if ($PSCmdlet.ShouldProcess($repoGenerated, "Move generated data to $localGenerated")) {
            Ensure-Directory -Path $backupPath
            & robocopy.exe $repoGenerated $backupPath /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH /NJS
            if ($LASTEXITCODE -gt 7) {
                throw "Safety backup failed for $courseId with robocopy exit code $LASTEXITCODE"
            }
            Invoke-RobocopyMove -Source $repoGenerated -Destination $localGenerated
        }
    }

    if (Test-Path -LiteralPath $repoGenerated) {
        if (Get-DirectoryHasContent -Path $repoGenerated) {
            throw "Repository generated directory is still non-empty after migration: $repoGenerated"
        }
        Remove-Item -LiteralPath $repoGenerated -Force
    }

    if ($PSCmdlet.ShouldProcess($repoGenerated, "Create junction to $localGenerated")) {
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
$envContent = @"
`$env:OBSERRA_ACADEMY_PRODUCTION_ROOT = '$productionRootFull'
`$env:ACADEMY_LOCAL_CHECKPOINT_DIR = '$(Join-Path $productionRootFull 'checkpoints')'
`$env:ACADEMY_LOCAL_MEDIA_ROOT = '$(Join-Path $productionRootFull 'media')'
`$env:ACADEMY_LOCAL_CATALOG_ROOT = '$(Join-Path $productionRootFull 'catalog')'
`$env:ACADEMY_LOCAL_LOG_ROOT = '$(Join-Path $productionRootFull 'logs')'
`$env:ACADEMY_LOCAL_CACHE_ROOT = '$(Join-Path $productionRootFull 'cache')'
`$env:ACADEMY_LOCAL_FINAL_ROOT = '$(Join-Path $productionRootFull 'final')'
"@
[IO.File]::WriteAllText($envFile, $envContent.TrimStart() + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

[Environment]::SetEnvironmentVariable('OBSERRA_ACADEMY_PRODUCTION_ROOT', $productionRootFull, 'User')
[Environment]::SetEnvironmentVariable('ACADEMY_LOCAL_CHECKPOINT_DIR', (Join-Path $productionRootFull 'checkpoints'), 'User')
$env:OBSERRA_ACADEMY_PRODUCTION_ROOT = $productionRootFull
$env:ACADEMY_LOCAL_CHECKPOINT_DIR = Join-Path $productionRootFull 'checkpoints'

$validationFailures = New-Object System.Collections.Generic.List[string]
foreach ($mapping in $mappings) {
    $source = [string]$mapping.repositoryGeneratedPath
    $target = [string]$mapping.localGeneratedPath
    if (-not (Test-Path -LiteralPath $source)) {
        $validationFailures.Add("Missing mapped repository path: $source")
        continue
    }
    $actualTarget = Get-ReparseTarget -Path $source
    if (-not $actualTarget) {
        $validationFailures.Add("Repository path is not a junction: $source")
        continue
    }
    $normalizedActual = [IO.Path]::GetFullPath([string]$actualTarget).TrimEnd('\')
    $normalizedExpected = [IO.Path]::GetFullPath($target).TrimEnd('\')
    if ($normalizedActual -ine $normalizedExpected) {
        $validationFailures.Add("Junction target mismatch: $source -> $actualTarget, expected $target")
    }
}

if ($validationFailures.Count -gt 0) {
    $validationFailures | ForEach-Object { Write-Error $_ }
    throw "Academy local production storage validation failed with $($validationFailures.Count) problem(s)."
}

Write-Host ''
Write-Host 'Obserra Academy local production storage is ready.' -ForegroundColor Green
Write-Host "Production root : $productionRootFull"
Write-Host "Courses mapped   : $($mappings.Count)"
Write-Host "Checkpoints      : $(Join-Path $productionRootFull 'checkpoints')"
Write-Host "Media            : $(Join-Path $productionRootFull 'media')"
Write-Host "Final packages   : $(Join-Path $productionRootFull 'final')"
Write-Host "Mapping manifest : $mappingFile"
Write-Host ''
Write-Host 'The repository continues to use courses\<course>\generated, but those paths now resolve physically to C:\ObserraAcademyProduction.' -ForegroundColor Cyan
