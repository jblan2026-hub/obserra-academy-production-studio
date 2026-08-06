# Owner Command Center Resilience

The Obserra Owner AI Command Center is an owner-only local application and must never become a production dependency.

## Design requirements

- The website, Academy, LCMS, Studio workers, publishing automation, licensing, and commerce continue operating when the Command Center is closed, disconnected, damaged, or unavailable.
- The desktop application performs outbound-only connections. It opens no public listener and accepts no unsolicited remote control.
- Connector failures are isolated. One unavailable provider cannot freeze the application or prevent visibility into other providers.
- Every connector uses timeouts, bounded retries with jitter, circuit-breaker state, last-known-good data, and explicit stale-data timestamps.
- Local configuration and cached operational data are encrypted with Windows-backed encryption.
- Encrypted backups are exportable to an owner-controlled removable or protected location.
- Recovery documentation and integrity checks are required before packaging.

## Optional standby

True high availability cannot exist on one physical PC. An optional second owner-controlled Windows device may hold a disabled standby installation and encrypted recovery package. Activation requires an explicit owner action. The standby must preserve the same local-only, outbound-only security boundary and must not be internet-accessible.

## Failure behavior

- Production systems continue autonomously.
- The console enters read-only degraded mode when credentials or providers are unavailable.
- Cached data is labeled with collection time and age.
- Write actions are disabled unless the target system is healthy, the owner is authenticated, and an idempotency key is available.
- No automated destructive action is permitted without explicit owner approval and a rollback path.
