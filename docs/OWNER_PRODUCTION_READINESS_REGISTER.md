# Obserra Academy Owner Production Readiness and Truth Register

- **Document ID:** ACADEMY-OWNER-PROD-TRUTH-001
- **Status:** Controlled current-state record
- **Owner:** Obserra LLC Owner, Academy Product, Learning Engineering, Security, and Operations
- **Last updated:** 2026-08-07
- **Applies to:** Academy Production Studio, protected learner content, LCMS loading, owner review, publication, website ingestion, commerce, certificates, and Command Center monitoring

## Purpose

This record prevents authored source, catalog metadata, scripts, generated packages, automated tests, preview deployments, local packages, or partial course assets from being represented as learner-ready production courses. It also records the owner directive that Academy operations, review status, publication state, and production health must be visible through the owner-private Command Center without exposing protected learner content or credentials.

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
| Protected 60-course authoring pipeline | Blocked | PR 16, branch `agent/continue-course-buildout`, head `d927bb2cbb31d4407e5d0593ce87e67a506c92a0` | The protected audit stopped at the external AI provider capacity boundary with `credit_balance_exhausted`. |
| Studio validation | CI verified | Validate Academy Production Studio run 407 succeeded for the PR 16 head | Rerun after provider capacity is restored and protected packages are regenerated. |
| Studio authentication validation | CI verified | Studio Authentication Validation run 256 succeeded | Production identity and end-to-end learner authorization still require direct verification. |
| Owner Command Center packaging gates | CI verified for the PR 16 head | Fast Gate 192, 2000x Windows Gate 174, and Windows Package run 276 succeeded | These results do not establish hosted owner-private Command Center production. |
| Enterprise cross-project gates | CI verified for the PR 16 head | Enterprise Mega Release Gate 264, 40x Gate 252, and 50x Gate 252 succeeded | Re-execute after the blocked protected authoring and LCMS steps complete. |
| Protected Academy audit | Blocked | Protected audit run 59 failed at OpenAI HTTP 429 provider code `credit_balance_exhausted` | Restore approved API credits or quota for the organization associated with the GitHub `OPENAI_API_KEY`, then rerun from the exact source head. |
| AI-authored learner packages | Blocked | Six active workers stopped after attempt 1; the remaining 54 courses were not started | Generate all required packages under the current policy provenance and validate every course. |
| Protected learner catalog | Blocked | Downstream regeneration and validation were skipped after provider failure | Produce exactly 60 owner-review records and pass completeness, source, assessment, accessibility, completion, and certificate metadata gates. |
| LCMS PostgreSQL persistence | Blocked | Database bootstrap, Prisma validation, and LCMS load were skipped after provider failure | Verify the approved Academy database, schema, authentication, transaction behavior, backup, restore, and complete learner-content load. |
| Website Academy ingestion | Implemented in a separate website feature line | Website PR 46 accepts approved Studio catalog schemas while preserving a safe public baseline | Reconcile the approved Academy publication artifact with the website branch and verify production ingestion. |
| Public sales catalog | Operational baseline exists, not proof of protected learner readiness | Public catalog remains descriptive by design | Do not infer learner content, media, assessments, entitlements, or certificates from catalog presence. |
| Owner final review | Blocked | Owner-review bypass and review metadata exist in source | The exact staged learner experience must pass every pre-owner gate before submission. |
| Course publication | Blocked | Owner-review eligibility and publication approval are intentionally separate | Owner approval, release packaging, catalog synchronization, deployment, rollback, and direct production verification are required. |
| Command Center Academy monitoring | Designed or partially implemented in separate feature lines | Local connector and dashboard work exists | Implement governed production APIs and least-privilege service identities; never expose protected learner content, raw credentials, or assessment answers. |

## Provider capacity incident boundary

The protected audit failure is a real production-readiness blocker, not a transient green-state exception. The pipeline correctly classified provider credit exhaustion as non-retryable, stopped active workers, prevented wasteful retries, and skipped downstream persistence and publication operations. No document or dashboard may state that the 60 protected learner courses are generated, loaded, review-ready, or production-published until a later successful run proves those states.

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

Every material change to course source, provider policy, protected packages, learner catalog, database schema, LCMS loading, identity, entitlement, assessment, media, accessibility, commerce, publication, certificate, Command Center integration, recovery, or regulatory applicability must update this register and the affected standards, runbooks, release evidence, and owner-status records in the same governed change set.
