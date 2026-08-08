# Obserra Academy and Owner Command Center Production Readiness Source of Truth

**Document ID:** ACADEMY-PROD-SSOT-001  
**Status:** Active controlled status record  
**Owner:** Obserra Product Owner  
**Last updated:** 2026-08-08  
**Applies to:** Academy course production, protected learner catalog, LCMS loading, owner review, website publication, owner Command Center, Windows packaging, connectors, worker allocation, and production verification

## Truth rule

This record separates source completion, build validation, workflow validation, protected content generation, database persistence, website publication, learner operation, owner review, and production operation. No successful workflow may be used to imply that a course, Command Center, connector, database, learner experience, worker, or installer is live or production operational without direct evidence for that exact state.

## Authoritative worker allocation

The complete Obserra production portfolio is fixed at **36 logical workers**:

- **20 application workers** reserved for application development, maintenance, validation, release preparation, and operational support.
- **16 Academy course workers** reserved for protected course authoring, assessment production, package generation, validation, and LCMS preparation.

Cross-pool borrowing is disabled by default. The Academy authoring runtime may execute fewer than 16 concurrent processes when fewer courses require work or provider and runner capacity is lower, but it may not exceed the 16-worker course allocation. Changing the 20/16 split requires explicit owner approval and coordinated changes across the Website Application Production Pipeline, Academy Production Studio, and EIOS Worker Operations control plane.

## Executive status

- **Academy course buildout:** BLOCKED AT PROTECTED DATABASE AUTHENTICATION.
- **Academy publication:** NOT AUTHORIZED.
- **Protected learner catalog:** NOT COMPLETE.
- **LCMS persistence:** NOT COMPLETED FOR THE CURRENT 60-COURSE BUILD.
- **Course worker allocation:** 16 LOGICAL WORKERS CONFIGURED; 0 LAUNCHED IN THE LATEST BLOCKED AUDIT.
- **Application worker reservation:** 20 LOGICAL WORKERS RESERVED OUTSIDE THE ACADEMY PIPELINE.
- **Owner Command Center package:** BUILD-VALIDATED ON PRIOR REVIEWED HEADS, NOT CLOUD PRODUCTION.
- **Owner Command Center device auto-registration:** NOT PRODUCTION VERIFIED.

The active Academy buildout branch is `agent/continue-course-buildout`, tracked by pull request `#16`. The OpenAI provider preflight succeeded and verified authentication, routing, model access, and immediate request capacity. The latest protected Academy audit failed before checkpoint restoration and before authoring because Prisma rejected the protected PostgreSQL credentials. No course worker launched, no protected package was generated, and no LCMS load occurred.

## Current workflow evidence

- Branch: `agent/continue-course-buildout`
- Pull request: `#16`
- Provider preflight run `31228989224`: success
- Validate Academy Production Studio run `31228989248`: success
- Studio Authentication Validation run `31228989221`: success
- Owner Command Center Fast Gate run `31228989219`: success
- Owner Command Center 2000x Windows Gate run `31228989249`: success
- Build Owner Command Center Windows Package run `31228989251`: success
- Obserra 40x Enterprise Production Gate run `31228989227`: success
- Obserra 50x Enterprise Production Gate run `31228989255`: success
- Obserra Enterprise Mega Release Gate run `31228989228`: success
- Academy protected audit run `31228989220`: failure at protected PostgreSQL authentication

Successful build and packaging workflows prove only the tested branch and artifact contracts. They do not prove live connectors, device registration, cloud deployment, production identity, database persistence, learner delivery, course approval, regulatory compliance, or owner acceptance.

## Course production state

The production pipeline supports course-specific authoring standards, provenance, protected learner catalogs, lesson and assessment loading, owner-review bypass metadata, publication separation, provider-failure classification, resumable checkpoints, fail-closed database gates, and a maximum 16-worker course pool. These are implemented capabilities.

The current 60-course protected generation remains incomplete because database authentication stopped the workflow before checkpoint restoration and authoring. Required next steps are:

1. Correct or rotate the protected Academy PostgreSQL credential and update the protected `ACADEMY_DATABASE_URL` secret.
2. Re-run the protected workflow and verify authenticated schema and checkpoint-table bootstrap.
3. Restore matching protected authoring checkpoints.
4. Launch up to 16 governed course workers and generate exactly 60 owner-review learner packages.
5. Re-audit every restored and generated package under the current policy provenance.
6. Generate and validate the protected learner catalog.
7. Run Prisma validation and transactional LCMS loading.
8. Verify lesson, assessment, progress, entitlement, certificate, audit, backup, restore, and rollback behavior.
9. Complete applicable SME, technical, legal, copyright, trademark, accessibility, AI-governance, commerce, privacy, security, and owner-precheck reviews.
10. Keep publication disabled until explicit owner approval and final release evidence exist.

## PMP course state

The separate PMP workstream contains the 35-hour architecture, 35 governed learner units, source and traceability records, AI tutor policy, production standards, final-review gate, and 60 drafted original assessment questions. It remains draft and unavailable for checkout.

Before owner final review, it still requires 120 additional original protected questions, controlled assessment review, final storyboards and assets, 32 mastered instructional videos with verified narration and audio, captions, transcripts, audio description or approved alternatives, rights records, implemented learner workflows, all required pre-owner approvals, current-head CI, FINAL packaging, catalog, LCMS, deployment, and rollback validation.

## Owner Command Center state

The active Academy branch contains a local Windows owner Command Center with approved connector definitions, monitoring, Academy production actions, vulnerability scanning, security enforcement, trend storage, Windows encrypted credential handling, installer packaging, and recovery controls. Prior Windows package workflows passed on reviewed heads.

The Command Center is still not a verified production worker control plane. A logical worker allocation, workflow job, or provisioning record is not an authenticated operational worker. Operational status requires verified worker identity, heartbeat, assigned task, evidence, revocation, monitoring, and recovery.

## Connector reconciliation

Every production connector must have:

- an approved exact endpoint;
- TLS for non-loopback traffic;
- least-privilege credentials stored outside source;
- explicit owner authorization;
- health and capability verification;
- provenance and last-seen evidence;
- rate, retry, timeout, and failure controls;
- rotation and revocation;
- no placeholder or synthetic fallback in a live status view.

## Regulatory and assurance gates

Production publication and operation remain blocked until applicable controls and evidence are complete for:

- secure development and software supply chain;
- identity, MFA, session, RBAC, tenant and organization isolation;
- privacy, data classification, minimization, retention, rights, transfer, and incident handling;
- accessibility for learner, owner-review, and installer experiences;
- Stripe-hosted payment scope and PCI DSS applicability;
- intellectual-property, copyright, trademark, and licensing;
- AI provider, grounding, assessment integrity, learner isolation, and tutor lockout;
- backup, restore, rollback, disaster recovery, exit, and credential revocation;
- NIST CSF 2.0, NIST SSDF, ISO/IEC 27001, SOC 2, privacy, healthcare, financial-services, government, and customer-specific mappings where applicable.

Mappings and technical evidence describe alignment and implementation posture only. They do not establish certification, legal compliance, accreditation, authorization to operate, payment validation, audit opinion, or independent attestation.

## Mandatory owner update content

Each material change must update this record or its controlled successor in the same change set. Owner updates must state:

- what changed;
- what was directly verified;
- what remains unverified;
- active blockers;
- worker allocation and operational status;
- security, privacy, accessibility, regulatory, and intellectual-property impact;
- rollback and recovery state; and
- the next governed action.
