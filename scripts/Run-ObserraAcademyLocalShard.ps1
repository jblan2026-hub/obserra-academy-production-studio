[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][int]$ShardIndex,
    [int]$ShardCount = 61,
    [string]$ProductionRoot = 'C:\ObserraAcademyProduction'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-NodeStep {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Label)
    & node @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw ('{0} failed with exit code {1}' -f $Label, $code)
    }
}

function Get-SelectedCourseId {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][int]$Index,
        [Parameter(Mandatory = $true)][int]$Count
    )

    $courseIds = @(
        Get-ChildItem -LiteralPath (Join-Path $Repo 'courses') -Directory | ForEach-Object {
            $manifestPath = Join-Path $_.FullName 'course-manifest.json'
            if (-not (Test-Path -LiteralPath $manifestPath)) { return }
            try {
                $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
                $status = [string]$manifest.release.status
                if ($status -and @('retired', 'archived') -contains $status.ToLowerInvariant()) { return }
                $_.Name
            }
            catch {
                throw ('Unable to parse course manifest: {0}' -f $manifestPath)
            }
        } | Sort-Object
    )

    if ($courseIds.Count -ne 61) {
        throw ('Expected 61 active Academy courses, found {0}' -f $courseIds.Count)
    }

    $selected = @()
    for ($i = 0; $i -lt $courseIds.Count; $i++) {
        if (($i % $Count) -eq $Index) { $selected += $courseIds[$i] }
    }
    if ($selected.Count -ne 1) {
        throw ('Shard {0}/{1} must resolve to exactly one course; resolved {2}' -f $Index, $Count, $selected.Count)
    }
    return [string]$selected[0]
}

$repo = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$root = [IO.Path]::GetFullPath($ProductionRoot)
$envFile = Join-Path $root 'academy-local-paths.ps1'
if (Test-Path -LiteralPath $envFile) { . $envFile }

$env:OBSERRA_ACADEMY_PRODUCTION_ROOT = $root
$env:ACADEMY_LOCAL_CHECKPOINT_DIR = Join-Path $root 'checkpoints'
$env:ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED = 'false'
$env:ACADEMY_CHECKPOINT_GATEWAY_URL = ''
$env:DATABASE_URL = ''
$env:STUDIO_OWNER_ORGANIZATION_ID = 'org_obserra_academy'
$env:STUDIO_OWNER_ORGANIZATION_NAME = 'Obserra Academy'
$env:ACADEMY_SHARD_INDEX = [string]$ShardIndex
$env:ACADEMY_SHARD_COUNT = [string]$ShardCount
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
$env:LOCAL_AI_MODEL = if ($env:LOCAL_AI_MODEL) { $env:LOCAL_AI_MODEL } else { 'qwen2.5:7b-instruct' }
$env:LOCAL_RESEARCH_MODEL = $env:LOCAL_AI_MODEL
$env:LOCAL_REVIEW_MODEL = $env:LOCAL_AI_MODEL
$env:LOCAL_AI_NUM_CTX = if ($env:LOCAL_AI_NUM_CTX) { $env:LOCAL_AI_NUM_CTX } else { '24576' }
$env:ACADEMY_LOCAL_MODEL_CONTEXT = $env:LOCAL_AI_NUM_CTX
$env:ACADEMY_LOCAL_CONTEXT_MAX_CHARS = if ($env:ACADEMY_LOCAL_CONTEXT_MAX_CHARS) { $env:ACADEMY_LOCAL_CONTEXT_MAX_CHARS } else { '60000' }
$env:ACADEMY_SOURCE_CONTEXT_MAX_CHARS = if ($env:ACADEMY_SOURCE_CONTEXT_MAX_CHARS) { $env:ACADEMY_SOURCE_CONTEXT_MAX_CHARS } else { '32000' }
$env:ACADEMY_SOURCE_FILE_MAX_CHARS = if ($env:ACADEMY_SOURCE_FILE_MAX_CHARS) { $env:ACADEMY_SOURCE_FILE_MAX_CHARS } else { '5000' }
$env:ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS = if ($env:ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS) { $env:ACADEMY_AUTHORING_REQUEST_TIMEOUT_MS } else { '1800000' }
$env:ACADEMY_LOCAL_SHARD_MAX_ATTEMPTS = if ($env:ACADEMY_LOCAL_SHARD_MAX_ATTEMPTS) { $env:ACADEMY_LOCAL_SHARD_MAX_ATTEMPTS } else { '2' }

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
foreach ($name in $blockedVariables) {
    Set-Item -Path ('Env:{0}' -f $name) -Value ''
}

Set-Location -LiteralPath $repo
$courseId = Get-SelectedCourseId -Repo $repo -Index $ShardIndex -Count $ShardCount
$startedAt = (Get-Date).ToString('o')
Write-Host ('Academy local shard {0}/{1} starting course {2}' -f ($ShardIndex + 1), $ShardCount, $courseId) -ForegroundColor Cyan

Invoke-NodeStep -Arguments @('studio/academy-zero-cost-lock.mjs') -Label 'Zero-cost policy lock'
Invoke-NodeStep -Arguments @('studio/build-free-course-source-context.mjs') -Label ('Governed source context for {0}' -f $courseId)
Invoke-NodeStep -Arguments @('.github/scripts/run-academy-zero-cost-shard.mjs') -Label ('Research, author, validate, review: {0}' -f $courseId)

$generatedPath = Join-Path (Join-Path (Join-Path $repo 'courses') $courseId) 'generated'
$checkpointCourseRoot = Join-Path (Join-Path (Join-Path $root 'checkpoints') 'courses') $courseId
if (-not (Test-Path -LiteralPath $generatedPath)) {
    throw ('Generated course path is missing after successful worker completion: {0}' -f $generatedPath)
}
New-Item -ItemType Directory -Path $checkpointCourseRoot -Force | Out-Null
& robocopy.exe $generatedPath $checkpointCourseRoot /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH /NJS
$copyCode = $LASTEXITCODE
if ($copyCode -gt 7) {
    throw ('Local checkpoint mirror failed for {0} with robocopy exit code {1}' -f $courseId, $copyCode)
}

$commit = (& git -C $repo rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0) { $commit = 'unknown' }
$record = [ordered]@{
    schemaVersion = '1.0'
    courseId = $courseId
    shardIndex = $ShardIndex
    shardCount = $ShardCount
    startedAt = $startedAt
    completedAt = (Get-Date).ToString('o')
    repositoryCommit = [string]$commit
    generatedPath = $generatedPath
    checkpointPath = $checkpointCourseRoot
    provider = 'local'
    model = $env:LOCAL_AI_MODEL
    commercialModelApiCostUsd = 0
    passed = $true
}
$recordPath = Join-Path $checkpointCourseRoot 'local-checkpoint.json'
$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $recordPath -Encoding UTF8
Write-Host ('COMPLETED {0}. Local checkpoint: {1}' -f $courseId, $checkpointCourseRoot) -ForegroundColor Green
