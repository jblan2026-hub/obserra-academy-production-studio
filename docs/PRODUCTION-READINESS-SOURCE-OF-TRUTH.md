# Obserra Academy and Owner Command Center Production Readiness Source of Truth

**Document ID:** ACADEMY-PROD-SSOT-001  
**Status:** Active controlled status record  
**Owner:** Obserra Product Owner  
**Last updated:** 2026-08-07  
**Applies to:** Academy course production, protected learner catalog, LCMS loading, owner review, website publication, owner Command Center, Windows packaging, connectors, and production verification

## Truth rule

This record separates source completion, build validation, workflow validation, protected content generation, database persistence, website publication, learner operation, owner review, and production operation. No successful workflow may be used to imply that a course, Command Center, connector, database, learner experience, or installer is live or production operational without direct evidence for that exact state.

## Executive status

- **Academy course buildout:** BLOCKED.
- **Academy publication:** NOT AUTHORIZED.
- **Protected learner catalog:** NOT COMPLETE.
- **LCMS persistence:** NOT COMPLETED FOR THE CURRENT 60-COURSE BUILD.
- **Owner Command Center package:** BUILD-VALIDATED ON THE ACTIVE COURSE BRANCH, NOT CLOUD PRODUCTION.
- **Owner Command Center device auto-registration:** NOT IMPLEMENTED OR VERIFIED.

The active Academy buildout branch is `agent/continue-course-buildout`, tracked by pull request `#16`. Studio validation, Studio Authentication Validation, Owner Command Center fast and Windows gates, enterprise production gates, and the mega release gate completed successfully at the reviewed head. The separate protected Academy audit failed at the external AI-provider capacity boundary with provider code `credit_balance_exhausted`.

That failure is non-retryable under the implemented provider-failure contract. Six already-active authoring workers stopped after their first attempt. The remaining 54 courses were not started. Protected learner-catalog regeneration, learner-catalog validation, database bootstrap, Prisma validation, and LCMS loading were skipped. The 60-course learner system is therefore not complete and must not be submitted for owner final review or publication.

## Current workflow evidence

- Branch: `agent/continue-course-buildout`
- Pull request: `#16`
- Reviewed source head: `d927bb2cbb31d4407e5d0593ce87e67a506c92a0`
- Validate Academy Production Studio run `407`: success
- Studio Authentication Validation run `256`: success
- Owner Command Center Fast Gate run `192`: success
- Owner Command Center 2000x Windows Gate run `174`: success
- Build Owner Command Center Windows Package run `276`: success
- Obserra 40x Enterprise Production Gate run `252`: success
- Obserra 50x Enterprise Production Gate run `252`: success
- Obserra Enterprise Mega Release Gate run `264`: success
- Academy protected audit run `59`: failure at `credit_balance_exhausted`

Successful build and packaging workflows prove only the tested branch and artifact contracts. They do not prove live connectors, device registration, cloud deployment, production identity, database persistence, learner delivery, course approval, regulatory compliance, or owner acceptance.

## Course production state

The production pipeline now supports course-specific authoring standards, provenance, protected learner catalogs, lesson and assessment loading, owner-review bypass metadata, publication separation, provider-failure classification, and fail-closed database gates. These are implemented capabilities.

The current 60-course protected generation remains incomplete because provider capacity stopped the authoring workers. Required next steps are:

1. Restore approved OpenAI API capacity for the organization bound to the GitHub `OPENAI_API_KEY` secret.
2. Re-run protected authoring without weakening the non-retryable failure contract.
3. Generate and validate exactly 60 owner-review learner packages.
4. Create or verify the protected PostgreSQL LCMS database and authentication boundary.
5. Run database bootstrap, Prisma validation, and LCMS loading.
6. Verify lesson, assessment, progress, entitlement, certificate, audit, backup, restore, and rollback behavior.
7. Complete applicable SME, technical, legal, copyright, trademark, accessibility, AI-governance, commerce, privacy, security, and owner-precheck reviews.
8. Submit only directly reviewable learner packages to the owner review queue.
9. Keep publication disabled until explicit owner approval and final release evidence exist.

## PMP course state

The separate PMP branch and pull request `#15` contain the 35-hour architecture, 35 governed learner units, source and traceability records, AI tutor policy, production standards, final-review gate, and 60 drafted original assessment questions. It remains draft and unavailable for checkout.

Before owner final review, it still requires 120 additional original protected questions, controlled assessment review, final storyboards and assets, 32 mastered instructional videos with verified narration and audio, captions, transcripts, audio description or approved alternative, rights records, implemented learner workflows, all required pre-owner approvals, current-head CI, FINAL packaging, catalog, LCMS, deployment, and rollback validation.

## Owner Command Center state

The active Academy branch contains a local Windows owner Command Center with approved connector definitions, 15-second monitoring, Academy production actions, vulnerability scanning, security enforcement, trend storage, Windows encrypted credential handling, installer packaging, and recovery controls. The Windows package workflow passed on the reviewed branch.

The Command Center is still a local outbound-only application. It is not the private cloud Command Center required at `www.obserrallc.com`, and its local package does not currently implement a production device-enrollment protocol. A passing package workflow does not prove installed operation on the owner device, live connector authentication, cloud registration, revocation, update, uninstall, recovery, or production monitoring.

## Connector reconciliation

The older owner Command Center branch contains placeholder domains such as `studio.obserra.example`, `academy.obserra.example`, and the misspelled `www.obserrrallc.com`. Those values are prohibited from production.

The active course branch improves the defaults to `https://www.obserrallc.com` and adds an EIOS connector, but `https://obserra-eios-console.vercel.app` is not accepted as production evidence until the corresponding project, deployment, identity, backend, database, and health path are directly verified.

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
- security, privacy, accessibility, regulatory, and intellectual-property impact;
- rollback and recovery state; and
- the next governed action.
