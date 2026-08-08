# Obserra Academy and Owner Command Center Production Readiness Source of Truth

**Document ID:** ACADEMY-PROD-SSOT-001  
**Status:** Active controlled status record  
**Owner:** Obserra Product Owner  
**Last updated:** 2026-08-07  
**Applies to:** Academy course production, protected learner catalog, LCMS loading, owner review, website publication, owner Command Center, Windows packaging, connectors, and production verification

## Truth rule

This record separates source completion, build validation, workflow validation, protected content generation, database persistence, website publication, learner operation, owner review, and production operation. No successful workflow may be used to imply that a course, Command Center, connector, database, learner experience, or installer is live or production operational without direct evidence for that exact state.

## Executive status

- **Provider funding:** OWNER ACTION COMPLETED. BILLING CAPACITY SHOWN AS AVAILABLE. PROTECTED API USE STILL REQUIRES DIRECT WORKFLOW VERIFICATION.
- **Academy course buildout:** IN PROGRESS. PROTECTED AUTHORING RUN PENDING.
- **Academy publication:** NOT AUTHORIZED.
- **Protected learner catalog:** NOT COMPLETE.
- **LCMS persistence:** NOT COMPLETED FOR THE CURRENT 60-COURSE BUILD.
- **Owner Command Center package:** BUILD VALIDATED ON THE ACTIVE COURSE BRANCH, NOT CLOUD PRODUCTION.
- **Owner Command Center device auto-registration:** NOT IMPLEMENTED OR VERIFIED.

The unified Academy baseline is tracked by pull request `#22` on branch `agent/academy-production-integration`. Protected generation and reliability work is tracked by pull request `#16` on branch `agent/continue-course-buildout`, current source head `25788deb6a3627864eef62f87fdb77c9be88e5e6`. Pull request `#24` reconciles the reliability work into the unified integration branch and currently requires conflict resolution before merge.

The earlier protected Academy audit stopped at the external provider boundary with provider code `credit_balance_exhausted`. Owner supplied billing evidence on August 7, 2026 now shows an OpenAI Platform credit balance of **$88.64**, August usage of **$21.24 against a $100.00 limit**, **118,023 total tokens**, and **86 Responses and Chat Completions**. That evidence closes the owner-action funding prerequisite. It does not by itself prove that the GitHub API key is attached to the funded project or organization, that the selected model is available, that workflow secrets are correct, that authoring succeeds, or that downstream LCMS loading passes.

A new governed protected authoring audit, workflow run `106`, is pending for the current protected-generation head. Until that run produces direct provider preflight, authoring, catalog, database, and LCMS evidence, the historical quota failure remains part of the audit history but is no longer classified as an unresolved owner funding action.

## Current workflow evidence

- Protected generation branch: `agent/continue-course-buildout`
- Protected generation pull request: `#16`
- Reviewed protected-generation source head: `25788deb6a3627864eef62f87fdb77c9be88e5e6`
- Unified integration pull request: `#22`
- Reliability reconciliation pull request: `#24`, conflict resolution required
- Validate Academy Production Studio run `453`: success
- Studio Authentication Validation run `301`: success
- Owner Command Center Fast Gate run `237`: success
- Owner Command Center 2000x Windows Gate run `219`: success
- Build Owner Command Center Windows Package run `321`: success
- Obserra 40x Enterprise Production Gate run `297`: success
- Obserra 50x Enterprise Production Gate run `297`: success
- Obserra Enterprise Mega Release Gate run `309`: success
- Academy protected audit run `106`: pending

Successful build and packaging workflows prove only the tested branch and artifact contracts. They do not prove live connectors, device registration, cloud deployment, production identity, database persistence, learner delivery, course approval, regulatory compliance, or owner acceptance.

## Provider capacity correction

The previous status phrase **Owner action required** for API credits is retired. The correct current states are:

1. **Owner funding action:** completed and supported by owner-provided billing evidence.
2. **Provider account capacity:** shown as available in the billing interface.
3. **GitHub secret and project routing:** not yet directly verified by the pending protected workflow.
4. **Protected authoring:** pending direct execution evidence.
5. **Course readiness and publication:** still blocked by content, media, review, database, entitlement, and release gates.

No automated provider purchase or unrestricted spending authority is enabled. Any future credit automation must use owner-approved budgets, thresholds, audit records, and hard spending caps.

## Course production state

The production pipeline supports course-specific authoring standards, provenance, protected learner catalogs, lesson and assessment loading, owner-review bypass metadata, publication separation, provider-failure classification, provider preflight, resumable checkpoints, and fail-closed database gates. These are implemented source capabilities.

Required next steps are:

1. Allow protected audit run `106` to begin and verify provider preflight against the funded account.
2. Resume or generate exactly 60 governed owner-review learner packages without weakening the non-retryable failure contract.
3. Validate the protected learner catalog and all course-specific readiness requirements.
4. Create or verify the protected PostgreSQL LCMS database and authentication boundary.
5. Run database bootstrap, Prisma validation, and LCMS loading.
6. Verify lesson, assessment, progress, entitlement, certificate, audit, backup, restore, and rollback behavior.
7. Complete applicable SME, technical, legal, copyright, trademark, accessibility, AI-governance, commerce, privacy, security, and owner-precheck reviews.
8. Submit only directly reviewable learner packages to the owner review queue.
9. Keep publication disabled until explicit owner approval and final release evidence exist.

## PMP course state

The PMP course work contains the 35-hour architecture, 35 governed learner units, source and traceability records, AI tutor policy, production standards, and final-review controls. It remains draft and unavailable for checkout.

Before owner final review, it still requires completion of the protected assessment bank, controlled assessment review, final storyboards and visual assets, mastered instructional videos with verified narration and audio, captions, transcripts, audio description or approved alternative, rights records, implemented learner workflows, required pre-owner approvals, current-head CI, final packaging, catalog, LCMS, deployment, and rollback validation.

## Owner Command Center state

The active Academy branch contains a local Windows owner Command Center with approved connector definitions, monitoring, Academy production actions, vulnerability scanning, security enforcement, trend storage, Windows encrypted credential handling, installer packaging, and recovery controls. The current fast gate, 2000x Windows gate, and Windows package workflow are green on the reviewed protected-generation head.

The Command Center remains a local outbound-only application in this repository. It is not the separate private cloud owner site targeted at `owner.obserrallc.com`, and its local package does not currently prove production device enrollment, live connector authentication, cloud registration, revocation, update, uninstall, recovery, or production monitoring.

## Connector reconciliation

Placeholder domains, misspelled domains, synthetic live states, and unverified deployment aliases are prohibited from production.

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
