# External AI Media Production

## Purpose

The Studio uses provider-neutral adapters to submit course lesson scripts for external AI video production. Synthesia and HeyGen are the first supported providers. Generated media remains outside the approved FINAL release until required review gates are complete.

## Configuration

Copy `.env.example` to `.env` and provide credentials for the selected provider. Never commit credentials or downloaded media.

## Generate a course video batch

```powershell
npm run media:course -- --course cybersecurity-foundations --provider synthesia
```

or

```powershell
npm run media:course -- --course cybersecurity-foundations --provider heygen
```

The command reads the course manifest and instructor manuscript, submits one job for each non-assessment module, and writes auditable job records under:

`courses/<course-id>/generated/video-jobs`

## Review requirements

Before video assets are moved into a FINAL release, reviewers must verify:

- Technical accuracy
- Instructional alignment
- Narration quality and pronunciation
- Visual consistency with Obserra branding
- Caption and transcript accuracy
- Accessibility
- Proper use of any licensed assets
- Absence of unsupported certification, regulatory, or legal claims

## Provider independence

The Studio contract isolates provider-specific APIs. New providers can be added under `studio/providers` without changing course manifests, release rules, or Academy catalog generation.
