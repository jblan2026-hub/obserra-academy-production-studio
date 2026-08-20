# Obserra Academy Owner Directives and Production Handoff

**Status:** Binding operating document for the 61-course Academy completion objective  
**Owner:** jblan2026-hub / Obserra  
**Active production branch:** `agent/academy-61-course-completion-only`  
**Primary objective:** Complete all 61 Academy courses to the documented production standard.  
**Last updated:** 2026-08-08 America/New_York

## 1. Non-negotiable objective

There is one production objective: **complete courses**.

Do not optimize for activity, worker count, CPU utilization, authored drafts, checkpoint counts, materialization counts, or partially rendered assets. Optimize for **verified completed courses**.

The only portfolio success state is **61/61 courses verified complete** under the full Academy acceptance contract.

The first required proof point is one course reaching full completion. The current canary course is `ai-data-privacy-ip`. It does not count as complete until all required gates pass.

## 2. Authoritative Windows production workspace

The authoritative persistent local production root is:

`C:\ObserraAcademyProduction`

The authoritative Academy Studio repository is:

`C:\ObserraAcademyProduction\source\obserra-academy-production-studio`

The production root is the durable Windows workspace for course generation, checkpoints, logs, tools, local model execution, media rendering, and final local completion evidence.

Expected local topology:

- Production root: `C:\ObserraAcademyProduction`
- Studio repository: `C:\ObserraAcademyProduction\source\obserra-academy-production-studio`
- Course working data / mapped protected course outputs: `C:\ObserraAcademyProduction\courses\<course-id>` where configured by the production scripts and junction topology
- Checkpoints: `C:\ObserraAcademyProduction\checkpoints`
- Fully completed local course evidence: `C:\ObserraAcademyProduction\checkpoints\production-complete\<course-id>`
- Per-course local checkpoint mirror: `C:\ObserraAcademyProduction\checkpoints\courses\<course-id>`
- Logs: `C:\ObserraAcademyProduction\logs`
- Local production tools: `C:\ObserraAcademyProduction\tools`
- Piper virtual environment: `C:\ObserraAcademyProduction\tools\piper-venv`
- Piper voices: `C:\ObserraAcademyProduction\tools\piper-voices`
- Command shims: `C:\ObserraAcademyProduction\tools\command-shims`
- Optional isolated review dashboard root: `C:\ObserraAcademyProduction\dashboard\obserra-academy-command-center`

The Studio repository path above is authoritative. Do not invent an alternate root, move production to a different checkout, or assume a user profile path unless the owner explicitly changes this document.

## 3. Source-control and protected-output boundaries

Repository: `jblan2026-hub/obserra-academy-production-studio`

Current Academy completion PR: **#46 - Finish and verify all 61 Academy courses only**

Current production branch: `agent/academy-61-course-completion-only`

Protected course outputs must not be committed to the public Academy repository or uploaded as public workflow artifacts.

Private backup destination:

- Repository: `jblan2026-hub/ObserraAI`
- Required visibility: PRIVATE
- Branch: `academy-backups`
- Root: `private-backups/academy/61-course-completion`

## 4. Owner operating directives

The owner does **not** want to act as the production operator. Do not repeatedly hand the owner PowerShell commands, Git commands, worker commands, or routine operational steps. The assistant/agent is expected to manage all available connected execution surfaces directly and report results.

When a capability cannot be performed directly because no connected execution channel exists, state the limitation precisely. Do not pretend a local Windows process was started when it was not.

The owner wants production updates focused on outcomes, not implementation chatter. Lead updates with:

- verified complete / 61
- active courses
- queued courses
- failed courses
- current blocking gate

Do not count a course complete because it is queued, active, researched, authored, checkpointed, reviewed, materialized, or rendered. Only final verification counts.

Do not spend production time on unrelated Command Center, payment, deployment, dashboard, or documentation work while course completion is blocked, except for minimal documentation required to preserve this handoff and prevent repeated loss of context.

## 5. Mandatory quality standard

The strict Academy standards remain unchanged. Efficiency work may change scheduling, checkpoint reuse, retry behavior, worker allocation, or execution topology, but must not lower the course-quality contract.

A production-complete course must satisfy the repository's binding Academy standards, including at minimum:

1. Current governed primary-source research.
2. Factual grounding and source traceability.
3. Course-specific substantive instruction.
4. At least the enforced substantive lesson depth per module, including the 1,200+ word floor where governed by the current quality contract.
5. Documented real-world cases where supportable by authoritative evidence.
6. Lessons learned.
7. Implementable recommendations.
8. Required learning objectives and developed concepts.
9. Executive and operational examples.
10. Realistic instructional scenarios with clear fact/constructed-scenario boundaries.
11. Practical exercises and reviewable deliverables.
12. Knowledge checks.
13. Required final assessment coverage and quality.
14. Learner materials.
15. Instructor materials.
16. Certificate assets and issuance evidence.
17. Accessibility assets, including captions, transcripts, audio-description content or approved equivalent, readable alternatives, and reduced-motion support where required.
18. Rights and licensing evidence.
19. Independent course-quality review meeting the current governed threshold, including the required >=90 scores across all ten review dimensions when that is the active contract.
20. Final module media rendered at the governed technical standard.
21. Video decode/playback validation end to end.
22. Governed 1080p and audio requirements.
23. Source linkage in final course evidence.
24. Final deterministic verifier pass.
25. Private backup where required by the portfolio completion contract.

Publication authority is separate from production completion. Production completion must not be misrepresented as publication, checkout enablement, professional certification, regulatory approval, or learner entitlement.

## 6. Course production lifecycle

Each course moves through the following production stations. The exact scripts may evolve, but the gates do not disappear.

### Station A - Inventory and policy

- Course must be one of exactly 61 active governed Academy manifests.
- Retired or archived manifests are excluded only if the current policy explicitly permits exclusion.
- Course policy is applied before generation.
- Zero-commercial-cost execution lock is validated where that policy is active.

### Station B - Governed research

- Build or restore deterministic source context.
- Research authoritative primary sources.
- Reject unresolved source topics.
- Reject stale research whose manifest/policy hashes no longer match.
- Preserve binding/nonbinding status and applicability limits.

### Station C - Module authoring

- Author complete course-specific modules.
- Use the approved local model/provider when zero-cost policy is active.
- Preserve exact manifest module identity.
- Write valid module checkpoints atomically.
- Reuse valid module checkpoints instead of regenerating completed work.
- Do not invent authorities, URLs, quotations, dates, statistics, legal requirements, standards clauses, or case facts.

### Station D - Deterministic content validation

- Run the current deterministic course gate.
- Fail closed on depth, structure, assessment, source, applicability, media-plan, accessibility, or package deficiencies.
- Repair only failed content where possible.
- Preserve valid completed work.

### Station E - Independent quality review

- Run the governed independent course review.
- Current passing evidence must satisfy the repository's active review contract.
- Critical findings and required corrections must be zero before promotion.
- A failed review returns the course to bounded remediation; it does not count as complete.

### Station F - Protected checkpoint

- Persist the current valid research, authored package, and review evidence using the approved protected checkpoint mechanism.
- Verify integrity hashes.
- Restore and reuse valid protected evidence on retry.
- Do not regenerate a course merely because a runner restarted.

### Station G - Materialization

Materialize every required learner, instructor, assessment, accessibility, rights, source, and certificate asset for the course.

### Station H - Media production

- Use the governed media path.
- Current zero-cost route uses local Piper TTS and FFmpeg.
- Render every required module video.
- Generate final captions, transcripts, audio-description assets, source linkage, and rights evidence.
- Media work should begin only after course content has cleared the content/review gates unless an explicitly validated pipeline revision allows safe overlap without wasted rendering.

### Station I - Final course verification

Run the authoritative final course verifier. It must validate content, materials, certificates, accessibility, rights, and every final module video.

### Station J - Completion evidence

Only after the final verifier passes, write immutable/hash-recorded course completion evidence.

For the Windows single-course production lane, the expected completion evidence root is:

`C:\ObserraAcademyProduction\checkpoints\production-complete\<course-id>`

Expected evidence includes `local-production-completion.json` and the hashed completed output inventory created by the current completion script.

Only at this station can the course increment the verified completion count.

## 7. Worker strategy - efficient and repeatable

The owner requires **all workers to be used to complete courses**, with efficiency and repeatability.

The production scheduler must follow these principles:

- Course completion is the unit of value.
- Use all safely available governed course workers.
- Avoid a global choke point where one slow course unnecessarily prevents every other independent course from progressing, unless a specific safety/quality gate requires that serialization.
- Give work a unique course identity so two workers do not generate the same course simultaneously.
- Reuse valid research, module, package, review, and media checkpoints.
- Retry only failed work when possible.
- Do not restart successful portfolio stages because one course failed.
- Do not launch multiple independent controllers that unknowingly schedule the same courses.
- Avoid running GitHub and Windows workers on the same unclaimed course simultaneously.
- Prefer protected course claims/leases or equivalent cross-lane ownership when available.
- Keep local model concurrency within actual CPU/RAM/VRAM and model-server limits.
- Increase concurrency only when throughput rises without quality failures, queue thrashing, timeouts, or memory pressure.
- Separate content/model-heavy stations from media/render-heavy stations when doing so improves throughput.
- Preserve completed module checkpoints immediately so runner loss does not erase hours of work.
- All retries are bounded and observable.
- A repeatable pipeline should be restart-safe and checkpoint-first.

Known prior failure to avoid: multiple local controllers ran simultaneously and created duplicate workers against one Ollama service. That consumed compute without producing verified completed courses. Never repeat that topology.

## 8. Current known execution architecture

### Windows single-course full-completion command

`scripts/Complete-ObserraAcademyCourse.ps1`

Default production root: `C:\ObserraAcademyProduction`

This script is the current repository implementation that can take one course through preflight, source context, research/author/review/checkpoint, materialization, local media tooling, rendering, final verification, and hashed local completion evidence.

A success message from this path is meaningful only when the final verifier passed and local completion evidence was written.

### Windows portfolio content controller

`scripts/Start-ObserraAcademyLocalProduction.ps1`

This controller schedules course content work. Its content-build completion state is not by itself equivalent to fully rendered and final-verified production completion. Do not confuse the two.

### Windows shard worker

`scripts/Run-ObserraAcademyLocalShard.ps1`

This path performs content generation/checkpoint/materialization for a course shard. It does not by itself prove final media completion.

### GitHub governed completion workflow

`.github/workflows/academy-zero-cost-sharded-completion.yml`

The current source version prepares shared source/model runtime, runs course content work, restores protected checkpoints, materializes, renders, verifies, and backs up according to its current policy contract.

GitHub and Windows are execution lanes. Neither lane is allowed to lower the acceptance standard.

## 9. Direct Windows execution limitation from ChatGPT

The Owner Command Center documentation explicitly states that its health/readiness service is loopback-only and exposes no inbound remote-administration endpoint. The local Command Center can launch approved Academy actions on the machine, but this chat session does not automatically have access to that loopback runtime.

Therefore:

- Do not claim the chat directly started Windows processes unless a connected execution tool actually did so.
- When local control is unavailable, use connected GitHub/Supabase execution surfaces where appropriate.
- The authoritative Windows target remains `C:\ObserraAcademyProduction` even when the chat cannot directly execute on it.

## 10. Recovery rules

When production fails:

1. Preserve valid checkpoints, generated work, logs, state, and evidence.
2. Identify the exact failed gate.
3. Retry or repair only the failed station/course where safe.
4. Do not wipe the production root.
5. Do not delete valid module partials merely to make a clean run.
6. Do not start another controller if an authoritative controller already owns the same work.
7. Do not count recovery activity as completion.
8. Return the course to the final verifier.

## 11. Reporting contract

The owner wants concise outcome reporting.

Preferred status format:

- **Verified complete:** X/61
- **Active:** course IDs and current gate
- **Queued:** count
- **Failed:** course IDs and exact gate/reason
- **Next production action:** only when material

Do not lead with implementation plans, documentation progress, process explanations, or command snippets while courses remain incomplete.

## 12. Current truth at time of this handoff

At the time this document was created, the last directly verified portfolio completion count was **0/61**.

The active GitHub run previously observed was `31286383466` with `ai-data-privacy-ip` in the `Research author review and checkpoint the canary` step. Materialization, media rendering, and final verification had not yet passed at that observation.

Do not assume this status is still current. Any future agent must query current workflow/protected completion evidence before reporting a number.

## 13. Verbatim owner directive log

The following owner messages are preserved verbatim, including spelling and punctuation, because the owner explicitly required future agents to be able to recover intent without relying on conversational memory:

> jsut manage it and run what you need to and get it efficent

> stop giving me commands to run im the fucking owner

> you mange the workers and get courses done

> and keep it within sstrict standard i provided

> read the fucking documentation if you cant remeber

> now tell me what you are doing and the objective

> yes get this assembly pipeline working now

> the fucking objective is get the courses complete this is ridicoulous we have bene wasting alot of time over days and still no courses

> i need to see outcomes and courses that is all

> and you need to keep them working to get there

> fucking one course we cant complete fix this

> and fix it now

> then bypass fucking github and use direct to my computer

> reading the fucking documentation

> c:// ObserraAcademyProduction

> and put it in the documentation and update work documention to reflect entire path and scope and details

> document the entire process non negoitable

> to clearly hand off to another where they can read and just work

> get them making fucking course

> thiquit wasting time

> you have one objective complete courses

> with all workers

> and it better work

> and be efficent and repeatable

> document every fucking word i tell you so when you lose oyur memory again you can quickly read and understand

> no exceptions

## 14. Handoff instruction for the next engineer or agent

Read this file first. Then read the current PR 46 description, `docs/ACADEMY-CANONICAL-EXECUTION-PATH.md`, `policy/academy-execution-route.json`, the active course-quality contract, and the final course verifier.

Immediately query current evidence before acting. Determine verified complete/61, active courses, failures, and exact gates. Do not reconstruct an old plan if the current state has already advanced.

Then continue the single owner objective: **complete courses to the strict standard using all safely available workers, efficiently and repeatably, until 61/61 are verified complete.**
