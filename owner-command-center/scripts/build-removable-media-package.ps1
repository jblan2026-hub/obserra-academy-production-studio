[CmdletBinding()]
param(
    [string]$Destination
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDirectory "..")).Path
$dist = Join-Path $root "dist"
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $root "release-media"
}
$destinationPath = [System.IO.Path]::GetFullPath($Destination)

Write-Host "[Obserra] Verifying owner command center..."
Push-Location $root
try {
    npm run verify
    npm run package:windows
} finally {
    Pop-Location
}

if (-not (Test-Path $dist)) {
    throw "Packaging output was not created at $dist"
}

if (Test-Path $destinationPath) {
    Remove-Item $destinationPath -Recurse -Force
}
New-Item -ItemType Directory -Path $destinationPath | Out-Null

$installer = Get-ChildItem $dist -Filter "Obserra-Owner-AI-Command-Center-*.exe" |
    Where-Object { $_.Name -notlike "*Portable*" } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
$portable = Get-ChildItem $dist -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if (-not $installer) { throw "One-click installer executable was not produced." }
if (-not $portable) { throw "Portable executable was not produced." }

Copy-Item $installer.FullName (Join-Path $destinationPath $installer.Name)
Copy-Item $portable.FullName (Join-Path $destinationPath $portable.Name)
Copy-Item (Join-Path $root "INSTALL-AND-RECOVERY.md") (Join-Path $destinationPath "INSTALL-AND-RECOVERY.md")
Copy-Item (Join-Path $root "HIGH-AVAILABILITY.md") (Join-Path $destinationPath "HIGH-AVAILABILITY.md")

$installScript = @'
[CmdletBinding()]
param([switch]$Portable)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Portable) {
    $app = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-Portable-*.exe" | Select-Object -First 1
} else {
    $app = Get-ChildItem $here -Filter "Obserra-Owner-AI-Command-Center-*.exe" | Where-Object { $_.Name -notlike "*Portable*" } | Select-Object -First 1
}
if (-not $app) { throw "Required Obserra installer was not found on this media." }
Start-Process -FilePath $app.FullName -Wait
'@
Set-Content (Join-Path $destinationPath "Install-Obserra-Command-Center.ps1") $installScript -Encoding UTF8

$hashes = Get-ChildItem $destinationPath -File | ForEach-Object {
    $hash = Get-FileHash $_.FullName -Algorithm SHA256
    [pscustomobject]@{
        File = $_.Name
        SHA256 = $hash.Hash
        Bytes = $_.Length
    }
}
$hashes | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $destinationPath "SHA256SUMS.json") -Encoding UTF8
$hashes | ForEach-Object { "{0}  {1}" -f $_.SHA256, $_.File } | Set-Content (Join-Path $destinationPath "SHA256SUMS.txt") -Encoding ASCII

Write-Host "[Obserra] Removable-media package created at $destinationPath"
Write-Host "[Obserra] Includes one-click installer, portable executable, installation launcher, recovery guide, and SHA-256 integrity manifests."
