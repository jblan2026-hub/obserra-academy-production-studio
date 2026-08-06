# Obserra Owner AI Command Center

Current development status: active.

## Security boundary

- Local Windows owner workstation only.
- Loopback-only listener (`127.0.0.1`).
- No Vercel deployment target.
- No public ingress.
- Outbound authenticated connectors only.
- Secrets must be stored in Windows Credential Manager or an encrypted local secret store.

## Connected systems

- Obserra Academy Production Studio / LCMS
- Obserra website and Academy
- Stripe commerce and licensing
- Clerk identity and organization activity
- GitHub repositories and Actions
- Vercel deployments and health

## First operational slice

- System health summary
- Course inventory and generation state
- LCMS load state
- Learner and user activity summary
- Build and deployment status
- Commerce and licensing status
- Security and audit events

This package remains isolated from the public Studio application and must never be included in a cloud deployment artifact.
