# Obserra Owner AI Command Center Endpoint Operations

## Operational boundary

The Command Center is a local Windows owner control plane. It binds its health service to loopback only, stores device identity material through Windows protected storage, denies browser navigation outside the packaged application, and exposes no inbound remote administration endpoint. External services are contacted only through approved outbound connectors.

A Windows installer or portable executable is not proof that the Command Center is installed or operational. Installation is verified only when the target machine produces all of the following evidence:

1. A target bound bootstrap profile was applied on the expected hostname.
2. Windows credential encryption was available.
3. A unique device identity and device fingerprint were created.
4. The endpoint entered the enrolled state.
5. The running process wrote a fresh endpoint heartbeat receipt.
6. The loopback readiness service returned a ready response for the same device identity.
7. The installation receipt and endpoint receipt matched.

Academy control plane operation is evaluated separately. The endpoint may be installed and live while Academy course production remains blocked by database, provider, course, media, accessibility, rights, entitlement, certificate, security, or owner approval gates.

## Installation

Run the target release media installer from an owner controlled PowerShell session:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Install-Obserra-Command-Center.ps1
```

For the portable executable:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Install-Obserra-Command-Center.ps1 -Portable
```

The installer verifies every release file against `SHA256SUMS.json`, enforces the target hostname unless the owner explicitly supplies `-SkipHostnameCheck`, copies the bootstrap profile into the protected local application data directory, launches the application, and waits for verified endpoint readiness.

Use `-RequireControlPlaneOperational` only when the Academy production evidence and all operational dependencies are expected to be green. Without that switch, the installer may verify the endpoint as live while clearly reporting governed Academy blockers.

## Direct verification

To verify an existing installation without reinstalling:

```powershell
.\Test-Obserra-Command-Center-Endpoint.ps1
```

The verifier checks the endpoint receipt at:

```text
%LOCALAPPDATA%\Obserra\OwnerCommandCenter\endpoint-status.json
```

It also checks the installation receipt, device identity, target hostname, enrollment state, Windows encryption, bootstrap status, heartbeat age, and loopback readiness response.

## Endpoint status definitions

`endpointReady=true` means the local process, target bootstrap, encrypted device identity, enrollment, current heartbeat, and loopback readiness service are verified.

`controlPlaneOperational=true` means endpoint readiness is verified and the authoritative Academy production evidence reader reports no active blockers. It does not authorize course publication or payment enablement.

`publicationLocked=true` means the Command Center is correctly preserving the separation between course production and owner approved release.

## Recovery

Use the encrypted recovery bundle controls inside the Command Center to preserve connector configuration and authorized local state. Recovery bundles require a passphrase of at least 14 characters and use authenticated encryption. Restore operations recheck connector and endpoint state rather than treating stored data as current live evidence.

The endpoint identity is device bound. Moving application files to another machine does not transfer enrollment. The new machine must receive an intentionally generated target bootstrap and create its own encrypted identity.

## Revocation

Use the Endpoint Enrollment panel to revoke the local endpoint. Revocation removes the enrolled state but does not silently uninstall the application or delete evidence. Reenrollment requires the target bootstrap and explicit owner confirmation unless a target bound package is configured for automatic enrollment.

## Fail closed conditions

The endpoint remains not ready when Windows protected storage is unavailable, the bootstrap is missing or targets another hostname, endpoint enrollment is absent or revoked, the loopback service is unavailable, the heartbeat is stale, or receipt identities do not match.

The Academy control plane remains not operational when worker execution evidence is absent, the 36 worker and zero application worker allocation is not proven, provider preflight is not green, checkpoints are unavailable, course compliance staging is incomplete, media submission is incomplete, the protected learner catalog is not ready, or publication readiness remains blocked.
