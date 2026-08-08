# Obserra Owner AI Command Center Installation and Recovery

## Standard installation

The normal owner installation does **not** require PowerShell, a terminal, a ZIP extraction command, or a machine-specific installer.

### Windows

1. Download the architecture-appropriate setup executable:
   - `Obserra-Owner-AI-Command-Center-Setup-<version>-x64.exe` for standard Intel/AMD Windows systems.
   - `Obserra-Owner-AI-Command-Center-Setup-<version>-arm64.exe` for Windows on ARM.
2. Double-click the setup executable.
3. Use the standard installation wizard to select the installation directory and user/machine mode allowed by policy.
4. Launch the Command Center from the installer, Start menu, or desktop shortcut.
5. In **Owner device enrollment**, select **Enroll this device** and enter the required confirmation phrase.

PowerShell scripts in a release bundle are optional enterprise-automation and evidence tools. They are not required for ordinary installation.

### macOS

1. Download the universal DMG.
2. Open the DMG and drag **Obserra Owner AI Command Center** to **Applications**.
3. Launch the application and complete explicit owner device enrollment.

A production macOS release must be signed and notarized before distribution. An unsigned CI artifact is a build-validation artifact, not a production installer.

### Linux

Use the package appropriate for the device architecture:

- AppImage for a self-contained desktop executable.
- DEB for Debian and Ubuntu package-managed installation.

Launch the application and complete explicit owner device enrollment. A Linux package must pass the current build, integrity, dependency, and runtime verification gates before production distribution.

## Portable operation

The optional Windows portable executable may be run without installation. Do not launch a portable executable from a folder that is being replaced or re-extracted; Windows will correctly lock the running executable and prevent deletion or overwrite. Close the portable application before replacing that folder.

Portable operation does not remove the requirements for owner authorization, operating-system-backed secure credential storage, explicit endpoint enrollment, local-only execution, connector verification, and audit evidence.

## Generic device enrollment

The distributed desktop package uses a generic wildcard bootstrap so the same verified installer can be used on any supported owner-controlled desktop. A wildcard package never silently enrolls a device. The owner must explicitly enroll each installation from the application.

Enrollment creates a device-specific identity using operating-system-backed secure storage, records the device and application version, starts local heartbeat evidence, and preserves a revocable endpoint record. Installation alone does not grant publication, pricing, deployment, purchasing, or production-change authority.

## Initial configuration

Configure only approved outbound connectors. Use HTTPS for remote systems. Plain HTTP is permitted only for loopback services such as a local AI runtime. Validate each connector in read-only mode before enabling an owner-approved control action.

## Integrity verification

Production downloads must be accompanied by a release checksum manifest and signing evidence. Do not install or execute a package if a file is missing, a checksum differs, the signer is unexpected, or the release channel cannot be verified.

## Recovery export

Export a recovery bundle after initial configuration and after any credential or connector change. Use a strong passphrase containing at least 14 characters. Store the encrypted bundle separately from the passphrase.

## Recovery import

Install the same or a later compatible verified release on the recovery device. Import the encrypted recovery bundle, explicitly enroll the recovery device, verify all connector endpoints, confirm that the application remains local-only, and keep write actions disabled until the owner approves them.

## Restore and rollback

Retain the previous verified release until the new release is proven. To roll back:

1. Close every installed and portable Command Center process.
2. Uninstall the current installed build when applicable.
3. Install the previous verified package using its normal graphical installer.
4. Import the matching prior recovery bundle.
5. Re-enroll or restore the approved device identity according to the recovery procedure.
6. Validate endpoint heartbeat, local readiness, connector health, and rollback evidence before resuming control actions.

## Loss or compromise

If a device, removable medium, installer, signing key, credential, or recovery bundle is lost or suspected to be compromised, revoke the endpoint, rotate affected connector credentials and tokens, invalidate the prior release inventory, and create a new encrypted recovery bundle.

The local desktop Command Center is distinct from the private cloud owner site. A desktop package must not be represented as the live `owner.obserrallc.com` service, and the private cloud owner site must not be embedded in the public website.
