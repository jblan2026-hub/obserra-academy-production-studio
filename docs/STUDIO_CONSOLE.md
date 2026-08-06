# Obserra Academy Studio Console

**OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC**  
**OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.**

## Access

After the Studio pull request is merged into `main`:

1. Open the `obserra-academy-production-studio` repository.
2. Select **Actions**.
3. Select **Obserra Academy Studio Console**.
4. Select **Run workflow**.
5. Choose the operation, enter a course ID when required, and run the job.

The Console is restricted by GitHub repository permissions. Only users with sufficient repository access can start a workflow or commit generated content.

## Available operations

### sync_website_catalog

Reads the current Academy course offerings from `jblan2026-hub/obserra-website/app/academy/courseData.ts`, imports missing course projects, generates draft assets, validates manifests, and refreshes the Studio catalog.

### build_all_drafts

Generates or preserves draft manuscripts, learner guides, workbooks, assessment banks, answer keys, and visual briefs for every imported course.

### validate_all

Runs manifest and publication-catalog validation without producing a release.

### generate_course_media

Submits branded lesson-video jobs for one course through Synthesia or HeyGen. The course ID and provider must be selected. Generated jobs remain draft assets and retain the proprietary classification.

### build_course_release

Builds a FINAL release package for one course. The workflow fails closed unless:

- Release status is `approved` or `published`.
- `publishToAcademy` is `true`.
- Every required human review is approved.
- Source grounding passes when an AI-authored package exists.
- Manifest validation passes.

### publish_approved_catalog

Generates the Academy publication catalog containing only approved or published courses.

## Required repository secrets

Configure under **Settings > Secrets and variables > Actions**:

- `ACADEMY_STUDIO_TOKEN`
- `SYNTHESIA_API_KEY`
- `SYNTHESIA_TEMPLATE_ID`
- `HEYGEN_API_KEY`
- `HEYGEN_AVATAR_ID`
- `HEYGEN_VOICE_ID`

Only the provider selected for a run requires its provider secrets.

Optional repository variable:

- `SYNTHESIA_TEST_MODE`, set to `true` until production video templates are validated.

## Recommended operating sequence

1. Run `sync_website_catalog` whenever website offerings change.
2. Run `build_all_drafts` to generate the first production drafts.
3. Complete AI authoring, source grounding, expert reviews, accessibility review, brand review, and media production.
4. Update the course manifest review statuses only after named reviewers approve the course.
5. Run `build_course_release` for the approved course.
6. Run `publish_approved_catalog`.
7. Allow the cross-repository workflow to update the Academy website and trigger Vercel deployment.

## Generated artifacts

Each Console run uploads a downloadable GitHub Actions artifact containing available files from:

- `catalog/`
- `releases/`
- `courses/*/generated/`

Artifacts are retained for 30 days. Selecting **commit generated changes** also commits generated files back to the branch used for the workflow run.

## Security and release controls

- API keys remain in encrypted GitHub Actions secrets.
- Draft materials retain the Obserra proprietary notice.
- External AI media jobs include official legal-name and brand metadata.
- Draft or incomplete review states block FINAL release packaging.
- Standards, legal, regulatory, and risk claims require authoritative source grounding.
- NIST, FDA, CMMC, SSDF, SEC, OSHA, and other authorities must be cited with a section, clause, control, practice, page, or equivalent reference.
- Guidance and advisories must not be represented as binding law unless incorporated into an applicable legal, regulatory, contractual, or organizational requirement.
