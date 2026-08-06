# Obserra Owner AI Command Center Installation and Recovery

## Package contents

The removable-media release contains:

- A one-click per-user Windows installer.
- A portable Windows executable that can run without installation.
- An installation PowerShell launcher.
- SHA-256 integrity manifests.
- High-availability and recovery documentation.

## Install on a Windows device

1. Copy the complete release-media folder from the removable drive to the target device, or run it directly from trusted removable media.
2. Verify the files against `SHA256SUMS.txt` or `SHA256SUMS.json`.
3. Right-click `Install-Obserra-Command-Center.ps1`, select **Run with PowerShell**, or execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-Obserra-Command-Center.ps1
```

The installer is one-click, per-user, and does not require administrator elevation by default.

## Portable mode

To run without installation:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-Obserra-Command-Center.ps1 -Portable
```

Portable mode is appropriate for emergency recovery or temporary use. Encrypted credentials remain bound to Windows protection on the device where they are created and should not be assumed portable between devices.

## Multiple devices

The application may be installed on multiple owner-controlled Windows devices. Every device remains local-only and outbound-only. Each device must be separately authorized and configured. Do not copy raw secret-store files between devices.

Use an approved encrypted recovery export to transfer non-secret configuration and re-enter or reauthorize provider credentials on the new device. This prevents one compromised device from automatically compromising every standby device.

## Recovery design

- Production website, Academy, LCMS, Studio, commerce, and publishing services operate independently of the desktop application.
- Loss of a desktop installation does not interrupt production.
- A second owner-controlled device may be prepared as a disabled standby.
- Keep at least two verified copies of the installer package on separate encrypted removable media.
- Rebuild release media after every approved application update.
- Test installation and startup on a clean Windows test account before designating media as a recovery copy.

## Integrity verification

```powershell
$manifest = Get-Content .\SHA256SUMS.json | ConvertFrom-Json
foreach ($entry in $manifest) {
    $actual = (Get-FileHash (Join-Path $PWD $entry.File) -Algorithm SHA256).Hash
    if ($actual -ne $entry.SHA256) { throw "Integrity failure: $($entry.File)" }
}
"All release files passed SHA-256 verification."
```

## Security boundary

- No public listener.
- No Vercel deployment.
- No unsolicited inbound remote access.
- Windows-backed encrypted credential storage.
- Provider connections are outbound and independently authenticated.
- A standby installation remains inactive until explicitly configured and authorized by the owner.
