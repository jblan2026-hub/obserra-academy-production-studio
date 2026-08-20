# Academy Production Failures and Non-Repeat Rules

**Status:** Binding production incident record and prevention contract  
**Scope:** Obserra Academy 61-course completion program  
**Authoritative local production root:** `C:\ObserraAcademyProduction`  
**Authoritative Studio repository:** `C:\ObserraAcademyProduction\source\obserra-academy-production-studio`  
**Repository:** `jblan2026-hub/obserra-academy-production-studio`  
**Production branch:** `agent/academy-61-course-completion-only`  
**Objective:** 61/61 courses verified complete to the documented Academy standard  
**Last updated:** 2026-08-08 America/New_York

## 1. Purpose

This document records production-management failures that consumed time without producing verified completed courses. These failures are documented so they are not repeated by a future assistant, engineer, agent, controller, or worker scheduler.

The governing rule is simple: **course completion is the unit of value**. Activity, worker count, CPU utilization, planning, documentation activity, partial generation, checkpoints, and renders do not count as completion unless the final course verifier passes.

## 2. Failure: asking the owner to restate documented information

### What happened

The repository and project documentation already contained the Academy production topology, worker architecture, quality requirements, GitHub workflow, local execution scripts, and the local production root. Despite that, the assistant repeatedly asked or implicitly required the owner to restate information that should have been recovered from documentation.

### Why this was wrong

It shifted operational burden back to the owner, wasted production time, and created the false impression that the production state was unknown when it was already documented.

### Non-repeat rule

Before asking the owner for any production detail, the active agent must first read:

1. `docs/ACADEMY-OWNER-DIRECTIVES-AND-PRODUCTION-HANDOFF.md`
2. this document
3. PR 46 current description and head state
4. `docs/ACADEMY-CANONICAL-EXECUTION-PATH.md`
5. `policy/academy-execution-route.json`
6. the active quality contracts
7. the current workflow and final verifier

Do not ask the owner to repeat a fact that is already documented. If current runtime state is needed, query the available execution/evidence surfaces directly.

## 3. Failure: implying local Windows work when no local execution channel existed

### What happened

The owner expected production under `C:\ObserraAcademyProduction`. The assistant discussed moving work to the local machine without first proving that this chat had a connected Windows/PowerShell execution channel.

### Current fact

This chat does not currently have a connected Windows shell, PowerShell, desktop-control, or inbound Owner Command Center execution tool. The Owner Command Center documentation describes loopback-local control, not an inbound remote administration channel for this chat.

### Why this was wrong

A production manager must never imply that a local worker was started, stopped, or modified without direct execution evidence.

### Non-repeat rule

Never claim local Windows activity unless a connected tool actually executes it and returns evidence. The authoritative local target remains `C:\ObserraAcademyProduction`, but lack of direct control must be stated as a fact, not hidden or blurred.

## 4. Failure: canary became a portfolio-wide choke point

### What happened

The canonical workflow made all portfolio content workers depend on the full end-to-end canary job. The canary remained in `Research author review and checkpoint the canary`, while every other course worker remained blocked.

### Why this was inefficient

The canary is valuable as a full acceptance proof, but independent course content work does not inherently require every other course to remain idle while the canary authors its modules. The scheduling design converted one slow course into a global throughput block.

### Non-repeat rule

Keep strict per-course quality gates, but do not serialize independent course work behind one slow course unless a documented safety or acceptance requirement explicitly requires it. A canary may continue as an end-to-end proof while other uniquely assigned course workers perform independent content work.

No worker may duplicate the canary course while the canary owns it.

## 5. Failure: a failed course abandoned later courses in the same worker shard

### What happened

`.github/scripts/run-academy-zero-cost-shard.mjs` used `break` after a course failed research, authoring, remediation, deterministic validation, review, or checkpoint refresh.

### Why this was inefficient

One failed course could abandon all later courses assigned to that worker. This wasted an otherwise healthy worker lane and reduced the number of protected checkpoints produced per run.

### Non-repeat rule

Record a failed course with its exact stage and reason, then continue to the next independently assigned course. At the end of the shard, return a nonzero result if any course failed so the job remains fail-closed while still preserving maximum useful completed work.

## 6. Failure: duplicate local controllers consumed compute without completion

### What happened

Multiple local production controllers were previously active at the same time and scheduled overlapping course work against one Ollama service. Eighteen workers were observed across three controllers while the verified course completion count remained zero.

### Why this was inefficient

Duplicate course generation and model contention consumed CPU without increasing verified completed-course throughput.

### Non-repeat rule

There must be one authoritative controller per execution lane, unique course ownership, and no duplicate work across controllers. Windows and GitHub must not work the same unclaimed course simultaneously. Preserve and reuse valid checkpoints rather than regenerating the same work.

## 7. Failure: too much planning and documentation while production was blocked

### What happened

Time was spent discussing architecture, dashboard work, documentation structure, and prospective optimization while the first course still had not reached final verification.

### Why this was wrong

Documentation is necessary for continuity, but it became disproportionate to the immediate production objective.

### Non-repeat rule

Documentation work during an active production blockage must be limited to the minimum needed to prevent loss of context, record a material failure, or support the current production fix. Course execution and verified outcomes take priority.

## 8. Failure: reporting activity instead of outcomes

### What happened

Updates sometimes emphasized what was being planned or changed instead of leading with verified course outcomes.

### Non-repeat rule

Production reporting must lead with facts in this order:

- **Verified complete:** X/61
- **Active:** course IDs and current gate
- **Queued:** count
- **Failed:** course IDs and exact failed gate/reason
- **Execution limitation:** only when it materially affects completion

Do not represent researched, authored, checkpointed, reviewed, materialized, or rendered as complete unless the authoritative final verifier passed.

## 9. Failure: insufficient distinction between intended and actually committed changes

### What happened

The assistant described scheduler changes before a source-control mutation had actually completed.

### Non-repeat rule

Use precise state language:

- `planned` means not written.
- `prepared` means content exists but is not committed/applied.
- `committed` means repository mutation returned a commit SHA.
- `running` means current workflow/job evidence shows execution.
- `verified` means the applicable verifier/evidence gate passed.

Never describe a planned change as active production behavior.

## 10. Required production behavior going forward

1. Read the handoff and incident record before acting.
2. Query current evidence before reporting status.
3. Use all safely available governed workers for independent course work.
4. Keep unique course ownership and avoid duplicate course execution.
5. Reuse valid research, module, package, review, media, and protected checkpoints.
6. Continue other independent courses when one course fails; record the failure and fail the aggregate job at the end.
7. Keep all strict course-quality, evidence, accessibility, rights, assessment, media, and verification requirements intact.
8. Never claim local Windows execution without direct evidence.
9. Never ask the owner to restate documented information.
10. Report facts and verified course outcomes, not intentions.
11. The only production objective is **61/61 verified complete courses**.

## 11. Verbatim owner directives added during this incident

The following directives are preserved verbatim because the owner requires every material instruction to be durable and recoverable:

> get to fucking work and document that also

> that you hadndled incorrect

> get this moving faster and get these courses done to standard

> nothing is being done on this local machine so get them to work

> stop bullshiting

> only report facts and document all this failure

> to never do again

## 12. Handoff rule

A new agent must read `docs/ACADEMY-OWNER-DIRECTIVES-AND-PRODUCTION-HANDOFF.md` and this document before changing course workers or reporting Academy status. The next action is determined from current evidence, not from conversational memory.
