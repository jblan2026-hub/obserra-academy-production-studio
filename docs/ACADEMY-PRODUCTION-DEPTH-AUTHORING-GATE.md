# Academy Production-Depth Authoring Gate

**Status:** Governed source control  
**Policy version:** `2026.08.08.1`  
**Applies to:** All owner-review-eligible Obserra Academy course packages  
**Publication authority:** Not granted

## Purpose

This gate converts the Academy instructional-depth requirements from a written production standard into executable source controls. It prevents a structurally valid but substantively shallow AI package from advancing as owner-review-ready course content.

The gate operates within the authoritative portfolio allocation of 36 logical workers: 20 application workers and no more than 16 Academy course workers. It does not reactivate the superseded temporary allocation of 36 Academy workers.

## Authoritative executable contract

`studio/academy-authoring-quality-contract.mjs` is the single executable source for the authoring policy version and minimum production-depth thresholds. The authoring prompt, readiness audit, package validator, selective repair process, and regression tests consume the same contract.

The minimum requirements for every manifest module are:

- 1,200 substantive lesson-narrative words;
- six distinct learning objectives;
- six developed key concepts;
- one substantive executive example;
- one substantive operational example;
- one evidence-rich scenario;
- one applied exercise with a reviewable deliverable and rubric;
- four original knowledge checks with credible options and rationales;
- ten complete slide narratives;
- eight scene-level video-script segments with narration and visual direction; and
- four specific accessibility requirements.

Every course must also contain at least 30 original final-assessment questions, complete module coverage, a cognitive mix totaling 100 percent, assessment-integrity controls, source-register mappings, workbook content for every module, an instructor guide, accurate marketing content, and the official Obserra legal and visual identity.

## Source and applicability controls

Every source-register entry must retain a unique identifier, claim or topic, applicable module identifiers, verification instruction, and usage boundary. Assessment source identifiers must resolve to that governed source register. Framework mappings must remain conditional, independently verifiable, and explicitly informational.

The gate does not treat a source placeholder as an independently verified authority. Exact citations, locators, jurisdictional applicability, legal interpretation, and release use remain subject to the appropriate subject-matter, technical, legal, rights, accessibility, and owner reviews.

## Failure and repair behavior

A missing, stale, untraceable, older-policy, or production-depth-invalid package is returned to the governed authoring queue. The selective repair process regenerates only failing course packages, uses bounded concurrency and attempts, records the findings before and after each attempt, and fails closed when any package remains below the contract.

Changing the policy version changes the source-manifest hash. Packages generated under an older authoring standard therefore cannot be silently reused as current production-depth evidence.

## Evidence

The authoring workflow must produce machine-readable evidence containing:

- the exact authoring policy version and thresholds;
- discovered, generated, repaired, and failed course counts;
- package-level findings;
- provider and model identity;
- worker allocation and concurrency;
- attempt and failure classifications;
- protected package hashes; and
- publication and checkout lock status.

Protected learner content remains outside source control and is retained only in governed short-lived workflow artifacts or the protected Academy persistence boundary.

## Claim boundary

Passing this gate means that the generated package satisfies the automated production-depth authoring contract. It does not mean that sources are independently verified, media is mastered, rights are cleared, accessibility is accepted, assessments are psychometrically approved, the LCMS load succeeded, the learner experience is deployed, the course is published, checkout is enabled, or the owner has accepted the release.

`publishToAcademy` and checkout must remain disabled until every downstream release gate passes and the owner accepts the exact staged learner experience.
