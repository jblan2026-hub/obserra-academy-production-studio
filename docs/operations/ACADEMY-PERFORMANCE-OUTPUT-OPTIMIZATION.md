# Academy Performance and Output Optimization

**Document ID:** ACADEMY-OPS-PERFORMANCE-001  
**Status:** Active controlled engineering record  
**Owner:** Obserra Product Owner  
**Last updated:** 2026-08-08  
**Applies to:** The protected 61-course Academy portfolio using the authoritative 36-worker allocation of 20 application workers and 16 Academy course workers

## Objective

Increase useful course-production throughput without weakening protected checkpoints, source traceability, instructional depth, assessment integrity, media, accessibility, rights, LCMS, security, owner review, publication, or commerce controls. Performance is measured from direct workflow evidence rather than inferred from configured worker counts.

## Authoritative allocation

The Obserra production portfolio remains fixed at:

- 36 total logical workers
- 20 application workers
- 16 Academy course workers

The performance coordinator may use no more than the 16 Academy workers. It does not borrow from the application pool, represent a logical allocation as hosted compute, or claim that a worker is executing without direct assignment and execution evidence.

## Implemented optimization controls

1. **Longest estimated work first scheduling.** The coordinator estimates course workload from module count, duration, learning outcomes, framework scope, level, and manifest size. Higher-cost packages enter the queue first to reduce the portfolio tail and improve total makespan when workers complete at different times.
2. **Deterministic jittered retries.** Retry delays retain bounded exponential backoff but add deterministic jitter by course and attempt. This reduces synchronized provider retry bursts while preserving reproducible evidence.
3. **Shared fatal versus course local failure isolation.** Authentication, quota, billing, credit, and protected checkpoint failures stop the remaining portfolio because they affect every worker. A course-specific invalid provider request fails that course but does not automatically discard unrelated queued work.
4. **Thirty second operational heartbeat.** The build reports completed, successful, failed, active, queued, elapsed, and halted state every 30 seconds.
5. **Per attempt and per course timing.** Each result records attempt start, completion, latency, retry history, total course elapsed time, worker identity, and generated package bytes.
6. **Worker performance evidence.** Each worker records completed courses, productive duration, and total elapsed duration.
7. **Portfolio performance evidence.** The protected summary reports throughput per hour, first pass yield, retry rate, average attempts, average latency, p50 latency, p95 latency, maximum latency, output bytes, average package size, and estimated worker utilization.
8. **Truthful output boundary.** Performance evidence proves only observed package generation behavior and, where required, checkpoint behavior. It does not establish independent source verification, legal sufficiency, instructional acceptance, mastered media, accessibility acceptance, rights clearance, psychometric approval, LCMS persistence, owner approval, publication, checkout, or learner availability.

## Key performance indicators

| KPI | Purpose |
|---|---|
| Throughput, courses per hour | Measures completed protected packages relative to elapsed build time |
| First pass yield | Measures successful packages requiring no retry |
| Retry rate | Detects provider instability, prompt defects, or capacity pressure |
| Average attempts | Shows rework per course |
| p50 and p95 course latency | Shows typical and tail completion time |
| Maximum course latency | Identifies outliers affecting portfolio completion |
| Output bytes and average package size | Detects unexpectedly incomplete or oversized packages |
| Estimated worker utilization | Detects idle capacity and scheduling imbalance |
| Failure category | Separates shared provider, checkpoint, and course local defects |

## Performance operating rules

- Worker count is not treated as throughput evidence.
- A logical worker is not treated as active compute until the workflow assigns it work.
- A package is not treated as complete until the authoring process succeeds and all applicable protected persistence requirements pass.
- Retry count is bounded. Shared fatal conditions stop waste immediately.
- Course local defects are isolated so unrelated work can continue.
- Protected content is not uploaded as a public CI artifact. Only non-content performance evidence may be uploaded.
- The production-depth quality contract remains authoritative for every package.
- Standard courses require at least 30 original assessment questions. The PMP course retains its separately governed 180-question contract.
- Publication and checkout remain disabled until the separate release gates pass.

## Current verified baseline

The current production-depth line governs 61 course manifests and policy `2026.08.08.2`. It requires substantive module narratives, developed objectives and concepts, executive and operational examples, scenarios, applied exercises, knowledge checks, slide narratives, video segments, accessibility requirements, source mappings, and the applicable assessment depth.

Protected workflow run `31249185204` is the current authoritative build and remains isolated from this optimization branch. Because the acceleration workflow uses cancel-in-progress behavior, this performance change must not be merged into `agent/academy-build-acceleration` until that protected run completes and its evidence is retained.

The performance implementation requires its dedicated Academy Performance Output Gate and the complete Academy Studio validation to pass before incorporation. Direct provider throughput metrics will be written only by an actual protected course-production execution.

## Next optimization stages

1. Complete and retain the current protected `2026.08.08.2` build evidence.
2. Establish the first direct protected performance baseline after governed promotion.
3. Compare p50, p95, first pass yield, retries, utilization, and output size by course type and provider.
4. Adjust provider concurrency only from observed rate limit and latency evidence.
5. Detect low output and high latency outliers before materialization.
6. Feed verified worker and course metrics into the private Owner Command Center Worker Operations dashboard.
7. Add cost per successful protected package when provider usage metadata is available and attributable.
8. Preserve rollback to the prior coordinator until the optimized run passes the protected workflow and owner acceptance.
