# Obserra Academy Paid Learner Delivery Backend

## Operating model

Approved course content is published to the learner backend before a course can be sold. A Stripe payment does not generate or copy course content. The successful payment grants a named Clerk user an entitlement to an already published release. The Website then uses its server-side entitlement check to request that release from the Studio delivery API.

This separation prevents checkout from depending on media generation, protects incomplete drafts from customers, and gives every purchaser the same governed release version.

## Published learner release contents

A paid learner release contains:

- Approved structured lesson content from `course-package.json`.
- One server-graded knowledge check for every lesson.
- The complete server-graded final assessment. Answer keys never leave the Studio API.
- An approved training video and caption track for every lesson.
- Learner guide and workbook materials.
- A governed certificate-of-course-completion template.
- A release manifest, immutable content hash, release version, inventory counts, and audit evidence.

The personalized certificate is issued only after all required lessons are complete and the learner earns the passing score. Purchase alone does not issue a certificate.

## Private storage

The Supabase migration creates three private buckets:

- `academy-videos`
- `academy-materials`
- `academy-certificates`

There are no anonymous or authenticated-user read policies. The delivery API uses the Supabase service role only on the server to generate short-lived signed URLs after the Website has authenticated the learner and confirmed the paid entitlement.

## Release gate

A production course is publishable only when all of the following are true:

1. `course-manifest.json` has `release.publishToAcademy: true`.
2. The release status is `approved` or `published`.
3. Every required subject-matter, technical, brand, accessibility, and applicable legal review is approved.
4. `generated/authoring/course-package.json` exists and has `reviewStatus: "approved"`, `"owner-approved"`, or `"final"`.
5. `approved-media.json` exists and has `status: "approved"`.
6. Every lesson has an approved video and approved captions.
7. The final assessment, learner guide, workbook, answer key, and certificate template exist.
8. The FINAL release content hash and inventory are complete.

Draft builds remain available for owner review, but `learnerDeliveryReady` remains false and the loader will ignore them.

## Approved media manifest

Create `courses/<course-id>/approved-media.json` after media review. Every binary object requires a stable storage key and SHA-256 checksum.

```json
{
  "schemaVersion": "1.0",
  "courseId": "zero-trust-strategy",
  "status": "approved",
  "approvedBy": "owner-user-id",
  "approvedAt": "2026-08-08T00:00:00.000Z",
  "assets": [
    {
      "moduleId": "decision-context-1",
      "kind": "video",
      "title": "Decision Context",
      "sourcePath": "generated/media/decision-context-1.mp4",
      "bucket": "academy-videos",
      "storageKey": "zero-trust-strategy/1.0.0/decision-context-1.mp4",
      "mimeType": "video/mp4",
      "checksumSha256": "replace-with-reviewed-file-sha256",
      "downloadable": false,
      "metadata": {
        "durationSeconds": 2280,
        "accessibilityReviewed": true
      }
    },
    {
      "moduleId": "decision-context-1",
      "kind": "captions",
      "title": "Decision Context Captions",
      "sourcePath": "generated/media/decision-context-1.vtt",
      "bucket": "academy-videos",
      "storageKey": "zero-trust-strategy/1.0.0/decision-context-1.vtt",
      "mimeType": "text/vtt",
      "checksumSha256": "replace-with-reviewed-file-sha256",
      "downloadable": false
    }
  ]
}
```

Repeat the video and captions pair for every lesson. Optional `transcript`, `slide-deck`, and `resource` entries use the same contract.

## Configuration

Configure these secrets in the Studio runtime:

```text
DATABASE_URL
STUDIO_OWNER_ORGANIZATION_ID or STUDIO_SEED_CLERK_ORG_ID
ACADEMY_DELIVERY_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ACADEMY_STORAGE_SIGNED_URL_TTL_SECONDS=900
```

Configure the same `ACADEMY_DELIVERY_TOKEN` in the Website server environment together with the Studio delivery base URL. Never expose either the delivery token or Supabase service-role key through a `NEXT_PUBLIC_` variable.

## Build, validate, and publish one course

```powershell
npm ci
npm run author:course -- --course zero-trust-strategy --provider openai
# Review and approve the authored package and all media.
npm run build:course -- --course zero-trust-strategy
npm run load:courses:check
npm run load:courses:upload
```

`load:courses:upload` uploads reviewed media and learner files, writes structured lessons and assessments to PostgreSQL, creates the published delivery record, and records an audit event. Running `load:courses` without `--upload-assets` verifies that every referenced private-storage object already exists before publication.

## Delivery API

All endpoints require `x-academy-delivery-token`. Learner operations also require `x-academy-learner-id` and a purpose-specific `x-academy-delivery-purpose` header.

- `GET /api/delivery/courses/<course-id>/readiness`
- `GET /api/delivery/courses/<course-id>`
- `POST /api/delivery/courses/<course-id>/check`
- `POST /api/delivery/courses/<course-id>/grade`

The readiness endpoint is intended for the Website checkout gate. The content endpoint returns only learner-safe content and signed private-asset URLs. Knowledge checks and the final assessment are graded inside the Studio, so correct answers are never shipped to browser JavaScript.

## Verification query

After publication, verify the inventory without reading proprietary content:

```sql
select
  course_slug,
  version,
  status,
  lesson_count,
  assessment_count,
  video_count,
  material_count,
  certificate_template_available,
  published_at
from public.academy_delivery_releases
order by course_slug;
```
