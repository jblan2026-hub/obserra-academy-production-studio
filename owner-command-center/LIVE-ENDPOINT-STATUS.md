# Owner Command Center Live Endpoint Status

**Document ID:** OCC ENDPOINT STATUS 001  
**Status:** Active controlled status record  
**Workstream:** Separate parallel Owner Command Center deployment  
**Source branch:** `agent/command-center-live-endpoint`  
**Pull request:** `#29`  
**Target baseline:** `agent/academy-production-integration`

## Truth rule

Source completion, verification workflow success, Windows package creation, artifact availability, endpoint installation, endpoint enrollment, connector authentication, Academy control plane operation, and course publication are separate states. No earlier state may be represented as a later state without direct evidence.

## Current source state

The branch contains the following implemented controls:

1. Windows protected device identity and device fingerprint generation.
2. Target bound bootstrap promotion and hostname validation.
3. Explicit endpoint enrollment, persistent revocation, and deliberate reenrollment.
4. A read only health and readiness service bound only to `127.0.0.1`.
5. Fresh endpoint heartbeat and installation receipts under local application data.
6. A single instance process lock to prevent duplicate endpoint processes and conflicting health services.
7. An authoritative Academy production evidence reader for the 36 worker course surge.
8. Separate `endpointReady` and `controlPlaneOperational` states.
9. A visible owner dashboard for endpoint readiness, worker allocation, course staging, provider, checkpoint, media, learner catalog, and publication blockers.
10. A target installer and direct endpoint verifier that require matching identity, enrollment, heartbeat, installation receipt, and loopback readiness evidence.
11. One click and portable Windows packaging with SHA 256 release inventories.
12. A dedicated Command Center Live Endpoint GitHub Actions gate.

## Current verified state

- Source branch created: verified.
- Pull request created and mergeable with the current integration baseline: verified.
- Actual workflow results for the latest head: not yet recorded in this status document.
- Windows release artifact for the latest head: not yet recorded in this status document.
- Command Center installed on the owner endpoint: not verified.
- Endpoint enrollment receipt from the owner endpoint: not verified.
- Loopback readiness response from the owner endpoint: not verified.
- Live production connector authentication: not verified.
- Academy 36 worker operational evidence on the endpoint: not verified.
- Course publication authority: not granted.

## Required promotion sequence

1. Pass the endpoint contract job on the current source head.
2. Pass the Windows package and release media job on the current source head.
3. Reconcile the Command Center branch with the current Academy course production branch without weakening either contract.
4. Download the exact successful Windows release artifact.
5. Run `Install-Obserra-Command-Center.ps1` on the intended Windows endpoint.
6. Verify the target hostname, Windows protected storage, device identity, endpoint enrollment, heartbeat freshness, installation receipt, and loopback readiness response.
7. Record the resulting device ID, device fingerprint, application version, receipt locations, and verification time without recording secrets.
8. Configure each approved connector with least privilege credentials through Windows protected storage.
9. Verify connector health and control capability individually.
10. Verify Academy production evidence, database state, worker execution, compliance staging, learner catalog, media state, and publication locking.
11. Keep course publication and checkout disabled until the separate course release gates and owner acceptance pass.

## Active blockers

The Command Center cannot be represented as live on the owner endpoint until the exact package is installed there and produces direct endpoint evidence. The Academy control plane cannot be represented as operational until the course production workstream emits matching authoritative evidence with no active blockers.

## Recovery and rollback

The release media includes the installer, portable executable, endpoint verifier, recovery guide, high availability guide, operations guide, target bootstrap, and SHA 256 manifests. Endpoint revocation remains available independently of uninstall. The application preserves evidence and does not silently delete local identity or audit records during uninstall.
