# Obserra Academy Production Studio

Production system for authoring, validating, packaging, approving, and publishing original Obserra Academy courses.

## Purpose

This repository is the authoritative production source for commercial Academy courses. It is separate from the public marketing website so instructional content, assessments, release artifacts, and review evidence can be governed independently.

## Commercial model

Academy courses use a one-time payment entitlement. Paid access remains active until the learner completes the course. Completion produces a durable transcript and certificate record. Courses do not use recurring SaaS subscriptions.

## Repository layout

- `studio/` production engine and CLI
- `schemas/` manifest and release schemas
- `courses/` source course projects
- `releases/` approved FINAL course releases
- `catalog/` generated Academy publishing catalog
- `templates/` reusable course-authoring templates
- `docs/` architecture, governance, and publishing documentation
- `.github/workflows/` validation and release automation

## Quick start

```powershell
npm install
npm run validate
npm run build:course -- --course cybersecurity-foundations
npm run catalog
```

## Course lifecycle

1. Create or update a course project under `courses/<course-id>`.
2. Validate the course manifest and required production assets.
3. Build the review-ready course package.
4. Complete SME, technical, legal, accessibility, and brand reviews as applicable.
5. Approve the release.
6. Publish to `releases/<course-id>/FINAL`.
7. Generate `catalog/academy-course-catalog.json`.
8. The public Academy imports the approved catalog and creates the course page, checkout path, learner entitlement, and completion workflow.

## Governance

No course is published merely because a draft exists. Publication requires an approved manifest, evidence of required reviews, and a valid FINAL release package.
