# Obserra Academy Canonical Execution Path

## Purpose

Obserra Academy course production has one authorized execution route. This prevents duplicate workflows, competing runners, accidental paid-provider fallback, inconsistent checkpoints, and repeated regeneration. All course work must enter through `.github/workflows/academy-zero-cost-sharded-completion.yml`.

## Authorized route

The canonical workflow performs five ordered stages. It first prepares the governed primary-source cache and local Ollama model. It then completes and verifies one canary course end to end. Only a passing canary releases the 20 local course workers. After worker completion, the workflow restores and validates all 61 protected checkpoints. The final stage renders local Piper and FFmpeg media, verifies every course and module video, and backs protected outputs up only to the private `jblan2026-hub/ObserraAI` repository on branch `academy-backups` under `private-backups/academy/61-course-completion`.

## Prohibited routes

Legacy Academy workflows are retained only as manual fail-closed stubs. They cannot run from pull requests, pushes, or schedules. Manual invocation exits with an error and directs the operator to the canonical workflow. Direct paid model or media providers, alternate checkpoint workflows, public workflow artifacts containing protected outputs, and direct LCMS retries outside the canonical workflow are prohibited.

## Enforcement

`policy/academy-execution-route.json` is the machine-readable source of truth. `studio/academy-zero-cost-lock.mjs` validates the current GitHub workflow identity, event type, provider configuration, commercial credentials, commercial endpoints, canonical workflow contract, and every blocked workflow stub. The same module installs a network-level block for commercial provider hosts in every Node process that imports it. Any policy violation fails the job before course generation.

The protected Supabase checkpoint gateway authorizes only the canonical workflow for Academy checkpoint operations. Successful work must be checkpointed so retries reuse valid evidence instead of regenerating it.

## Operator procedure

Use the canonical workflow only. Do not run a legacy Academy workflow, bypass the canary, raise worker concurrency above the governed value, add a provider credential, or move protected output into the public repository. A route change requires both a policy version increment and a zero-cost lock version increment, followed by canary verification.

Temporary PR 46 scheduling guards on unrelated workflows exist only to reserve runner capacity while the 61-course objective is completed. Restore those unrelated workflows from `main` before PR 46 is merged. Do not restore or reactivate the blocked legacy Academy workflows.

## Completion evidence

Completion means 61 of 61 courses pass research, factual grounding, course-specific instruction, documented cases where supportable, lessons learned, implementable recommendations, assessments, learner and instructor materials, certificates, accessibility, rights, independent review, final media playback validation, and private backup. Anything less remains incomplete.
