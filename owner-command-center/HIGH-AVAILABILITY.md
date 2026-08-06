# Obserra Owner AI Command Center High Availability Standard

The Owner AI Command Center is a local-only application and must remain available without introducing a public service or a single point of failure.

## Availability model

The primary owner workstation runs the active instance. One or more standby owner-authorized Windows devices may hold the same installer package and an encrypted recovery bundle. Standby devices remain offline or read-only until explicitly activated by the owner.

## Recovery requirements

1. Keep the verified installer, portable executable, installation launcher, SHA-256 manifests, and recovery documentation together on encrypted removable media.
2. Export an encrypted recovery bundle after connector or credential changes.
3. Store at least two recovery copies in separate owner-controlled locations.
4. Validate the recovery package and hashes after every release.
5. Test restoration on a standby device before retiring the prior release.

## Failover

If the primary workstation is unavailable, the owner may install or run the portable package on an authorized standby device, import the encrypted recovery bundle, verify connector health, and activate the standby instance. Write capabilities remain disabled until owner approval is re-established on the standby device.

## Rollback

Retain the prior verified release package and recovery bundle until the new release has passed installation, connector, integrity, and operational checks. Rollback consists of uninstalling the current build, reinstalling the prior verified build, importing the prior encrypted recovery bundle, and confirming read-only connector health before enabling any approved control action.

## Security constraints

The application must never expose public ingress. It must use packaged local files, deny renderer permissions and navigation, store secrets with Windows-backed encryption, and use outbound authenticated connectors only. High availability must not weaken the local-only security boundary.