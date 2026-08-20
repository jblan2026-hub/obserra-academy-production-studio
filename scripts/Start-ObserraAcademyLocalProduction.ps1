[CmdletBinding()]
param(
    [string]$ProductionRoot = 'C:\ObserraAcademyProduction',
    [string]$Model = 'qwen2.5:7b-instruct',
    [int]$MaxWorkers = 0,
    [int]$MaxShardRestarts = 1,
    [switch]$SkipSourceRefresh
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ('{0};{1}' -f $machinePath, $userPath)
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw ('{0} is required and winget is unavailable for automatic installation.' -f $Label)
    }
    Write-Host ('Installing {0}...' -f $Label) -ForegroundColor Yellow
    & winget.exe install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw ('winget failed to install {0} with exit code {1}' -f $Label, $code)
    }
    Refresh-Path
}

function Ensure-Tooling {
    Refresh-Path
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        Install-WingetPackage -Id 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS'
    }
    if (-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)) {
        Install-WingetPackage -Id 'Ollama.Ollama' -Label 'Ollama'
    }
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
        throw 'Git for Windows is required and was not found in PATH.'
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Label) -ForegroundColor Yellow
    & $FilePath @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw ('{0} failed with exit code {1}' -f $Label, $code)
    }
}

function Test-OllamaReady {
    try {
        $null = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
        return $true
    }
    catch {
        return $false
    }
}

function Write-State {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    $json = $Value | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $encoding)
}

function Get-ActiveCourseIds {
    param([Parameter(Mandatory = $true)][string]$Repo)

    return @(
        Get-ChildItem -LiteralPath (Join-Path $Repo 'courses') -Directory | ForEach-Object {
            $manifestPath = Join-Path $_.FullName 'course-manifest.json'
            if (-not (Test-Path -LiteralPath $manifestPath)) { return }
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            $status = [string]$manifest.release.status
            if ($status -and @('retired', 'archived') -contains $status.ToLowerInvariant()) { return }
            $_.Name
        } | Sort-Object
    )
}

function Get-SafeWorkerCount {
    param([int]$Requested)

    $logicalCpu = [Environment]::ProcessorCount
    $system = Get-CimInstance Win32_ComputerSystem
    $ramGb = [math]::Floor([double]$system.TotalPhysicalMemory / 1GB)

    $cpuBound = [math]::Max(1, [math]::Floor($logicalCpu / 4))
    $ramBound = [math]::Max(1, [math]::Floor(([math]::Max(8, $ramGb - 8)) / 8))
    $automatic = [math]::Min(8, [math]::Min($cpuBound, $ramBound))

    if ($Requested -gt 0) {
        $workers = [math]::Max(1, [math]::Min(16, $Requested))
    }
    else {
        $workers = [int]$automatic
    }

    return [ordered]@{
        logicalCpu = $logicalCpu
        ramGb = $ramGb
        cpuBound = [int]$cpuBound
        ramBound = [int]$ramBound
        automatic = [int]$automatic
        selected = [int]$workers
    }
}

$root = [IO.Path]::GetFullPath($ProductionRoot)
$repo = Join-Path $root 'source\obserra-academy-production-studio'
$workerScript = Join-Path $repo 'scripts\Run-ObserraAcademyLocalShard.ps1'
$mappingFile = Join-Path $root 'mapping\academy-local-storage-map.json'

if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    throw ('Academy repository is missing: {0}' -f $repo)
}
if (-not (Test-Path -LiteralPath $workerScript)) {
    throw ('Local Academy worker script is missing: {0}' -f $workerScript)
}
if (-not (Test-Path -LiteralPath $mappingFile)) {
    throw ('Local Academy storage mapping is missing: {0}' -f $mappingFile)
}

Ensure-Tooling
Set-Location -LiteralPath $repo

$courseIds = Get-ActiveCourseIds -Repo $repo
if ($courseIds.Count -ne 61) {
    throw ('Expected exactly 61 active Academy courses, found {0}' -f $courseIds.Count)
}

$hardware = Get-SafeWorkerCount -Requested $MaxWorkers
$workers = [int]$hardware.selected
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$runRoot = Join-Path (Join-Path $root 'logs') ('local-production-{0}' -f $runId)
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$statePath = Join-Path $runRoot 'local-production-state.json'

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' OBSERRA ACADEMY LOCAL 61-COURSE PRODUCTION' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ('Production root : {0}' -f $root)
Write-Host ('Repository      : {0}' -f $repo)
Write-Host ('Courses queued  : {0}' -f $courseIds.Count)
Write-Host ('Logical CPUs    : {0}' -f $hardware.logicalCpu)
Write-Host ('Installed RAM   : {0} GB' -f $hardware.ramGb)
Write-Host ('Active workers  : {0}' -f $workers)
Write-Host ('Local model     : {0}' -f $Model)
Write-Host ('Run logs        : {0}' -f $runRoot)
Write-Host ''

$env:OBSERRA_ACADEMY_PRODUCTION_ROOT = $root
$env:ACADEMY_LOCAL_CHECKPOINT_DIR = Join-Path $root 'checkpoints'
$env:ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED = 'false'
$env:ACADEMY_CHECKPOINT_GATEWAY_URL = ''
$env:DATABASE_URL = ''
$env:STUDIO_OWNER_ORGANIZATION_ID = 'org_obserra_academy'
$env:STUDIO_OWNER_ORGANIZATION_NAME = 'Obserra Academy'
$env:ACADEMY_EXPECTED_SURGE_COURSES = '61'
$env:ACADEMY_EXPECTED_REVIEW_COURSES = '61'
$env:ACADEMY_AUTHORING_PROVIDER = 'local'
$env:ACADEMY_RESEARCH_PROVIDER = 'local'
$env:ACADEMY_REVIEW_PROVIDER = 'local'
$env:ACADEMY_EXECUTION_MODE = 'local-ollama-zero-commercial-api-cost-locked'
$env:STUDIO_ALLOW_PAID_AI = 'false'
$env:STUDIO_AI_PROVIDER = 'disabled'
$env:STUDIO_RESEARCH_PROVIDER = 'local'
$env:STUDIO_AUTHORING_PROVIDER = 'local'
$env:STUDIO_REVIEW_PROVIDER = 'local'
$env:STUDIO_VIDEO_PROVIDER = 'local'
$env:STUDIO_TTS_PROVIDER = 'local'
$env:LOCAL_AI_BASE_URL = 'http://127.0.0.1:11434'
$env:LOCAL_AI_MODEL = $Model
$env:LOCAL_RESEARCH_MODEL = $Model
$env:LOCAL_REVIEW_MODEL = $Model
$env:LOCAL_AI_NUM_CTX = '24576'
$env:ACADEMY_LOCAL_MODEL_CONTEXT = '24576'
$env:ACADEMY_LOCAL_CONTEXT_MAX_CHARS = '60000'
$env:ACADEMY_SOURCE_CONTEXT_MAX_CHARS = '32000'
$env:ACADEMY_SOURCE_FILE_MAX_CHARS = '5000'
$env:ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS = '1800000'
$env:LOCAL_AI_TIMEOUT_MS = '3600000'
$env:LOCAL_REVIEW_TIMEOUT_MS = '3600000'
$env:OLLAMA_CONTEXT_LENGTH = '24576'
$env:OLLAMA_FLASH_ATTENTION = '1'
$env:OLLAMA_KV_CACHE_TYPE = 'q8_0'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_KEEP_ALIVE = '30m'
$env:OLLAMA_NUM_PARALLEL = [string]$workers
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_MAX_QUEUE = '64'
$env:OLLAMA_LOAD_TIMEOUT = '30m'

$blockedVariables = @(
    'OPENAI_API_KEY','ANTHROPIC_API_KEY','ELEVENLABS_API_KEY','HEYGEN_API_KEY','SYNTHESIA_API_KEY',
    'DID_API_KEY','RUNWAY_API_KEY','REPLICATE_API_TOKEN','GOOGLE_GENERATIVE_AI_API_KEY','GEMINI_API_KEY',
    'MISTRAL_API_KEY','COHERE_API_KEY','GROQ_API_KEY','TOGETHER_API_KEY','AZURE_OPENAI_API_KEY',
    'AWS_BEDROCK_API_KEY','FIREWORKS_API_KEY','PERPLEXITY_API_KEY','XAI_API_KEY','CEREBRAS_API_KEY',
    'DEEPINFRA_API_TOKEN','OPENAI_API_URL','ANTHROPIC_API_URL','ELEVENLABS_API_URL','HEYGEN_API_URL',
    'SYNTHESIA_API_URL','DID_API_URL','RUNWAY_API_URL','REPLICATE_API_URL','AZURE_OPENAI_ENDPOINT',
    'AWS_BEDROCK_ENDPOINT','FIREWORKS_API_URL','PERPLEXITY_API_URL','XAI_API_URL','CEREBRAS_API_URL',
    'DEEPINFRA_API_URL'
)
foreach ($name in $blockedVariables) { Set-Item -Path ('Env:{0}' -f $name) -Value '' }

Invoke-Native -FilePath 'node.exe' -Arguments @('studio/academy-zero-cost-lock.mjs') -Label 'Verify zero-cost production lock'

if (-not (Test-OllamaReady)) {
    Write-Host 'Starting dedicated local Ollama service...' -ForegroundColor Yellow
    $ollamaOut = Join-Path $runRoot 'ollama.out.log'
    $ollamaErr = Join-Path $runRoot 'ollama.err.log'
    Start-Process -FilePath 'ollama.exe' -ArgumentList @('serve') -WindowStyle Hidden -RedirectStandardOutput $ollamaOut -RedirectStandardError $ollamaErr | Out-Null
    $ready = $false
    for ($attempt = 1; $attempt -le 90; $attempt++) {
        Start-Sleep -Seconds 2
        if (Test-OllamaReady) { $ready = $true; break }
    }
    if (-not $ready) {
        throw ('Ollama did not become ready. Inspect {0} and {1}' -f $ollamaOut, $ollamaErr)
    }
}
else {
    Write-Host 'Existing local Ollama service detected and will be reused.' -ForegroundColor Green
}

& ollama.exe show $Model *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-Native -FilePath 'ollama.exe' -Arguments @('pull', $Model) -Label ('Pull local model {0}' -f $Model)
}
Invoke-Native -FilePath 'ollama.exe' -Arguments @('show', $Model) -Label ('Verify local model {0}' -f $Model)

if (-not $SkipSourceRefresh) {
    Invoke-Native -FilePath 'node.exe' -Arguments @('studio/fetch-free-authoritative-source-cache.mjs') -Label 'Refresh governed public source cache once'
}

Remove-Item Env:ACADEMY_SHARD_INDEX -ErrorAction SilentlyContinue
Remove-Item Env:ACADEMY_SHARD_COUNT -ErrorAction SilentlyContinue
Invoke-Native -FilePath 'node.exe' -Arguments @('studio/build-free-course-source-context.mjs') -Label 'Build governed source context for all 61 courses once'

$pending = New-Object 'System.Collections.Generic.Queue[int]'
for ($index = 0; $index -lt 61; $index++) { $pending.Enqueue($index) }
$active = @{}
$attempts = @{}
$completed = New-Object 'System.Collections.Generic.List[int]'
$failed = New-Object 'System.Collections.Generic.List[int]'
for ($index = 0; $index -lt 61; $index++) { $attempts[$index] = 0 }

function Save-RunState {
    $activeRecords = @()
    foreach ($key in @($active.Keys | Sort-Object)) {
        $entry = $active[$key]
        $activeRecords += [ordered]@{
            shardIndex = [int]$key
            courseId = $courseIds[[int]$key]
            processId = $entry.Process.Id
            attempt = $entry.Attempt
            stdout = $entry.Stdout
            stderr = $entry.Stderr
            startedAt = $entry.StartedAt
        }
    }
    $pendingIndexes = @($pending.ToArray())
    $state = [ordered]@{
        schemaVersion = '1.0'
        runId = $runId
        updatedAt = (Get-Date).ToString('o')
        productionRoot = $root
        repositoryRoot = $repo
        model = $Model
        commercialModelApiCostUsd = 0
        hardware = $hardware
        workerLimit = $workers
        totalCourses = 61
        completedCount = $completed.Count
        activeCount = $active.Count
        queuedCount = $pendingIndexes.Count
        failedCount = $failed.Count
        completed = @($completed | ForEach-Object { [ordered]@{ shardIndex = $_; courseId = $courseIds[$_] } })
        active = $activeRecords
        queued = @($pendingIndexes | ForEach-Object { [ordered]@{ shardIndex = $_; courseId = $courseIds[$_] } })
        failed = @($failed | ForEach-Object { [ordered]@{ shardIndex = $_; courseId = $courseIds[$_] } })
    }
    Write-State -Path $statePath -Value $state
}

function Start-LocalWorker {
    param([Parameter(Mandatory = $true)][int]$Index)

    $attempts[$Index] = [int]$attempts[$Index] + 1
    $courseId = $courseIds[$Index]
    $safeCourse = $courseId -replace '[^a-zA-Z0-9_.-]', '_'
    $stdout = Join-Path $runRoot ('{0:D2}-{1}.out.log' -f $Index, $safeCourse)
    $stderr = Join-Path $runRoot ('{0:D2}-{1}.err.log' -f $Index, $safeCourse)
    $argumentLine = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $workerScript),
        '-RepositoryRoot', ('"{0}"' -f $repo),
        '-ShardIndex', [string]$Index,
        '-ShardCount', '61',
        '-ProductionRoot', ('"{0}"' -f $root)
    )
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentLine -WorkingDirectory $repo -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $active[$Index] = [ordered]@{
        Process = $process
        Attempt = [int]$attempts[$Index]
        Stdout = $stdout
        Stderr = $stderr
        StartedAt = (Get-Date).ToString('o')
    }
    Write-Host ('STARTED [{0:D2}] {1} | PID {2} | attempt {3}' -f $Index, $courseId, $process.Id, $attempts[$Index]) -ForegroundColor Cyan
}

Save-RunState
Write-Host ('All 61 courses are now registered in the local production queue; up to {0} will execute concurrently.' -f $workers) -ForegroundColor Green

$lastStatusAt = [DateTime]::MinValue
while ($pending.Count -gt 0 -or $active.Count -gt 0) {
    while ($active.Count -lt $workers -and $pending.Count -gt 0) {
        Start-LocalWorker -Index $pending.Dequeue()
    }

    Start-Sleep -Seconds 5
    foreach ($index in @($active.Keys)) {
        $entry = $active[$index]
        $process = $entry.Process
        if (-not $process.HasExited) { continue }

        $exitCode = $process.ExitCode
        $active.Remove($index)
        $courseId = $courseIds[[int]$index]
        if ($exitCode -eq 0) {
            $completed.Add([int]$index)
            Write-Host ('PASSED  [{0:D2}] {1} | {2}/61 complete' -f $index, $courseId, $completed.Count) -ForegroundColor Green
        }
        elseif ([int]$attempts[$index] -le $MaxShardRestarts) {
            Write-Host ('RETRY   [{0:D2}] {1} | exit {2} | requeued' -f $index, $courseId, $exitCode) -ForegroundColor Yellow
            $pending.Enqueue([int]$index)
        }
        else {
            $failed.Add([int]$index)
            Write-Host ('FAILED  [{0:D2}] {1} | exit {2} | inspect {3}' -f $index, $courseId, $exitCode, $entry.Stderr) -ForegroundColor Red
        }
    }

    Save-RunState
    $now = Get-Date
    if (($now - $lastStatusAt).TotalSeconds -ge 30) {
        Write-Host ('STATUS  complete={0}/61 active={1} queued={2} failed={3}' -f $completed.Count, $active.Count, $pending.Count, $failed.Count) -ForegroundColor White
        $lastStatusAt = $now
    }
}

Save-RunState
Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
if ($failed.Count -eq 0 -and $completed.Count -eq 61) {
    Write-Host ' 61/61 LOCAL COURSE CONTENT BUILDS COMPLETED' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ('Local checkpoints : {0}' -f (Join-Path $root 'checkpoints\courses'))
    Write-Host ('Generated courses : {0}' -f (Join-Path $root 'courses'))
    Write-Host ('Run state         : {0}' -f $statePath)
    Write-Host ('Logs              : {0}' -f $runRoot)
    exit 0
}

Write-Host (' LOCAL BUILD FINISHED WITH {0} FAILED COURSE(S)' -f $failed.Count) -ForegroundColor Red
Write-Host '============================================================' -ForegroundColor Red
Write-Host ('Run state: {0}' -f $statePath)
exit 2
