# Obserra Academy Command Center Auditable Implementation Register

Status: Active implementation register  
Owner: OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC  
Scope: Academy Command Center reset, website retrieval, payment security, privacy, pricing, review/publication, certificate integrity, credential encryption, storage encryption, immutable green paths, course identity, and course versioning.

## Authority and purpose

`policy/academy-command-center-control-manifest.json` is the machine-readable source of truth for the control inventory. This document is the human-readable audit record. The control table below is generated from the manifest by `owner-command-center/scripts/sync-control-documentation.mjs`. `npm run docs:check` fails if this committed document differs from what the manifest generates.

Production readiness requires implementation evidence and passing verification. Documentation alone does not establish a green control.

## Audit principles

1. Fail closed when identity, payment, publication, certificate, connector, encryption, or control state cannot be verified.
2. Minimize customer, learner, and payment data at every boundary.
3. Never collect, store, render, or log PAN, CVC, raw payment-method objects, credentials, passwords, session cookies, or unnecessary customer/student PII.
4. Use Stripe-hosted payment collection and server-side payment/entitlement verification.
5. Require HTTPS for website and commerce connector traffic.
6. Preserve explicit owner authority for approval, publication, exceptions, and green-path re-baselining.
7. Keep technical control evidence separate from external compliance attestations.
8. Keep active course-production workers isolated from Command Center development.
9. Freeze verified green paths by SHA-256 and fail on subsequent drift.
10. Protect `C:\ObserraAcademyProduction` with full-volume encryption while encrypting application secrets separately.
11. Use one canonical course identity across Studio, website, checkout, learner experience, and certificates.
12. Start current courses at semantic version `1.0.0`; future released changes require an explicit version increment rather than historical overwrite.

## Generated control register

<!-- AUTO-CONTROL-TABLE:START -->
| ID | Control / Capability | Implementation | Verification / Evidence | Status |
|---|---|---|---|---|
| ACC-001 | Owner endpoint enrollment | `owner-command-center/electron/endpoint-enrollment.cjs` | `owner-command-center/scripts/verify-endpoint-enrollment.mjs` | Required / gated |
| ACC-002 | Renderer privacy boundary | `owner-command-center/electron/academy-data-protection.cjs`, `owner-command-center/electron/academy-course-control-resolver.cjs` | `owner-command-center/scripts/verify-academy-data-protection.mjs`, `owner-command-center/scripts/verify-payment-control-behavior.mjs` | Required / gated |
| ACC-004 | Stripe-hosted payment security | `policy/academy-payment-security.json`, `policy/academy-pci-dss-v4.0.1-profile.json` | `owner-command-center/scripts/verify-payment-control-baseline.mjs`, `owner-command-center/scripts/verify-payment-control-behavior.mjs`, `owner-command-center/scripts/verify-academy-commerce-policy.mjs` | Required / gated |
| ACC-007 | Secure purchase verification | `owner-command-center/electron/academy-secure-purchase-verifier.cjs` | `owner-command-center/scripts/verify-live-academy-purchase.mjs` | Required / gated |
| ACC-009 | All Sales Are Final disclosure | `policy/academy-commerce-policy.json` | `owner-command-center/scripts/verify-academy-commerce-policy.mjs` | Required / gated |
| ACC-012 | Website published-course retrieval | `owner-command-center/electron/academy-website-retrieval.cjs`, `owner-command-center/electron/academy-website-retrieval-ipc.cjs`; External: `jblan2026-hub/obserra-website:app/api/academy/course/[courseId]/route.ts` | `owner-command-center/scripts/verify-academy-website-retrieval.mjs` | Required / gated |
| ACC-013 | Website certificate retrieval | `owner-command-center/electron/academy-website-retrieval.cjs`, `owner-command-center/electron/academy-website-retrieval-ipc.cjs`; External: `jblan2026-hub/obserra-website:app/api/academy/certificate/verify/route.ts` | `owner-command-center/scripts/verify-academy-website-retrieval.mjs` | Required / gated |
| ACC-016 | Academy-only Command Center | `owner-command-center/src/index.html`, `owner-command-center/src/academy-reset-ui.js`, `owner-command-center/src/academy-reset.css` | `owner-command-center/scripts/verify-local-academy-review-dashboard.mjs` | Required / gated |
| ACC-017 | Product pricing source of truth | `policy/academy-pricing-policy.json`, `studio/generate-catalog.mjs`; External: `jblan2026-hub/obserra-website:app/academy/courseData.ts` | External/governed dependency | website-parity-implemented-validation-pending |
| ACC-020 | Standard verification chain | `owner-command-center/package.json` | `owner-command-center/scripts/verify-payment-control-baseline.mjs`, `owner-command-center/scripts/verify-payment-control-behavior.mjs`, `owner-command-center/scripts/verify-credential-encryption-controls.mjs`, `owner-command-center/scripts/verify-academy-website-retrieval.mjs`, `owner-command-center/scripts/sync-control-documentation.mjs`, `owner-command-center/scripts/verify-control-manifest.mjs`, `owner-command-center/scripts/verify-green-path-locks.mjs` | Required / gated |
| ACC-021 | Immutable green-path baseline | `policy/academy-green-path-locks.json`, `owner-command-center/scripts/lock-green-path.mjs` | `owner-command-center/scripts/verify-green-path-locks.mjs` | enabled |
| ACC-022 | Credential, secret, and production-storage encryption | `policy/academy-credential-and-encryption-security.json`, `owner-command-center/electron/main.cjs`, `owner-command-center/electron/endpoint-enrollment.cjs`, `scripts/Test-ObserraAcademyStorageEncryption.ps1` | `owner-command-center/scripts/verify-credential-encryption-controls.mjs` | Required / gated |
| ACC-023 | Automatic control-documentation synchronization | `owner-command-center/scripts/sync-control-documentation.mjs`, `docs/ACADEMY-COMMAND-CENTER-AUDIT-REGISTER.md` | `owner-command-center/scripts/sync-control-documentation.mjs`, `owner-command-center/scripts/verify-control-manifest.mjs` | enabled |
| ACC-024 | Canonical course identity, versioning, and certificate alignment | `policy/academy-course-versioning.json`, `policy/academy-course-identity-and-certificate-naming.json`, `studio/initialize-course-versions.mjs`, `studio/verify-course-versioning.mjs`, `studio/generate-catalog.mjs`; External: `jblan2026-hub/obserra-website:lib/certificate-signing.ts; app/academy/certificate/[courseId]/page.tsx; app/api/academy/certificate/verify/route.ts; app/api/academy/checkout/route.ts` | `studio/verify-course-versioning.mjs` | implemented-validation-pending |
<!-- AUTO-CONTROL-TABLE:END -->

## Website connector contract

### Published course retrieval

`GET https://www.obserrallc.com/api/academy/course/<course-id>`

The endpoint may return only public/buyer-safe course identity and curriculum metadata. It must not expose protected learner content, assessment answers, instructor-only material, customer identities, learner progress, payment data, or credentials.

### Certificate verification retrieval

`GET https://www.obserrallc.com/api/academy/certificate/verify?certificateId=<certificate-id>`

The verification payload is limited to verification-necessary fields. Newly issued certificates bind canonical `courseId`, `courseTitle`, and `courseVersion` in the signed claim. Assessment scores remain excluded from the public API.

## Course identity and version governance

The stable machine identifier is the lowercase course slug. The human display title is the canonical title from the governed course manifest and does not contain the version. Version is a separate SemVer field displayed as `v1.0.0`, `v1.1.0`, and so forth.

All current Academy courses begin at `1.0.0`. A released course must not be silently overwritten. Material content changes require a new semantic version according to `policy/academy-course-versioning.json`. Newly signed certificates retain the title and version that existed when completion occurred, preserving historical integrity after later course revisions.

The canonical credential name is **Certificate of Course Completion**. The website certificate, public verification API, checkout metadata, catalog, and Command Center retrieval must agree on course ID, title, and version.

## Pricing governance

The governed launch tiers are Foundation $99, Professional $149, Advanced $199, Executive Intensive $249, and CISO Masterclass $299. Studio catalog generation is authoritative. The website fallback is resilience-only and must match those values. Checkout must use the governed course title, version, and resolved course price.

## Payment and credential security objectives

Obserra is engineered not to directly handle primary card data. Payment controls include HTTPS/TLS, HSTS, secure cookies, Stripe-hosted card capture, verified webhook/server-side payment evidence, idempotent entitlement handling, encrypted owner secrets, redacted evidence, minimum-necessary PII, and fail-closed behavior.

Passwords are not an Obserra application storage primitive. Plaintext passwords, reversible password encryption, and general-purpose SHA-256 password storage are prohibited. Application secrets are encrypted with Windows credential-backed protection. The production workspace requires BitLocker/full-volume protection. Recovery keys are never committed or captured in audit evidence.

## Green-path freeze rule

A control path becomes eligible to freeze only after its required tests are green. The lock record contains the protected file set, SHA-256 hashes, verifier/evidence reference, source commit, timestamp, and owner-approval reference. Verification recomputes hashes and fails on drift. Legitimate modification requires an explicit owner-approved re-baseline and new green verification evidence.

## Evidence expectations

For a production release retain, as applicable: commit SHA and PR; CI results; package hashes; `npm run verify`; payment/security test evidence; credential/encryption evidence; BitLocker protection status without recovery material; website course/certificate readback; owner publication decision; masked live-purchase verification; pricing parity evidence; version/title/certificate parity evidence; documentation drift result; and green-path lock records.

## Change-control rule

Silent weakening of a control is prohibited. Changes affecting security, identity, payment, pricing, publication, course naming/versioning, certificate claims, or a frozen path require reviewable repository changes and passing verification before release.
