# Obserra High Availability Standard

This standard applies to the Obserra Academy Production Studio, LCMS, website integrations, publishing services, and Owner AI Command Center.

## Availability objectives

- No production capability may depend on a single application instance, single database instance, single queue worker, single deployment region, single secrets store, or single untested backup.
- Production services must support horizontal scaling, health-based routing, graceful degradation, idempotent retries, and documented recovery procedures.
- Target production service objective: 99.9% monthly availability initially, with architecture compatible with 99.95% or higher.
- Target recovery point objective: 15 minutes or less for operational data and 24 hours or less for reproducible generated assets.
- Target recovery time objective: 60 minutes or less for critical website, commerce, Academy, and LCMS capabilities.

## Required controls

### Application tier

- Minimum two stateless application instances in production.
- Health, readiness, and liveness endpoints.
- No in-memory-only source of truth.
- Rolling or blue-green deployments with automatic rollback.
- Circuit breakers, bounded retries with jitter, timeouts, bulkheads, and idempotency keys for external writes.

### Data tier

- Managed PostgreSQL with multi-zone high availability and automated failover.
- Point-in-time recovery, encrypted backups, restore testing, and cross-region backup copies.
- Connection pooling and migration controls that preserve backward compatibility during rolling deployments.
- Durable object storage for generated course packages, media, reports, and evidence.

### Queue and orchestration tier

- Durable queue with at-least-once delivery.
- Idempotent workers and dead-letter queues.
- Multiple workers across failure domains.
- Lease timeouts, retry limits, poison-message isolation, and resumable course-generation workflows.

### Identity, secrets, and integrations

- No single administrator credential or API token may be the only recovery path.
- Secrets must be stored in managed secret stores with rotation, versioning, and emergency recovery procedures.
- External connectors must support health checks, credential expiry monitoring, retry isolation, and degraded read-only operation.

### Observability

- Centralized logs, metrics, traces, synthetic checks, alerting, and immutable audit evidence.
- Owner alerts must distinguish component degradation from complete outage.
- Status calculations must use quorum or multiple independent signals where feasible.

## Owner AI Command Center exception

The primary Command Center remains local-only and owner-only. A single physical PC cannot provide true high availability. Therefore:

- The local application must maintain encrypted configuration backups and a recoverable offline cache.
- Loss of the Command Center must never interrupt the website, Academy, LCMS, commerce, publishing, or automation services.
- All production services continue autonomously when the Command Center is offline.
- An optional encrypted standby installation may be provisioned on a second owner-controlled Windows device. It remains disabled until activated by the owner and must not expose public ingress.
- The Command Center is an operational console, not a production dependency or control-plane single point of failure.

## Release gate

A release is not production-ready until its architecture, deployment configuration, dependencies, backups, failover behavior, monitoring, and rollback path have been reviewed against this standard.
