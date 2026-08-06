# Obserra Owner AI Command Center Installation and Recovery

## Installation

Use only an owner-controlled Windows device. Verify the SHA-256 manifest before running the installer. Launch `Install-Obserra-Command-Center.ps1` from the removable-media package or run the signed NSIS executable directly. The installer is per-user and does not require administrator rights by default.

## Portable operation

The portable executable may be run from encrypted removable media or copied to an owner-controlled device. Portable operation does not remove the requirement for Windows-backed credential encryption, owner authorization, and local-only execution.

## Initial configuration

Configure only approved outbound connectors. Use HTTPS for remote systems. Plain HTTP is permitted only for loopback services such as a local AI runtime. Validate every connector in read-only mode before enabling an owner-approved control action.

## Recovery export

Export a recovery bundle after initial configuration and after any credential or connector change. Use a strong passphrase containing at least 14 characters. Store the encrypted bundle separately from the passphrase.

## Recovery import

Install the same or a later compatible verified release on the recovery device. Import the encrypted recovery bundle, verify all connector endpoints, confirm that the application remains local-only, and keep write actions disabled until the owner explicitly approves them.

## Integrity verification

Compare every packaged file against `SHA256SUMS.json` or `SHA256SUMS.txt`. Do not install or execute the package if a file is missing or a hash differs.

## Restore and rollback

Retain the previous verified release until the new release is proven. To roll back, close the application, uninstall the current installed build when applicable, restore the previous package, import the matching prior recovery bundle, and validate system and connector health before resuming use.

## Loss or compromise

If removable media, a workstation, or a recovery bundle is lost or suspected to be compromised, rotate all connector credentials, revoke active tokens, create a new encrypted recovery bundle, and invalidate the prior package inventory.

This owner application is not a public website or cloud service and must never be deployed to Vercel or exposed through public ingress.