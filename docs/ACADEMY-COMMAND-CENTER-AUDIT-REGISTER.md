# Obserra Academy Command Center Auditable Implementation Register

Status: Active implementation register
Owner: OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC
Scope: Academy Command Center reset, Academy website retrieval, payment-security controls, privacy boundaries, pricing alignment, owner review, publication, paid-access verification, and certificate retrieval.

## Purpose

This register is the repository source of truth for material Academy Command Center controls and implementation decisions. Each control or capability is tied to concrete source files and verification evidence. A feature is not considered production-ready merely because it is documented here. Production readiness requires the corresponding implementation and verification evidence to pass.

## Audit principles

1. Fail closed when identity, payment, publication, certificate, connector, or control state cannot be verified.
2. Minimize customer, learner, and payment data at every boundary.
3. Do not collect, store, process, render, or log primary card numbers, CVC, raw payment-method objects, provider secrets, session cookies, or unnecessary customer/student PII.
4. Use Stripe-hosted Checkout for card capture and server-side verification for fulfillment.
5. Require HTTPS for website and commerce connector traffic.
6. Preserve explicit owner authority for review, approval, and publication decisions.
7. Record technical evidence separately from compliance attestations. Engineering controls support compliance but do not constitute an external compliance determination.
8. Keep the active 61-course production worker checkout isolated from Command Center development and control-plane changes.

## Control and capability register

| ID | Control / Capability | Requirement | Implementation | Verification / Evidence | Status |
|---|---|---|---|---|---|
| ACC-001 | Owner endpoint enrollment | Privileged owner operations require enrolled endpoint and Windows credential protection. | `owner-command-center/electron/endpoint-enrollment.cjs` | `owner-command-center/scripts/verify-endpoint-enrollment.mjs` | Implemented |
| ACC-002 | Renderer privacy boundary | Remove secrets, authorization data, payment data, direct customer/student contact data, and sensitive references before renderer delivery. | `owner-command-center/electron/academy-data-protection.cjs`, `academy-course-control-resolver.cjs` | `verify-academy-data-protection.mjs`, `verify-payment-control-behavior.mjs` | Implemented |
| ACC-003 | Payment reference masking | Full Stripe and certificate references must not be displayed or persisted in owner-facing evidence unless explicitly required for a controlled runtime operation. | `academy-data-protection.cjs`, `academy-secure-purchase-verifier.cjs`, `academy-website-retrieval.cjs` | Behavioral privacy tests | Implemented |
| ACC-004 | Stripe-hosted card capture | Obserra must not host PAN/CVC collection fields. Card capture uses Stripe-hosted Checkout. | `policy/academy-payment-security.json`, `policy/academy-pci-dss-v4.0.1-profile.json` | `verify-payment-control-baseline.mjs`, `verify-payment-control-behavior.mjs` | Required / gated |
| ACC-005 | HTTPS payment and website retrieval | Commerce and website connector traffic must use HTTPS. HTTP payment/retrieval routes are blocked. | Payment security policies; `academy-website-retrieval.cjs` | Payment control baseline and behavioral tests | Implemented / gated |
| ACC-006 | Webhook and server-side fulfillment | Client success redirect is not proof of payment. Fulfillment requires server-side verification and idempotent entitlement handling. | Payment security policies and Academy website commerce implementation | Payment control verification plus live purchase verification | Required / gated |
| ACC-007 | Secure purchase verification | Accept canonical Stripe Checkout Session or PaymentIntent reference, verify Stripe state, course binding, Clerk entitlement, and commerce health. | `academy-secure-purchase-verifier.cjs` | `verify-live-academy-purchase.mjs`; real-purchase runtime validation | Implemented; live validation pending owner endpoint run |
| ACC-008 | Minimum necessary payment audit evidence | Purchase verification ledger retains masked reference, course, amount/currency, outcome, provider request IDs, and state only. Raw Stripe/Clerk customer payload persistence is prohibited. | `academy-secure-purchase-verifier.cjs` | Data-protection and behavioral tests | Implemented |
| ACC-009 | All Sales Are Final disclosure | Display before payment, require buyer acknowledgement, and repeat on confirmation/receipt where supported. Include exception for remedies required by applicable law. | `policy/academy-commerce-policy.json` | `verify-academy-commerce-policy.mjs` | Implemented as policy contract; website enforcement must remain gated |
| ACC-010 | Academy owner review lifecycle | Generated course moves through review, required-review decisions, release approval, explicit publication, and independent readback. | Academy course-control modules and reset UI | Academy course-control/review-dashboard verifiers | Implemented / reset in progress |
| ACC-011 | Optional review semantics | `required=false` reviews must not create false publication blockers. Required reviews remain mandatory. | Academy lifecycle control adapter/control logic | Review-dashboard/control tests | Implementation hardening in progress |
| ACC-012 | Website published-course retrieval | Command Center retrieves buyer-safe published course metadata from live Academy website over HTTPS. Protected learner content is not exposed through the public endpoint. | Website: `/api/academy/course/[courseId]`; Command Center: `academy-website-retrieval.cjs` | Connector behavioral tests and production route readback | Implemented; deployment/readback pending |
| ACC-013 | Website certificate retrieval/verification | Command Center retrieves verification-safe certificate evidence from website API by certificate ID. | Website: `/api/academy/certificate/verify?certificateId=...`; Command Center: `academy-website-retrieval.cjs` | Website certificate verification tests; Command Center connector tests | Implemented connector; UI/IPC integration in progress |
| ACC-014 | Certificate privacy | Public verification may expose only verification-necessary fields and must exclude assessment score and unnecessary learner data. | Website certificate verification route | `test/academy-certificate-verification.test.mjs` | Implemented |
| ACC-015 | Certificate verification resilience | Validate ID before lookup; rate limit by client/instance; bound concurrent lookups; fail closed if backing identity service is unavailable; no-store errors. | Website certificate verification route | Website certificate verification tests | Implemented |
| ACC-016 | Academy-only Command Center | Reset broad owner UI to a focused Academy review, approval, publication, paid-access, website retrieval, and certificate workflow. | `owner-command-center/src/index.html`, `academy-reset-ui.js`, reset CSS | Local review-dashboard verifier and Windows package validation | In progress |
| ACC-017 | Product pricing source of truth | Studio manifest/catalog and website must resolve to one price per course. Website fallback pricing cannot contradict governed Studio catalog. | Course manifests, Studio catalog generator, website Studio catalog merge, website `courseData.ts` fallback | Pricing consistency verifier to be added | In progress |
| ACC-018 | Market-aligned launch pricing | Pricing should remain within defensible market bands for non-certification self-paced professional training. Proposed launch tiers: Foundation $99; Professional $149; Advanced $199; Executive Intensive $249; CISO Masterclass $299. | Pricing policy/source manifests and website fallback | Market comparison record plus repository consistency test | Proposed; implementation pending final normalization |
| ACC-019 | Active production isolation | Command Center development must not stop, switch, or overlap the active 61-course generation checkout. | Separate branches/checkouts and local launcher architecture | Operator procedure and branch separation evidence | Implemented operational boundary |
| ACC-020 | Standard verification chain | Privacy, commerce policy, payment-control baseline, payment-control behavior, review/control, endpoint, and packaging verification run under standard Command Center verification. | `owner-command-center/package.json` | `npm run verify` | Implemented; CI evidence pending latest reset commit |

## Website connector contract

### Published course retrieval

`GET https://www.obserrallc.com/api/academy/course/<course-id>`

The response is intended for machine-readable owner verification of the published website course representation. It must return only public/buyer-safe data such as course identity, title, description, curriculum metadata, duration, price, public completion requirements, and release information. It must not expose generated protected learner content, assessment answers, instructor-only material, customer identities, learner progress, payment data, or credentials.

### Certificate verification retrieval

`GET https://www.obserrallc.com/api/academy/certificate/verify?certificateId=<certificate-id>`

The response must remain verification-focused. The current website route returns certificate validity, certificate identifier, learner display name, course identity/title, completion date, training hours, signer/issuer metadata, signature algorithm, and public key fingerprint. Assessment score is intentionally excluded from the public payload.

## Payment security control objectives

The Academy payment implementation is engineered to keep Obserra outside direct primary-card-data handling. Controls include HTTPS/TLS, HSTS, secure cookies, Stripe-hosted card capture, webhook signature verification, server-side payment validation, entitlement readback, idempotent fulfillment, encrypted owner secrets, redacted logs/evidence, minimum-necessary PII, dependency/supply-chain security checks, and fail-closed publication/payment behavior.

Formal PCI or other compliance validation is an external governance activity and is not asserted by this engineering register.

## Pricing governance

Pricing is a governed product attribute and must not be independently hardcoded across the Studio, website, Stripe, or Command Center. The intended sequence is:

1. Define the approved price in the governed course/product source of truth.
2. Generate the Academy public catalog from that source.
3. Synchronize the website Studio catalog from the approved catalog.
4. Resolve website presentation and Checkout creation from the synchronized price.
5. Verify Stripe price/session amount against the selected course before granting entitlement.
6. Block release when source/catalog/site/checkout prices disagree.

The current website fallback table is a resilience mechanism, not an independent pricing authority. Its values must match the approved tier policy and must not override synchronized Studio course pricing.

## Evidence expectations

For each production release retain, where applicable:

- Commit SHA and pull request.
- CI verification status and failing/passing job evidence.
- Windows packaging artifact hash.
- `npm run verify` result.
- Payment-control baseline and behavioral-test result.
- Website course-route and certificate-route readback result.
- Owner publication decision and independent publication readback.
- Live purchase verification result using masked transaction references only.
- Catalog/source/site price-consistency verification.
- Any exception or owner-approved deviation, including rationale, owner identity, timestamp, scope, expiration/review date, and rollback/remediation plan.

## Change-control rule

Any change that weakens a control in this register must be explicit, reviewable, tested, and recorded. Silent removal of a control, test, redaction rule, HTTPS restriction, server-side verification step, owner confirmation, or audit evidence requirement is prohibited.
