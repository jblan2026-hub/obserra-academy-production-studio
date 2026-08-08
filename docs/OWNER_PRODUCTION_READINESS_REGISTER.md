# Obserra Academy Owner Production Readiness and Truth Register

- **Document ID:** ACADEMY-OWNER-PROD-TRUTH-001
- **Status:** Controlled current-state record
- **Owner:** Obserra LLC Owner, Academy Product, Learning Engineering, Security, and Operations
- **Last updated:** 2026-08-08
- **Applies to:** Academy Production Studio, protected learner content, LCMS loading, owner review, publication, website ingestion, commerce, certificates, Command Center monitoring, and worker allocation

## Purpose

This record prevents authored source, catalog metadata, scripts, generated packages, automated tests, preview deployments, local packages, worker records, or partial course assets from being represented as learner-ready production courses. It also records the owner directive that Academy operations, review status, publication state, worker activity, and production health must be visible through the owner-private Command Center without exposing protected learner content or credentials.

## Authoritative worker allocation

The portfolio contains **36 logical workers total**:

| Worker pool | Allocation | Authorized scope |
|---|---:|---|
| Application production | 20 | Application development, maintenance, validation, release preparation, and operational support |
| Academy course production | 16 | Course authoring, assessments, protected package generation, validation, and LCMS preparation |
| Total | 36 | Fixed portfolio ceiling |

Cross-pool borrowing is disabled by default. Actual simultaneous execution may be lower because of provider, runner, database, or workload constraints. No workflow may exceed its assigned pool without an explicit owner-approved allocation change.

## Mandatory status vocabulary

Academy status reports must use only these evidence-bound states:

| State | Meaning |
|---|---|
| **Designed** | Curriculum, architecture, policy, or workflow is specified. |
| **Authored** | Controlled source content exists but has not passed all learner-production gates. |
| **CI verified** | The named commit passed the stated automated gates. |
| **Owner-review eligible** | The exact staged learner experience passed every pre-owner gate and is available to the owner without purchase. |
| **Owner approved** | The owner approved the exact staged release; publication has not necessarily occurred. |
| **Production published and verified** | The exact approved release is deployed, entitled, purchasable where applicable, and directly tested in production. |
| **Blocked** | A required content, provider, database, media, review, security, commerce, identity, regulatory, or operational prerequisite is unmet. |

`Complete`, `published`, `live`, `approved`, `certificate eligible`, and `production ready` must not be used outside these definitions.

## Current verified state

| Capability | Current state | Evidence boundary | Blocker or next gate |
|---|---|---|---|
| Protected 60-course authoring pipeline | Blocked | PR 16, branch `agent/continue-course-buildout` | Protected PostgreSQL authentication failed before checkpoint restoration and authoring. |
| Course worker allocation | Configured, not operational | 16-worker maximum encoded in workflow and parallel authoring runtime | Rerun after database authentication is corrected; 0 workers launched in the latest blocked run. |
| Application worker reservation | Governed allocation | 20 workers reserved in the Website Application Production Pipeline | Application validation must rerun on its revised 20-worker matrix. |
| OpenAI provider preflight | CI verified | Run `31228989224` completed a minimal `gpt-5` request with HTTP 200 | Does not prove sufficient remaining capacity for all 60 courses. |
| Studio validation | CI verified | Run `31228989248` succeeded | Rerun after protected packages are regenerated. |
| Studio authentication validation | CI verified | Run `31228989221` succeeded | Production identity and learner authorization still require direct verification. |
| Owner Command Center packaging gates | CI verified on prior reviewed head | Fast Gate `31228989219`, 2000x Windows Gate `31228989249`, Windows Package `31228989251` | Does not establish hosted owner-private Command Center production. |
| Enterprise cross-project gates | CI verified on prior reviewed head | Mega Release `31228989228`, 40x `31228989227`, 50x `31228989255` | Re-execute after protected authoring and LCMS steps complete. |
| Protected Academy audit | Blocked | Run `31228989220` failed before authoring | Correct or rotate the protected Academy PostgreSQL credential and rerun. |
| AI-authored learner packages | Blocked | No worker launched in the latest audit | Restore checkpoints, then generate and validate all required packages using up to 16 course workers. |
| Protected learner catalog | Blocked | Downstream regeneration and validation were skipped | Produce exactly 60 owner-review records and pass completeness, source, assessment, accessibility, completion, and certificate metadata gates. |
| LCMS PostgreSQL persistence | Blocked | Schema bootstrap and LCMS load did not complete | Verify authentication, schema, transaction behavior, backup, restore, and complete learner-content load. |
| Website Academy ingestion | Implemented in a separate website feature line | Website accepts approved Studio catalog schemas while preserving a safe public baseline | Reconcile an approved Academy publication artifact and verify production ingestion. |
| Owner final review | Blocked | Owner-review bypass and review metadata exist in source | The exact staged learner experience must pass every pre-owner gate before submission. |
| Course publication | Blocked | Owner-review eligibility and publication approval remain separate | Owner approval, release packaging, catalog synchronization, deployment, rollback, and direct production verification are required. |

## Worker truth boundary

A configured concurrency value is not an active worker. A GitHub Actions job is not a persistent production worker. A worker becomes operational only after its identity, authorization, heartbeat, assigned task, output evidence, failure handling, revocation, and recovery are verified.

The 16 course-worker allocation is a maximum governed authoring pool. The runtime creates only as many processes as there are eligible courses, up to 16. If the database, provider, or policy gate fails, the workers must not launch.

## Owner-review acceptance gate

A course is owner-review eligible only when the exact learner-facing package includes and verifies, as applicable:

1. Approved course specification, duration, lessons, outcomes, prerequisites, and completion rules.
2. Source-grounded instructional content with current observation dates and limitations.
3. Instructor manuscript, learner guide, workbook, business artifacts, and downloadable materials.
4. Original knowledge checks and final assessments with objective mappings, answers, rationales, distractor explanations, difficulty, cognitive level, sources, and originality attestation.
5. Entitlement-scoped AI tutor with source grounding, learner isolation, assessment lockout, privacy, audit, and safety controls.
6. Final media, audible professional audio, captions, transcripts, audio description where required, reduced-motion alternatives, rights records, and accessibility verification.
7. Implemented learner identity, entitlement, progress, persistence, assessment, break, scoring, remediation, completion, and certificate workflows.
8. Subject matter, factual, legal, regulatory, copyright, trademark, psychometric, brand, accessibility, AI-governance, media, commerce, entitlement, privacy, and security approvals appropriate to the course.
9. Staged deployment evidence, rollback evidence, and owner-review access that does not require a purchase.
10. A release candidate hash binding the reviewed course source, protected package, media, catalog record, database load, and learner application build.

Owner approval applies only to the exact release candidate presented. Any material change after approval requires a new controlled review.

## Production publication and verification gate

A course may be reported as production published and verified only after:

1. The owner approved the exact release candidate.
2. The protected learner package was loaded transactionally into the approved LCMS database.
3. The approved public catalog record synchronized through the governed website workflow.
4. Production identity, course entitlement, Stripe purchase or authorized owner bypass, learner isolation, progress, assessments, completion, certificate issuance, and revocation paths passed direct tests.
5. Protected content remained non-public and non-indexable.
6. Website, Academy, LCMS, provider, webhook, and certificate failure paths failed closed without corrupting learner state.
7. Production logs showed no unresolved high-severity error clusters for the release paths.
8. Backup, restore, rollback, and course withdrawal were exercised or otherwise satisfied by the approved release gate.

## Command Center integration contract

The owner-private Command Center may consume only governed, minimum-necessary Academy projections, including:

- portfolio allocation of 36 workers, with 20 application and 16 course workers;
- active, queued, blocked, completed, and failed worker counts by pool;
- service and database health;
- course count by controlled status;
- generation, validation, review, and publication state;
- source freshness and policy provenance;
- LCMS load and migration state;
- learner activity aggregates that respect privacy and tenant boundaries;
- commerce and entitlement health;
- certificate issuance and revocation counts;
- failed jobs, stale packages, blocked reviews, and required owner decisions.

It must not retrieve raw learner passwords, provider credentials, payment data, unrestricted personal data, protected assessment answers, confidential course packages, or content for which the owner session lacks explicit authorization. Every connector request must be authenticated, tenant scoped, attributable, rate bounded, auditable, and revocable.

## Regulatory and assurance boundary

Course mappings to laws, regulations, standards, professional guidance, certification outlines, and frameworks are instructional and governance evidence. They do not establish legal compliance, official endorsement, certification-owner authorization, accreditation, exam eligibility, exam success, credential issuance by a third party, or professional outcome. Required disclaimers, intellectual-property limits, source licenses, accessibility duties, privacy controls, commerce obligations, records retention, and certificate representations must be evaluated for each release.

## Documentation reconciliation rule

Every material change to worker allocation, course source, provider policy, protected packages, learner catalog, database schema, LCMS loading, identity, entitlement, assessment, media, accessibility, commerce, publication, certificate, Command Center integration, recovery, or regulatory applicability must update this register and the affected standards, runbooks, release evidence, and owner-status records in the same governed change set.
