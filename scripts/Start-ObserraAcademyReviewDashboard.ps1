[CmdletBinding()]
param(
    [string]$ProductionRoot = 'C:\ObserraAcademyProduction',
    [string]$StudioRoot,
    [string]$DashboardBranch = 'agent/academy-local-review-dashboard',
    [switch]$SkipUpdate,
    [switch]$SkipDependencyInstall,
    [switch]$VerifyOnly,
    [switch]$NoLaunch,
    [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepositoryUrl = 'https://github.com/jblan2026-hub/obserra-academy-production-studio.git'
$RepositoryFullName = 'jblan2026-hub/obserra-academy-production-studio'
$PublicationBranch = 'main'
$PublicationWorkflow = 'publish-to-website.yml'

function Write-Step {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host ''
    Write-Host ('=== {0} ===' -f $Message) -ForegroundColor Cyan
}

function Assert-Command {
    param([Parameter(Mandatory)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw ('Required command is not available in PATH: {0}' -f $Name)
    }
}

function Ensure-Directory {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Invoke-Git {
    param(
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    & git -C $Repository @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('Git command failed in {0}: git {1}' -f $Repository, ($Arguments -join ' '))
    }
}

function Set-ObserraEnvironment {
    param(
        [Parameter(Mandatory)][string]$ResolvedStudioRoot
    )

    $values = [ordered]@{
        OBSERRA_ACADEMY_STUDIO_ROOT = $ResolvedStudioRoot
        OBSERRA_ACADEMY_GITHUB_REPOSITORY = $RepositoryFullName
        OBSERRA_ACADEMY_PUBLICATION_BRANCH = $PublicationBranch
        OBSERRA_ACADEMY_PUBLICATION_WORKFLOW = $PublicationWorkflow
    }

    foreach ($entry in $values.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, 'User')
        Set-Item -Path ('Env:{0}' -f $entry.Key) -Value ([string]$entry.Value)
    }
}

function Get-NodeMajorVersion {
    $raw = (& node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $raw -notmatch '^v(?<major>\d+)\.') {
        throw ('Unable to determine Node.js version from: {0}' -f $raw)
    }
    return [int]$Matches.major
}

function Write-LauncherShortcut {
    param(
        [Parameter(Mandatory)][string]$LauncherPath,
        [Parameter(Mandatory)][string]$CommandPath
    )

    $content = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$LauncherPath" -ProductionRoot "$ProductionRoot" -SkipUpdate
"@
    [IO.File]::WriteAllText($CommandPath, $content.TrimStart() + [Environment]::NewLine, [Text.ASCIIEncoding]::new())
}

Assert-Command -Name 'git'
Assert-Command -Name 'node'
Assert-Command -Name 'npm'

$ProductionRootFull = [IO.Path]::GetFullPath($ProductionRoot)
if (-not $StudioRoot) {
    $StudioRoot = Join-Path $ProductionRootFull 'source\obserra-academy-production-studio'
}
$StudioRootFull = [IO.Path]::GetFullPath($StudioRoot)
$DashboardParent = Join-Path $ProductionRootFull 'dashboard'
$DashboardRepository = Join-Path $DashboardParent 'obserra-academy-command-center'
$OwnerCommandCenter = Join-Path $DashboardRepository 'owner-command-center'
$DashboardLogRoot = Join-Path $DashboardParent 'logs'
$RuntimeRecordPath = Join-Path $DashboardParent 'academy-review-dashboard-runtime.json'
$ShortcutPath = Join-Path $ProductionRootFull 'Start-Academy-Review-Dashboard.cmd'

Write-Step -Message 'Validating active Academy production workspace'

if (-not (Test-Path -LiteralPath (Join-Path $StudioRootFull '.git'))) {
    throw ('The active Academy Studio Git workspace was not found at {0}' -f $StudioRootFull)
}
foreach ($required in @('package.json', 'courses', 'studio')) {
    if (-not (Test-Path -LiteralPath (Join-Path $StudioRootFull $required))) {
        throw ('The Academy Studio workspace is missing required path: {0}' -f $required)
    }
}

$studioBranch = (& git -C $StudioRootFull branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to determine the active Academy Studio branch.' }
$studioHead = (& git -C $StudioRootFull rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to determine the active Academy Studio commit.' }

$courseManifests = @(Get-ChildItem -LiteralPath (Join-Path $StudioRootFull 'courses') -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName 'course-manifest.json')
})
if ($courseManifests.Count -ne 61) {
    throw ('Expected exactly 61 governed course manifests in the active workspace; found {0}.' -f $courseManifests.Count)
}

$generatedCount = 0
foreach ($courseDirectory in $courseManifests) {
    if (Test-Path -LiteralPath (Join-Path $courseDirectory.FullName 'generated\authoring\course-package.json')) {
        $generatedCount += 1
    }
}

Write-Host ('Studio root      : {0}' -f $StudioRootFull)
Write-Host ('Studio branch    : {0}' -f $studioBranch)
Write-Host ('Studio commit    : {0}' -f $studioHead)
Write-Host ('Governed courses : {0}' -f $courseManifests.Count)
Write-Host ('Generated now    : {0}' -f $generatedCount)
Write-Host 'The Studio checkout will not be switched, pulled, reset, or stopped by this launcher.' -ForegroundColor Green

Write-Step -Message 'Preparing isolated review dashboard checkout'
Ensure-Directory -Path $DashboardParent
Ensure-Directory -Path $DashboardLogRoot

if (-not (Test-Path -LiteralPath (Join-Path $DashboardRepository '.git'))) {
    if (Test-Path -LiteralPath $DashboardRepository) {
        throw ('Dashboard path already exists but is not a Git repository: {0}' -f $DashboardRepository)
    }
    & git clone --branch $DashboardBranch --single-branch $RepositoryUrl $DashboardRepository
    if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the Academy review dashboard branch.' }
} elseif (-not $SkipUpdate) {
    $trackedChanges = @(& git -C $DashboardRepository status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the dashboard checkout.' }
    if ($trackedChanges.Count -gt 0) {
        throw ('Dashboard checkout has tracked local changes. Preserve or review them before updating: {0}' -f ($trackedChanges -join '; '))
    }
    Invoke-Git -Repository $DashboardRepository -Arguments @('fetch', 'origin', $DashboardBranch)
    Invoke-Git -Repository $DashboardRepository -Arguments @('checkout', $DashboardBranch)
    Invoke-Git -Repository $DashboardRepository -Arguments @('pull', '--ff-only', 'origin', $DashboardBranch)
}

$dashboardBranchActual = (& git -C $DashboardRepository branch --show-current).Trim()
$dashboardHead = (& git -C $DashboardRepository rev-parse HEAD).Trim()
if ($dashboardBranchActual -ne $DashboardBranch) {
    throw ('Dashboard checkout is on {0}; expected {1}.' -f $dashboardBranchActual, $DashboardBranch)
}

if (-not (Test-Path -LiteralPath (Join-Path $OwnerCommandCenter 'package.json'))) {
    throw ('Owner Command Center package was not found under {0}' -f $OwnerCommandCenter)
}

Write-Step -Message 'Binding dashboard to local Academy production data'
Set-ObserraEnvironment -ResolvedStudioRoot $StudioRootFull

Write-Host ('Dashboard root    : {0}' -f $DashboardRepository)
Write-Host ('Dashboard branch  : {0}' -f $dashboardBranchActual)
Write-Host ('Dashboard commit  : {0}' -f $dashboardHead)
Write-Host ('Course data source: {0}' -f $StudioRootFull)
Write-Host ('Protected outputs : {0}' -f (Join-Path $ProductionRootFull 'courses'))

Write-Step -Message 'Validating local review and approval controls'

$requiredDashboardFiles = @(
    'electron\academy-studio.cjs',
    'electron\academy-preview.cjs',
    'electron\academy-course-control.cjs',
    'electron\academy-course-control-resolver.cjs',
    'src\academy-preview-ui.js',
    'src\academy-control-ui.js',
    'src\index.html'
)
foreach ($relativePath in $requiredDashboardFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $OwnerCommandCenter $relativePath))) {
        throw ('Review dashboard is missing required control file: {0}' -f $relativePath)
    }
}

$resolverText = [IO.File]::ReadAllText((Join-Path $OwnerCommandCenter 'electron\academy-course-control-resolver.cjs'))
foreach ($requiredContract in @(
    'generation:',
    'code: result?.exitCode',
    'local-studio-workspace'
)) {
    if (-not $resolverText.Contains($requiredContract)) {
        throw ('The local Academy lifecycle compatibility contract is incomplete: {0}' -f $requiredContract)
    }
}

$previewText = [IO.File]::ReadAllText((Join-Path $OwnerCommandCenter 'electron\academy-preview.cjs'))
foreach ($requiredPreview in @(
    'generated", "authoring", "course-package.json',
    'previewMaterials',
    'previewCertificate'
)) {
    if (-not $previewText.Contains($requiredPreview)) {
        throw ('The Academy preview contract is incomplete: {0}' -f $requiredPreview)
    }
}

$controlUiText = [IO.File]::ReadAllText((Join-Path $OwnerCommandCenter 'src\academy-control-ui.js'))
foreach ($requiredControl in @(
    'Approve release',
    'Publish live',
    'Request changes',
    'Verify paid access end to end'
)) {
    if (-not $controlUiText.Contains($requiredControl)) {
        throw ('The Academy owner-control UI is incomplete: {0}' -f $requiredControl)
    }
}

$nodeMajor = Get-NodeMajorVersion
if ($nodeMajor -lt 20) {
    throw ('Node.js 20 or newer is required for the local review dashboard; found major version {0}.' -f $nodeMajor)
}

if (-not $SkipDependencyInstall) {
    Write-Step -Message 'Preparing Owner Command Center dependencies'
    $packagePath = Join-Path $OwnerCommandCenter 'package.json'
    $packageHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
    $electronCommand = Join-Path $OwnerCommandCenter 'node_modules\.bin\electron.cmd'
    $installMarker = Join-Path $OwnerCommandCenter 'node_modules\.obserra-review-dashboard-package.sha256'
    $installedHash = if (Test-Path -LiteralPath $installMarker) { (Get-Content -LiteralPath $installMarker -Raw).Trim() } else { '' }

    if (-not (Test-Path -LiteralPath $electronCommand) -or $installedHash -ne $packageHash) {
        Push-Location $OwnerCommandCenter
        try {
            & npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Owner Command Center dependency installation failed.' }
            Ensure-Directory -Path (Join-Path $OwnerCommandCenter 'node_modules')
            [IO.File]::WriteAllText($installMarker, $packageHash + [Environment]::NewLine, [Text.ASCIIEncoding]::new())
        } finally {
            Pop-Location
        }
    } else {
        Write-Host 'Owner Command Center dependencies already match the current package contract.' -ForegroundColor Green
    }
}

$runtimeRecord = [ordered]@{
    schemaVersion = '1.0'
    preparedAt = (Get-Date).ToString('o')
    productionRoot = $ProductionRootFull
    studioRoot = $StudioRootFull
    studioBranch = $studioBranch
    studioCommit = $studioHead
    dashboardRoot = $DashboardRepository
    dashboardBranch = $dashboardBranchActual
    dashboardCommit = $dashboardHead
    governedCourseCount = $courseManifests.Count
    generatedCourseCountAtLaunch = $generatedCount
    publicationRepository = $RepositoryFullName
    publicationBranch = $PublicationBranch
    publicationWorkflow = $PublicationWorkflow
    safetyBoundary = 'Dashboard is isolated from the active course-build checkout. Publication remains owner-enrolled, explicit-confirmation, blocker-gated, provider-submitted, and readback-verified.'
}
$runtimeJson = $runtimeRecord | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($RuntimeRecordPath, $runtimeJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

if (-not $NoShortcut) {
    $clonedLauncher = Join-Path $DashboardRepository 'scripts\Start-ObserraAcademyReviewDashboard.ps1'
    if (Test-Path -LiteralPath $clonedLauncher) {
        Write-LauncherShortcut -LauncherPath $clonedLauncher -CommandPath $ShortcutPath
    }
}

Write-Step -Message 'Academy review dashboard is ready'
Write-Host ('Review dashboard : {0}' -f $DashboardRepository) -ForegroundColor Green
Write-Host ('Studio workspace : {0}' -f $StudioRootFull) -ForegroundColor Green
Write-Host ('Runtime record   : {0}' -f $RuntimeRecordPath)
if (-not $NoShortcut) {
    Write-Host ('Future launcher  : {0}' -f $ShortcutPath)
}
Write-Host ''
Write-Host 'Review workflow:' -ForegroundColor Cyan
Write-Host '  1. Select a course in Academy Course Lifecycle Command.'
Write-Host '  2. Preview course, materials, and certificate from the local generated package.'
Write-Host '  3. Record Approve, Request changes, Reject, or Reset decisions with an owner note.'
Write-Host '  4. Approve the release only after deterministic blockers clear.'
Write-Host '  5. Publish live only with the exact PUBLISH <course-id> confirmation and configured owner credentials.'
Write-Host '  6. Treat publication as verified only after workflow, catalog, website, and commerce readback succeed.'
Write-Host ''
Write-Host 'The active Academy course-build queue is not stopped or restarted by this dashboard.' -ForegroundColor Yellow

if ($VerifyOnly -or $NoLaunch) {
    exit 0
}

Write-Step -Message 'Launching Owner AI Command Center'
$process = Start-Process -FilePath 'npm.cmd' -ArgumentList @('start') -WorkingDirectory $OwnerCommandCenter -PassThru
Start-Sleep -Seconds 3
if ($process.HasExited) {
    throw ('Owner Command Center exited immediately with code {0}.' -f $process.ExitCode)
}

Write-Host ('Command Center launcher PID: {0}' -f $process.Id) -ForegroundColor Green
Write-Host 'The Electron dashboard should now be visible. On first use, complete the governed owner-endpoint enrollment before review or publication mutations are permitted.' -ForegroundColor Green
