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

function Test-OllamaReady {
    try {
        $null = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
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
        $null = Invoke-RestMethod -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:11434/api/show' -ContentType 'application/json' -Body $body -TimeoutSec 15
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-OllamaPull {
    param([Parameter(Mandatory = $true)][string]$Name)

    Write-Host ''
    Write-Host ('Local model {0} is not installed. Downloading it once...' -f $Name) -ForegroundColor Yellow
    $process = Start-Process -FilePath 'ollama.exe' -ArgumentList @('pull', $Name) -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw ('Ollama model pull failed with exit code {0}' -f $process.ExitCode)
    }
    if (-not (Test-OllamaModel -Name $Name)) {
        throw ('Ollama completed the pull but model verification still failed: {0}' -f $Name)
    }
    Write-Host ('Local model verified: {0}' -f $Name) -ForegroundColor Green
}

Refresh-Path
if (-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)) {
    throw 'Ollama is not available in PATH. Run the standard Academy local launcher once to install tooling, then rerun this command.'
}

$root = [IO.Path]::GetFullPath($ProductionRoot)
$repo = Join-Path $root 'source\obserra-academy-production-studio'
$launcher = Join-Path $repo 'scripts\Start-ObserraAcademyLocalProduction.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
    throw ('Academy local production launcher is missing: {0}' -f $launcher)
}

if (-not (Test-OllamaReady)) {
    Write-Host 'Starting Ollama...' -ForegroundColor Yellow
    Start-Process -FilePath 'ollama.exe' -ArgumentList @('serve') -WindowStyle Hidden | Out-Null
    $ready = $false
    for ($attempt = 1; $attempt -le 90; $attempt++) {
        Start-Sleep -Seconds 2
        if (Test-OllamaReady) {
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        throw 'Ollama did not become ready on http://127.0.0.1:11434 within 180 seconds.'
    }
}

if (-not (Test-OllamaModel -Name $Model)) {
    Invoke-OllamaPull -Name $Model
}
else {
    Write-Host ('Local model already installed: {0}' -f $Model) -ForegroundColor Green
}

Write-Host ''
Write-Host 'Starting the 61-course local production queue...' -ForegroundColor Cyan
$params = @{
    ProductionRoot = $root
    Model = $Model
    MaxWorkers = $MaxWorkers
    MaxShardRestarts = $MaxShardRestarts
}
if ($SkipSourceRefresh) { $params.SkipSourceRefresh = $true }

& $launcher @params
exit $LASTEXITCODE
