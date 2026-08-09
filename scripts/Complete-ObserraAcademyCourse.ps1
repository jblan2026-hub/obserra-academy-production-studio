[CmdletBinding()]
param(
    [string]$ProductionRoot = 'C:\ObserraAcademyProduction',
    [string]$CourseId = 'ai-data-privacy-ip',
    [string]$Model = 'qwen2.5:7b-instruct',
    [ValidateRange(4096, 10240)][int]$ModuleOutputTokens = 5120,
    [ValidateRange(8192, 16384)][int]$ModuleContext = 8192,
    [switch]$SkipSourceRefresh,
    [switch]$SkipMediaToolInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ('{0};{1}' -f $machinePath, $userPath)
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = '{0}.{1}.{2}.tmp' -f $Path, $PID, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine), $encoding)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Test-OllamaReady {
    try {
        $null = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
        return $true
    }
    catch {
        return $false
    }
}

function Test-OllamaModel {
    param([Parameter(Mandatory = $true)][string]$Name)

    try {
        $body = @{ model = $Name } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:11434/api/show' -ContentType 'application/json' -Body $body -TimeoutSec 20
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Label) -ForegroundColor Cyan
    & $Command @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw ('{0} failed with exit code {1}' -f $Label, $code)
    }
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$PackageId,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw ('{0} is missing and winget is unavailable. Install it once, then rerun this command.' -f $Label)
    }

    Invoke-External -Command 'winget.exe' -Arguments @(
        'install', '--id', $PackageId, '--exact', '--silent',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
    ) -Label ('Install {0}' -f $Label)
    Refresh-Path
}

function Resolve-PythonLauncher {
    if (Get-Command py.exe -ErrorAction SilentlyContinue) {
        return @{ Command = 'py.exe'; Prefix = @('-3.11') }
    }
    if (Get-Command python.exe -ErrorAction SilentlyContinue) {
        return @{ Command = 'python.exe'; Prefix = @() }
    }
    if (Get-Command python3.exe -ErrorAction SilentlyContinue) {
        return @{ Command = 'python3.exe'; Prefix = @() }
    }
    return $null
}

function Get-ActiveCourseIds {
    param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

    return @(
        Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'courses') -Directory | ForEach-Object {
            $manifestPath = Join-Path $_.FullName 'course-manifest.json'
            if (-not (Test-Path -LiteralPath $manifestPath)) { return }
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            $releaseStatus = [string]$manifest.release.status
            if ($releaseStatus -and @('retired', 'archived') -contains $releaseStatus.ToLowerInvariant()) { return }
            $_.Name
        } | Sort-Object
    )
}

$root = [IO.Path]::GetFullPath($ProductionRoot)
$repo = Join-Path $root 'source\obserra-academy-production-studio'
$manifestPath = Join-Path (Join-Path (Join-Path $repo 'courses') $CourseId) 'course-manifest.json'
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    throw ('Academy repository is missing: {0}' -f $repo)
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw ('Course manifest is missing: {0}' -f $manifestPath)
}

$runId = 'single-course-{0}-{1}' -f $CourseId, (Get-Date -Format 'yyyyMMdd-HHmmss')
$runRoot = Join-Path (Join-Path $root 'logs') $runId
$statePath = Join-Path $runRoot 'single-course-state.json'
$transcriptPath = Join-Path $runRoot 'single-course-transcript.log'
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null

$state = [ordered]@{
    schemaVersion = '1.0'
    runId = $runId
    courseId = $CourseId
    repository = $repo
    repositoryCommit = $null
    provider = 'local'
    model = $Model
    commercialApiCostUsd = 0
    status = 'starting'
    stage = 'preflight'
    startedAt = (Get-Date).ToString('o')
    updatedAt = (Get-Date).ToString('o')
    completedAt = $null
    failedStage = $null
    error = $null
    contentCheckpointPassed = $false
    assetsMaterialized = $false
    mediaRendered = $false
    finalVerifierPassed = $false
    localCompletionPath = $null
}

function Save-State {
    param(
        [Parameter(Mandatory = $true)][string]$Status,
        [Parameter(Mandatory = $true)][string]$Stage,
        [string]$ErrorMessage = $null
    )

    $state.status = $Status
    $state.stage = $Stage
    $state.updatedAt = (Get-Date).ToString('o')
    $state.error = $ErrorMessage
    if ($Status -eq 'failed') { $state.failedStage = $Stage }
    if ($Status -eq 'complete') { $state.completedAt = (Get-Date).ToString('o') }
    Write-JsonAtomic -Path $statePath -Value $state
}

$mutexName = 'Local\ObserraAcademy-{0}' -f ($CourseId -replace '[^A-Za-z0-9_-]', '_')
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
    $mutex.Dispose()
    throw ('A completion worker is already active for {0}. Do not launch a duplicate.' -f $CourseId)
}

$transcriptStarted = $false
try {
    Start-Transcript -LiteralPath $transcriptPath -Force | Out-Null
    $transcriptStarted = $true
    Set-Location -LiteralPath $repo

    $commit = (& git -C $repo rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to determine the Academy repository commit.' }
    $state.repositoryCommit = ([string]$commit).Trim()
    Save-State -Status 'running' -Stage 'preflight'

    Refresh-Path
    foreach ($requiredCommand in @('node.exe', 'git.exe', 'ollama.exe')) {
        if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
            throw ('Required command is not available: {0}' -f $requiredCommand)
        }
    }

    if (-not (Test-OllamaReady)) {
        Write-Host 'Starting local Ollama service...' -ForegroundColor Yellow
        Start-Process -FilePath 'ollama.exe' -ArgumentList @('serve') -WindowStyle Hidden | Out-Null
        $ready = $false
        for ($attempt = 1; $attempt -le 90; $attempt++) {
            Start-Sleep -Seconds 2
            if (Test-OllamaReady) { $ready = $true; break }
        }
        if (-not $ready) { throw 'Ollama did not become ready within 180 seconds.' }
    }

    if (-not (Test-OllamaModel -Name $Model)) {
        Invoke-External -Command 'ollama.exe' -Arguments @('pull', $Model) -Label ('Download local model {0}' -f $Model)
    }
    if (-not (Test-OllamaModel -Name $Model)) {
        throw ('Local model verification failed: {0}' -f $Model)
    }

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
    $env:STUDIO_VIDEO_PROVIDER = 'local'
    $env:STUDIO_TTS_PROVIDER = 'local'
    $env:LOCAL_AI_BASE_URL = 'http://127.0.0.1:11434'
    $env:LOCAL_AI_MODEL = $Model
    $env:LOCAL_RESEARCH_MODEL = $Model
    $env:LOCAL_REVIEW_MODEL = $Model
    $env:LOCAL_AI_NUM_CTX = [string]$ModuleContext
    $env:ACADEMY_LOCAL_MODEL_CONTEXT = [string]$ModuleContext
    $env:ACADEMY_MODULE_AUTHORING_CONTEXT = [string]$ModuleContext
    $env:ACADEMY_MODULE_AUTHORING_MAX_TOKENS = [string]$ModuleOutputTokens
    $env:ACADEMY_MODULE_AUTHORING_TIMEOUT_MS = '3600000'
    $env:ACADEMY_LOCAL_SHARD_MAX_ATTEMPTS = '2'
    $env:OLLAMA_NUM_PARALLEL = '1'
    $env:OLLAMA_MAX_LOADED_MODELS = '1'
    $env:OLLAMA_NO_CLOUD = '1'

    $activeCourseIds = @(Get-ActiveCourseIds -RepositoryRoot $repo)
    if ($activeCourseIds.Count -ne 61) {
        throw ('Expected 61 active courses, found {0}.' -f $activeCourseIds.Count)
    }
    $courseIndex = [Array]::IndexOf([string[]]$activeCourseIds, $CourseId)
    if ($courseIndex -lt 0) { throw ('Course is not in the active 61-course portfolio: {0}' -f $CourseId) }
    $env:ACADEMY_SHARD_COUNT = '61'
    $env:ACADEMY_SHARD_INDEX = [string]$courseIndex

    Invoke-External -Command 'node.exe' -Arguments @('studio/academy-zero-cost-lock.mjs') -Label 'Verify zero-cost lock'

    if (-not $SkipSourceRefresh) {
        Save-State -Status 'running' -Stage 'source-refresh'
        Invoke-External -Command 'node.exe' -Arguments @('studio/fetch-free-authoritative-source-cache.mjs') -Label 'Refresh governed primary-source cache'
    }

    Save-State -Status 'running' -Stage 'source-context'
    Invoke-External -Command 'node.exe' -Arguments @('studio/apply-course-policy.mjs') -Label 'Apply governed course policy'
    Invoke-External -Command 'node.exe' -Arguments @('studio/build-free-course-source-context.mjs') -Label 'Build deterministic source context'

    Save-State -Status 'running' -Stage 'content-authoring-review'
    Invoke-External -Command 'node.exe' -Arguments @('.github/scripts/run-academy-zero-cost-shard.mjs') -Label ('Research, author, validate, review, and checkpoint {0}' -f $CourseId)
    $state.contentCheckpointPassed = $true
    Save-State -Status 'running' -Stage 'materialization'

    Invoke-External -Command 'node.exe' -Arguments @('studio/materialize-hollywood-course-assets.mjs', '--course', $CourseId) -Label ('Materialize all learning and certificate assets for {0}' -f $CourseId)
    $state.assetsMaterialized = $true

    Save-State -Status 'running' -Stage 'media-tooling'
    if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
        if ($SkipMediaToolInstall) { throw 'FFmpeg or FFprobe is missing and media-tool installation was disabled.' }
        Install-WingetPackage -PackageId 'Gyan.FFmpeg' -Label 'FFmpeg'
    }
    if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
        throw 'FFmpeg or FFprobe is unavailable after installation.'
    }

    $pythonLauncher = Resolve-PythonLauncher
    if (-not $pythonLauncher) {
        if ($SkipMediaToolInstall) { throw 'Python is missing and media-tool installation was disabled.' }
        Install-WingetPackage -PackageId 'Python.Python.3.11' -Label 'Python 3.11'
        $pythonLauncher = Resolve-PythonLauncher
    }
    if (-not $pythonLauncher) { throw 'Python 3.11 is unavailable after installation.' }

    $toolsRoot = Join-Path $root 'tools'
    $venvRoot = Join-Path $toolsRoot 'piper-venv'
    $voiceRoot = Join-Path $toolsRoot 'piper-voices'
    $shimRoot = Join-Path $toolsRoot 'command-shims'
    New-Item -ItemType Directory -Path $toolsRoot, $voiceRoot, $shimRoot -Force | Out-Null

    if (-not (Test-Path -LiteralPath (Join-Path $venvRoot 'Scripts\python.exe'))) {
        Invoke-External -Command $pythonLauncher.Command -Arguments @($pythonLauncher.Prefix + @('-m', 'venv', $venvRoot)) -Label 'Create local Piper virtual environment'
    }
    $venvPython = Join-Path $venvRoot 'Scripts\python.exe'
    Invoke-External -Command $venvPython -Arguments @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', 'piper-tts==1.5.0') -Label 'Install pinned local Piper narration engine'
    Invoke-External -Command $venvPython -Arguments @('-m', 'piper.download_voices', 'en_US-joe-medium', '--data-dir', $voiceRoot) -Label 'Download governed local narration voice'

    $pythonShim = Join-Path $shimRoot 'python3.cmd'
    $shimText = '@echo off' + [Environment]::NewLine + '"' + $venvPython + '" %*' + [Environment]::NewLine
    [IO.File]::WriteAllText($pythonShim, $shimText, (New-Object System.Text.ASCIIEncoding))
    $env:Path = ('{0};{1};{2}' -f $shimRoot, (Join-Path $venvRoot 'Scripts'), $env:Path)
    $env:ACADEMY_LOCAL_TTS_MODEL = 'en_US-joe-medium'
    $env:ACADEMY_LOCAL_TTS_DATA_DIR = $voiceRoot

    Save-State -Status 'running' -Stage 'media-render'
    Invoke-External -Command 'node.exe' -Arguments @('studio/render-canary-course-local-media.mjs', '--course', $CourseId) -Label ('Render final local media for {0}' -f $CourseId)
    $state.mediaRendered = $true

    Save-State -Status 'running' -Stage 'final-verification'
    Invoke-External -Command 'node.exe' -Arguments @('studio/verify-canary-course-completion.mjs', '--course', $CourseId) -Label ('Verify complete production course {0}' -f $CourseId)
    $state.finalVerifierPassed = $true

    $completionRoot = Join-Path (Join-Path (Join-Path $root 'checkpoints') 'production-complete') $CourseId
    if (Test-Path -LiteralPath $completionRoot) { Remove-Item -LiteralPath $completionRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $completionRoot -Force | Out-Null

    $generatedRoot = Join-Path (Join-Path (Join-Path $repo 'courses') $CourseId) 'generated'
    $releaseRoot = Join-Path (Join-Path (Join-Path $repo 'releases') $CourseId) 'FINAL'
    foreach ($copySpec in @(
        @{ Source = $generatedRoot; Destination = Join-Path $completionRoot 'generated' },
        @{ Source = $releaseRoot; Destination = Join-Path $completionRoot 'FINAL' }
    )) {
        if (-not (Test-Path -LiteralPath $copySpec.Source)) { throw ('Required completed output is missing: {0}' -f $copySpec.Source) }
        & robocopy.exe $copySpec.Source $copySpec.Destination /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH /NJS
        $copyCode = $LASTEXITCODE
        if ($copyCode -gt 7) { throw ('Completion checkpoint copy failed with robocopy exit code {0}' -f $copyCode) }
    }

    $hashRecords = @(
        Get-ChildItem -LiteralPath $completionRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
            [ordered]@{
                path = $_.FullName.Substring($completionRoot.Length + 1).Replace('\', '/')
                bytes = $_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    )
    $completionEvidence = [ordered]@{
        schemaVersion = '1.0'
        generatedAt = (Get-Date).ToString('o')
        courseId = $CourseId
        repositoryCommit = $state.repositoryCommit
        provider = 'local'
        model = $Model
        commercialApiCostUsd = 0
        contentCheckpointPassed = $state.contentCheckpointPassed
        assetsMaterialized = $state.assetsMaterialized
        mediaRendered = $state.mediaRendered
        finalVerifierPassed = $state.finalVerifierPassed
        fileCount = $hashRecords.Count
        files = $hashRecords
        passed = $true
    }
    Write-JsonAtomic -Path (Join-Path $completionRoot 'local-production-completion.json') -Value $completionEvidence

    $state.localCompletionPath = $completionRoot
    Save-State -Status 'complete' -Stage 'complete'
    Write-Host ''
    Write-Host ('PRODUCTION COURSE COMPLETE: {0}' -f $CourseId) -ForegroundColor Green
    Write-Host ('Evidence: {0}' -f $completionRoot) -ForegroundColor Green
}
catch {
    $message = $_.Exception.Message
    Save-State -Status 'failed' -Stage ([string]$state.stage) -ErrorMessage $message
    Write-Error $message
    exit 1
}
finally {
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
    }
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
}
