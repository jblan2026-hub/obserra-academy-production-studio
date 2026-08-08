# Obserra Owner AI Command Center Installation and Recovery

## Security and claim boundary

Use the Command Center only on an owner-controlled Windows device. The application is local-only and is not a public website or cloud service. It must never be deployed to Vercel or exposed through public ingress.

The release bundle uses SHA-256 verification and produces post-install endpoint evidence. Trusted Authenticode signing is required before broad commercial or enterprise distribution. An owner may install an unsigned owner-only build after intentional hash verification, but Windows may display an unknown-publisher or SmartScreen warning. Do not describe an unsigned package as enterprise distribution-ready.

## Required release files

The verified removable-media bundle must contain:

- The per-user NSIS installer.
- The portable executable.
- `Install-Obserra-Command-Center.ps1`.
- `Test-Obserra-Command-Center-Installation.ps1`.
- `Obserra-Command-Center-Bootstrap.json`.
- `Obserra-Command-Center-Release.json`.
- `Obserra-Worker-Pool-Contract.json`.
- `Obserra-Commercial-Course-Production-Standard.json`.
- `SHA256SUMS.json` and `SHA256SUMS.txt`.
- This guide and `HIGH-AVAILABILITY.md`.

Do not install or execute the package when a required file is missing or a hash differs.

## Recommended endpoint installation

Open PowerShell as the signed-in owner. Administrative elevation is not required. Change to the extracted release-media directory and run the governed installer wrapper.

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
Set-Location "C:\Path\To\release-media"

.\Install-Obserra-Command-Center.ps1 `
  -StudioRoot "C:\Path\To\obserra-academy-production-studio"
```

The script performs these operations in order:

1. Verifies every release file against `SHA256SUMS.json`, including file size and SHA-256 digest.
2. Enforces the target-hostname boundary unless the owner intentionally supplies `-SkipHostnameCheck`.
3. Copies the governed bootstrap, worker contract, production standard, and release descriptor into the owner’s local application-data directory.
4. Persists `OBSERRA_COMMAND_CENTER_BOOTSTRAP` for the current Windows user.
5. Validates and persists `OBSERRA_ACADEMY_STUDIO_ROOT` when a valid Studio repository is supplied or discovered.
6. Runs the per-user installer without requesting administrator privileges.
7. Executes the endpoint health verifier.
8. Writes installation and endpoint-health evidence.
9. Launches the Command Center only after verification succeeds.

The Academy Studio repository is valid only when it contains `package.json`, `courses`, `studio`, and `policy/elastic-worker-pool-contract.json`.

## Installation on a differently named owner endpoint

The default package targets the Windows machine named `obserra`. Use the override only after confirming that the package is intended for the current owner-controlled endpoint.

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
Set-Location "C:\Path\To\release-media"

.\Install-Obserra-Command-Center.ps1 `
  -SkipHostnameCheck `
  -StudioRoot "C:\Path\To\obserra-academy-production-studio"
```

The override is recorded by the installation process. It does not disable the local-only, owner-only, hash-verification, or evidence requirements.

## Portable installation

Portable mode copies the verified executable into the owner’s local application-data directory rather than running directly from removable media.

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
Set-Location "C:\Path\To\release-media"

.\Install-Obserra-Command-Center.ps1 `
  -Portable `
  -StudioRoot "C:\Path\To\obserra-academy-production-studio"
```

Portable operation does not remove the requirements for Windows-backed credential encryption, owner authorization, local-only execution, protected Studio content, or release evidence.

## Install without launching

Use this mode for controlled deployment or validation. The package is installed and verified, but the application is not opened.

```powershell
.\Install-Obserra-Command-Center.ps1 `
  -NoLaunch `
  -StudioRoot "C:\Path\To\obserra-academy-production-studio"
```

## Require trusted Authenticode signing

Use this option for an enterprise or production-distribution gate. The installation fails closed when the executable is not signed by a trusted certificate.

```powershell
.\Install-Obserra-Command-Center.ps1 `
  -RequireAuthenticode `
  -StudioRoot "C:\Path\To\obserra-academy-production-studio"
```

Do not use `-RequireAuthenticode` until the release is signed; an unsigned owner-only package will intentionally fail this gate.

## Re-run endpoint verification

The verifier can be run independently after installation, upgrades, repository relocation, or recovery.

```powershell
Set-Location "C:\Path\To\release-media"

.\Test-Obserra-Command-Center-Installation.ps1 `
  -StudioRoot "C:\Path\To\obserra-academy-production-studio"
```

For a portable installation:

```powershell
.\Test-Obserra-Command-Center-Installation.ps1 `
  -Portable `
  -StudioRoot "C:\Path\To\obserra-academy-production-studio"
```

## Evidence locations

The installation process writes owner-local evidence under:

```text
%LOCALAPPDATA%\Obserra\OwnerCommandCenter\
```

The principal records are:

- `installation-record.json`: installation time, endpoint, mode, bootstrap location, Studio root, package-manifest digest, release-descriptor digest, and owner authorization.
- `endpoint-health.json`: executable path and digest, Authenticode status, local-only state, Studio connectivity, worker contract, production standard, and quality tier.
- `Obserra-Command-Center-Bootstrap.json`: approved connector endpoints and target-host profile.
- `Obserra-Command-Center-Release.json`: release version, governed allocation, signing state, and production-standard identity.

A successful endpoint-health result proves installation and local configuration on that endpoint. It does not prove that external connectors are authenticated, the Academy database is available, all courses are complete, media is mastered, or publication is approved.

## Initial configuration

Configure only approved outbound connectors. Use HTTPS for remote systems. Plain HTTP is permitted only for loopback services such as a local AI runtime. Validate every connector in read-only mode before enabling an owner-approved control action.

The governed parallel allocation packaged with release `0.3.0` is:

- 28 Academy course-production workers.
- 8 Command Center release and endpoint workers.
- 0 unrelated application workers.
- 0 idle workers while eligible governed work remains.

Workers remain interchangeable under the active contract and may be reassigned when workload or criticality changes.

## Academy publication protection

The Command Center may author, revise, materialize, stage, build a source-resolution queue, and measure release gates. It has no direct `publish`, `checkout`, or `finalize` action. Enabling Academy publication requires all of the following:

- An approved or published manifest status.
- A valid governed `FINAL` package.
- An accepted commercial-release evidence record.
- Zero unresolved external references.
- Complete required media inventory.
- Explicit owner acceptance.

A compliance-staged course is not final, purchasable, publication-ready, or authorized for a Hollywood-grade completion claim.

## Recovery export

Export a recovery bundle after initial configuration and after any credential or connector change. Use a strong passphrase containing at least 14 characters. Store the encrypted bundle separately from the passphrase.

## Recovery import

Install the same or a later compatible verified release on the recovery device. Import the encrypted recovery bundle, verify all connector endpoints, confirm that the application remains local-only, and keep write actions disabled until the owner explicitly approves them.

## Restore and rollback

Retain the previous verified release and its SHA-256 manifest until the replacement release passes endpoint verification and operational checks. To roll back:

1. Close the Command Center.
2. Preserve the current `installation-record.json` and `endpoint-health.json` for forensic evidence.
3. Uninstall the current installed build when applicable.
4. Reinstall the previous verified release through its governed wrapper.
5. Import the matching encrypted recovery bundle.
6. Re-run endpoint verification.
7. Validate connectors in read-only mode before resuming owner-approved actions.

## Loss or compromise

When removable media, a workstation, an installation record, or a recovery bundle is lost or suspected to be compromised, rotate all connector credentials, revoke active tokens, create a new encrypted recovery bundle, invalidate the prior package inventory, and document the response in the owner audit record.
