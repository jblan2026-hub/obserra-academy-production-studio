# Academy Command Center Acceptance Contract

**Status:** Mandatory release contract  
**Owner:** Obserra Executive Protection & Intelligence, LLC  
**Applies to:** Every Academy course, every Command Center distribution, every website publication, and every purchase and entitlement workflow

## Non-negotiable objective

The Academy Command Center is not accepted unless the owner can see and control the complete governed course portfolio from one authoritative interface and every completed purchase results in independently verified learner access.

## Required course inventory

The Command Center must display every governed course without omission. Each course must expose:

- canonical course ID and title;
- department, level, track, duration, and price;
- protected package-generation state;
- required artifact completeness;
- every required review and its attributable decision;
- release version and release state;
- public-purchase state;
- publication or unpublication job state;
- GitHub commit and workflow evidence;
- Stripe purchase configuration;
- recent paid Checkout Sessions;
- Clerk entitlement readback;
- Academy commerce health;
- exact technical blocker and provider response when any requirement fails.

## Required owner controls

For every course, the owner must be able to:

1. generate or regenerate the protected package;
2. run AI revision through the governed Studio authoring workflow;
3. build or rebuild the release;
4. approve, reject, reset, or request changes for every required review;
5. submit the course for review;
6. approve the release;
7. publish the course for new public purchases;
8. unpublish the course from new public purchases;
9. retire the course;
10. restore the course to draft;
11. inspect publication evidence and provider failures;
12. list recent purchases for the course;
13. verify a specific purchase from Stripe payment through Clerk entitlement and Academy commerce health.

## Release-state contract

The only governed release states are:

```text
draft
in-review
approved
published
retired
```

A course must not be published unless all deterministic requirements pass. At minimum:

- the protected course package exists;
- the final release exists;
- required artifacts are present;
- every required review is approved;
- price and currency are valid;
- Stripe purchase configuration exists;
- the enrolled owner endpoint authorizes the action;
- the exact confirmation phrase is supplied.

## Publication verification contract

A local manifest update is not publication success. A GitHub request is not publication success. A workflow acknowledgement is not publication success.

The state `verified-success` is permitted only after:

1. GitHub accepts the exact manifest and catalog commit;
2. the publication workflow completes successfully;
3. the committed catalog is re-read from GitHub;
4. the expected course presence or absence is confirmed;
5. the deployed website course route is read back when publication is expected;
6. Academy commerce health is operational when publication is expected;
7. the evidence is retained in the owner ledger.

Any timeout, rejected request, failed workflow, catalog mismatch, website failure, or commerce failure must remain visible as a technical failure. No hardcoded success is permitted.

## Purchase-to-access verification contract

A checkout button, created Checkout Session, paid charge, webhook receipt, or local status update does not by itself prove learner access.

`verified-success` for a paid learner is permitted only when:

1. Stripe returns the requested Checkout Session through an authenticated API call;
2. Stripe reports `payment_status=paid`;
3. Stripe metadata contains the exact course ID;
4. Stripe metadata contains the bound Clerk user ID;
5. Clerk returns the exact user through an authenticated API call;
6. Clerk private metadata contains the exact course entitlement;
7. the entitlement `paymentReference` equals the paid Stripe Checkout Session ID;
8. Academy commerce health returns operational;
9. the complete result is retained in the owner ledger.

A paid guest purchase without a Clerk user binding must remain `paid-pending-account-claim`. It must not be represented as verified learner access.

## Unpublication and purchaser protection

Unpublishing or retiring a course must remove it from new public purchase availability. It must not delete, revoke, or disable entitlements that were already granted to existing purchasers. Existing learner progress, assessments, completion records, and certificates must remain intact unless a separately authorized legal, security, or fraud process requires otherwise.

## Error transparency

The Command Center must display the bounded raw provider response, HTTP status, request ID when available, provider name, operation, endpoint, timeout, and observed timestamp for failed GitHub, Stripe, Clerk, Website, or Academy requests.

## Auditability

Every review decision, release transition, publication action, publication verification, purchase verification, failure, and timeout must be recorded in the hash-chained owner course-control ledger with:

- actor and enrolled endpoint;
- course ID;
- action;
- prior state;
- resulting state;
- owner note;
- provider evidence;
- timestamp;
- previous ledger hash;
- current ledger hash.

## Release gate

A Command Center build must not be labeled complete, live, production ready, or owner accepted until:

- the complete source and packaging verification suite passes;
- an installable package is generated and hashed;
- the installed application launches on the enrolled owner endpoint;
- GitHub publication and unpublication are exercised with readback;
- one real paid authenticated purchase passes the complete Stripe-to-Clerk-to-Academy verification;
- one real paid guest purchase is correctly held as pending account claim;
- existing purchaser access is confirmed after unpublication;
- the owner accepts the exact build and evidence set.
