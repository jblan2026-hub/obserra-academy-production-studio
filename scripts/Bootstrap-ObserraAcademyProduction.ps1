[CmdletBinding()]
param(
    [string]$ProductionRoot = 'C:\ObserraAcademyProduction',
    [string]$Branch = 'agent/academy-61-course-completion-only',
    [string]$RepositoryUrl = 'https://github.com/jblan2026-hub/obserra-academy-production-studio.git'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Git {
    param([Parameter(Mandatory)][string[]]$Arguments)

    & git @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw ('Git command failed with exit code {0}: git {1}' -f $exitCode, ($Arguments -join ' '))
    }
}

function Ensure-Directory {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' Obserra Academy Local Production Bootstrap' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw 'Git for Windows is required and was not found in PATH.'
}

$root = [IO.Path]::GetFullPath($ProductionRoot)
$sourceRoot = Join-Path $root 'source'
$repo = Join-Path $sourceRoot 'obserra-academy-production-studio'
$setupScript = Join-Path $repo 'scripts\Setup-ObserraAcademyProduction.ps1'
$backupRoot = Join-Path $root 'backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host "Production root : $root"
Write-Host "Source checkout  : $repo"
Write-Host "Git branch       : $Branch"
Write-Host ''

Ensure-Directory -Path $root
Ensure-Directory -Path $sourceRoot
Ensure-Directory -Path $backupRoot

if (Test-Path -LiteralPath $repo) {
    $gitDirectory = Join-Path $repo '.git'
    if (Test-Path -LiteralPath $gitDirectory) {
        Write-Host 'Existing Academy source checkout found. Updating it safely...' -ForegroundColor Yellow
        Invoke-Git -Arguments @('-C', $repo, 'fetch', 'origin', $Branch)

        $status = & git -C $repo status --porcelain
        $statusExitCode = $LASTEXITCODE
        if ($statusExitCode -ne 0) {
            throw ('Unable to inspect existing repository status. Git exit code: {0}' -f $statusExitCode)
        }
        if ($status) {
            throw "The existing Academy source checkout has uncommitted changes at $repo. Commit or move those changes before bootstrap so nothing is overwritten."
        }

        Invoke-Git -Arguments @('-C', $repo, 'checkout', $Branch)
        Invoke-Git -Arguments @('-C', $repo, 'pull', '--ff-only', 'origin', $Branch)
    }
    else {
        $items = @(Get-ChildItem -LiteralPath $repo -Force -ErrorAction SilentlyContinue)
        if ($items.Count -gt 0) {
            $unexpectedBackup = Join-Path $backupRoot "unexpected-source-$timestamp"
            Write-Host "A non-Git folder already exists at the source path. Moving it to $unexpectedBackup" -ForegroundColor Yellow
            Move-Item -LiteralPath $repo -Destination $unexpectedBackup
        }
        else {
            Remove-Item -LiteralPath $repo -Force
        }

        Write-Host 'Cloning the Academy production branch...' -ForegroundColor Yellow
        Invoke-Git -Arguments @('clone', '--branch', $Branch, '--single-branch', $RepositoryUrl, $repo)
    }
}
else {
    Write-Host 'Cloning the Academy production branch...' -ForegroundColor Yellow
    Invoke-Git -Arguments @('clone', '--branch', $Branch, '--single-branch', $RepositoryUrl, $repo)
}

if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    throw "Bootstrap validation failed: $repo is not a Git repository."
}

if (-not (Test-Path -LiteralPath $setupScript)) {
    throw "Bootstrap validation failed: setup script not found at $setupScript"
}

Set-ExecutionPolicy -Scope Process Bypass -Force
Set-Location -LiteralPath $repo

Write-Host ''
Write-Host 'Running local production storage mapper...' -ForegroundColor Yellow
& $setupScript -ProductionRoot $root -RepositoryRoot $repo

$envScript = Join-Path $root 'academy-local-paths.ps1'
if (Test-Path -LiteralPath $envScript) {
    . $envScript
}

$mappingFile = Join-Path $root 'mapping\academy-local-storage-map.json'
if (-not (Test-Path -LiteralPath $mappingFile)) {
    throw "Mapping manifest was not created: $mappingFile"
}

$mapping = Get-Content -LiteralPath $mappingFile -Raw | ConvertFrom-Json
if ([int]$mapping.courseCount -ne 61) {
    throw "Mapping verification expected 61 courses but found $($mapping.courseCount)."
}

$missing = New-Object System.Collections.Generic.List[string]
foreach ($entry in $mapping.mappings) {
    $repositoryPath = [string]$entry.repositoryGeneratedPath
    if (-not (Test-Path -LiteralPath $repositoryPath)) {
        $missing.Add($repositoryPath)
        continue
    }
    $item = Get-Item -LiteralPath $repositoryPath -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $missing.Add("$repositoryPath (not a junction)")
    }
}
if ($missing.Count -gt 0) {
    $missing | ForEach-Object { Write-Host "FAILED: $_" -ForegroundColor Red }
    throw "Local production mapping verification failed for $($missing.Count) course path(s)."
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' LOCAL ACADEMY STORAGE IS READY' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host "Production root : $root"
Write-Host "Source checkout  : $repo"
Write-Host "Course storage   : $(Join-Path $root 'courses')"
Write-Host "Checkpoints      : $(Join-Path $root 'checkpoints')"
Write-Host "Media            : $(Join-Path $root 'media')"
Write-Host "Logs             : $(Join-Path $root 'logs')"
Write-Host "Final packages   : $(Join-Path $root 'final')"
Write-Host "Mapped courses   : $($mapping.courseCount)"
Write-Host ''
Write-Host 'The next production commands should be run from:' -ForegroundColor Cyan
Write-Host $repo -ForegroundColor White
Write-Host ''
