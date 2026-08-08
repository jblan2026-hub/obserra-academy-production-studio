# Obserra Owner AI Command Center Endpoint Operations

## Operational boundary

The Command Center is a local owner desktop control plane. It binds its health service to loopback only, stores device identity and connector credential material through operating-system-backed secure storage, denies browser navigation outside the packaged application, and exposes no inbound remote-administration endpoint. External services are contacted only through approved outbound connectors.

A setup executable, DMG, AppImage, DEB, or portable application is not proof that the Command Center is installed or operational. Installation is verified only when the endpoint produces all of the following evidence:

1. The embedded generic bootstrap profile was discovered and applied.
2. Operating-system-backed secure storage was available.
3. A unique device identity and device fingerprint were created.
4. The owner explicitly enrolled the endpoint.
5. The running process wrote a fresh endpoint heartbeat receipt.
6. The loopback readiness service returned a ready response for the same device identity.
7. The installation receipt and endpoint receipt matched.

The endpoint may be installed and live while Academy course production remains blocked by database, provider, course, media, accessibility, rights, entitlement, certificate, security, or owner-approval gates. Production blockers are displayed; they do not prevent the owner control plane from running, synchronizing evidence, or waiting for a release decision gate.

## Standard installation

### Windows

Download and double-click the standard graphical setup executable matching the device architecture. The assisted installer allows the owner to select the installation directory and does not require PowerShell for normal installation.

- `Obserra-Owner-AI-Command-Center-Setup-<version>-x64.exe`
- `Obserra-Owner-AI-Command-Center-Setup-<version>-arm64.exe`

The optional portable executable can run without installation, but it must be closed before replacing or re-extracting the directory that contains it.

### macOS

Open the universal DMG, drag the application to **Applications**, and launch it. Production distribution requires signing and notarization evidence.

### Linux

Use the AppImage for a self-contained executable or the DEB for Debian and Ubuntu package-managed installation. Select the package matching the device architecture.

### First launch

On every supported platform:

1. Launch the Command Center.
2. Open **Owner device enrollment**.
3. Select **Enroll this device**.
4. Enter the exact confirmation phrase displayed by the application.
5. Verify that endpoint state, heartbeat, local readiness, and blockers are visible.

The same verified generic installer can be used on multiple owner-controlled devices. Each installation creates its own revocable device identity. A wildcard bootstrap never silently auto-enrolls a device.

PowerShell scripts remain optional enterprise-automation and evidence utilities. They are not the normal installation path.

## Direct verification

The application itself displays device identity, enrollment, heartbeat, readiness, control-plane state, and blockers. On Windows, the optional verification utility can also inspect the local evidence files:

```text
%LOCALAPPDATA%\Obserra\OwnerCommandCenter\endpoint-status.json
%LOCALAPPDATA%\Obserra\OwnerCommandCenter\installation-receipt.json
```

On macOS and Linux, the evidence directory is derived from the Electron application data directory. Verification must reconcile the enrolled device identity, application version, bootstrap profile, heartbeat, loopback response, and installation receipt.

## GitHub Academy evidence authorization

The installed Command Center can operate without a manually maintained local Academy repository. It can synchronize governed Academy production evidence from an approved GitHub Actions artifact.

In **Owner Connections**, authorize the **GitHub** connector with an owner-controlled fine-grained token for `jblan2026-hub/obserra-academy-production-studio`. The token must permit only the capabilities required by the approved workflow, including repository metadata read, Actions artifact read, and governed owner-decision submission where enabled.

The token is encrypted through operating-system-backed secure storage. It must not be written to the evidence cache, installation receipts, logs, approval record, or GitHub issue comment.

The Command Center must:

1. Verify that the token resolves to the required owner account.
2. Select a completed governed Academy workflow run with an unexpired production-evidence artifact.
3. Download the artifact through the GitHub API.
4. Verify the advertised SHA-256 digest when present.
5. Parse only allowlisted Academy evidence files.
6. Reject encrypted, oversized, unsupported, path-traversal, CRC-invalid, or malformed archive entries.
7. Write validated evidence to the protected local cache.
8. Recalculate the exact release-gate hash used by the owner-decision control.

## Owner approval workflow

The Owner Release Decision panel remains disabled until all of the following are true:

1. The Command Center endpoint is enrolled and endpoint-ready.
2. The release gate uses a supported schema.
3. Expected, discovered, staged, and course-record counts reconcile exactly.
4. Every course record is staged for owner approval.
5. The blocked-course count is zero.
6. The approved portfolio allocation is present in evidence: **20 application workers, 16 Academy workers, 36 total logical workers**.
7. Publication and checkout remain explicitly unauthorized.
8. No prior owner decision exists for the same exact gate hash.

The owner selects **Approve**, **Reject**, or **Return for revision** and enters the exact confirmation phrase shown by the Command Center. Reject and revise decisions require a substantive note.

An **Approve** decision records owner acceptance of the exact staged portfolio only. It does not publish courses, enable checkout, change pricing, grant learner access, or complete release execution. Those actions require a separate governed release process and post-release verification.

## Status definitions

`endpointReady=true` means the local process, generic bootstrap, device-specific encrypted identity, explicit enrollment, current heartbeat, and loopback readiness service are verified.

`controlPlaneOperational=true` means endpoint readiness is verified and an authoritative local or authenticated GitHub Academy evidence source is available for monitoring and owner decisions. It does not mean every course is complete.

`productionOperational=true` means the current production evidence has no active provider, checkpoint, worker, course, media, learner-catalog, release-gate, or evidence blockers.

`publicationLocked=true` means the Command Center is correctly preserving the separation among production, staging, owner approval, and release execution.

## Recovery

Use the encrypted recovery-bundle controls inside the Command Center to preserve connector configuration and authorized local state. Recovery bundles require a passphrase of at least 14 characters and use authenticated encryption. Restore operations recheck connector, endpoint, GitHub evidence, and gate state rather than treating stored data as current live evidence.

The endpoint identity is device-specific. Copying application files to another machine does not transfer enrollment or approval authority. The new machine must create its own encrypted identity and receive explicit owner enrollment.

## Revocation

Use **Owner device enrollment** to revoke the local endpoint. Revocation removes the enrolled state and disables owner-decision authority, but it does not silently uninstall the application or delete audit evidence. Re-enrollment requires explicit owner confirmation.

## Fail-closed conditions

The endpoint remains not ready when secure storage is unavailable, the embedded bootstrap is missing or invalid, endpoint enrollment is absent or revoked, the loopback service is unavailable, the heartbeat is stale, or receipt identities do not match.

The GitHub approval inbox remains blocked when the token is missing, belongs to another user, lacks required repository permissions, cannot retrieve the governed workflow artifact, fails artifact-integrity validation, or produces a gate that does not reconcile.

The owner decision remains blocked when any course is unstaged, any pre-owner blocker exists, the gate grants publication or checkout authority, the endpoint is not enrolled, or a decision has already been recorded for the exact gate hash.

Course production remains not operational when worker execution evidence is absent, the approved **20/16/36** portfolio allocation is not proven, provider preflight is not green, checkpoints are unavailable, course compliance staging is incomplete, media submission or mastering is incomplete, the protected learner catalog is not ready, or release evidence remains blocked.

## Distribution assurance

A production desktop release requires:

- current-head source, dependency, security, and packaging gates;
- SHA-256 manifests;
- Windows Authenticode signing for Windows production distribution;
- Apple signing and notarization for macOS production distribution;
- architecture-appropriate Linux package verification;
- clean-device installation, upgrade, uninstall, rollback, recovery, and revocation tests;
- direct owner acceptance of the exact release.

A successful package build is not a production-operational claim.
