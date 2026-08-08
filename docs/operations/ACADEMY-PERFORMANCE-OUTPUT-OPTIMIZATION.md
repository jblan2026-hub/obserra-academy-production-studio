# Academy Performance and Output Optimization

**Document ID:** ACADEMY-OPS-PERFORMANCE-001  
**Status:** Active controlled engineering record  
**Owner:** Obserra Product Owner  
**Last updated:** 2026-08-08  
**Applies to:** The protected 36-worker Academy course-production surge for 60 standard courses, with PMP governed under its separate supplemental course contract

## Objective

Increase useful course-production throughput without weakening protected checkpoints, source traceability, media, accessibility, rights, assessment, LCMS, security, owner-review, publication, or commerce controls. Performance is measured from direct workflow evidence rather than inferred from configured worker counts.

## Implemented optimization controls

1. **Longest-estimated-work-first scheduling.** The coordinator estimates course workload from module count, duration, learning outcomes, framework scope, level, and manifest size. Higher-cost packages enter the queue first to reduce the portfolio tail and improve total makespan when workers complete at different times.
2. **Deterministic jittered retries.** Retry delays retain bounded exponential backoff but add deterministic jitter by course and attempt. This reduces synchronized provider retry bursts while preserving reproducible evidence.
3. **Shared-fatal versus course-local failure isolation.** Authentication, quota, billing, and protected-checkpoint failures stop the remaining portfolio because they affect every worker. A course-specific invalid provider request fails that course but no longer automatically discards unrelated queued work.
4. **Thirty-second operational heartbeat.** The build reports completed, successful, failed, active, queued, elapsed, and halted state twice as frequently as the prior coordinator.
5. **Per-attempt and per-course timing.** Each result records attempt start, completion, latency, retry history, total course elapsed time, worker identity, role, and generated package bytes.
6. **Worker performance evidence.** Each worker records completed courses, productive duration, and total elapsed duration.
7. **Portfolio performance evidence.** The protected summary now reports throughput per hour, first-pass yield, retry rate, average attempts, average latency, p50 latency, p95 latency, maximum latency, output bytes, average package size, and estimated worker utilization.
8. **Truthful output boundary.** Performance evidence proves only observed package-generation and checkpoint behavior. It does not establish reference verification, mastered media, accessibility acceptance, rights clearance, owner approval, publication, checkout, or learner availability.

## Key performance indicators

| KPI | Purpose |
|---|---|
| Throughput, courses/hour | Measures completed protected packages relative to elapsed build time |
| First-pass yield | Measures successful packages requiring no retry |
| Retry rate | Detects provider instability, prompt defects, or capacity pressure |
| Average attempts | Shows rework per course |
| p50 and p95 course latency | Shows typical and tail completion time |
| Maximum course latency | Identifies outliers affecting portfolio completion |
| Output bytes and average package size | Detects unexpectedly incomplete or oversized packages |
| Estimated worker utilization | Detects idle capacity and scheduling imbalance |
| Failure category | Separates shared provider, checkpoint, and course-local defects |

## Performance operating rules

- Worker count is not treated as throughput evidence.
- A logical worker is not treated as active compute until the workflow assigns it work.
- A package is not treated as complete until the authoring process succeeds and the protected checkpoint is stored when checkpoint persistence is required.
- Retry count is bounded. Shared-fatal conditions stop waste immediately.
- Course-local defects are isolated so unrelated work can continue.
- Protected content is not uploaded as a public CI artifact. Only non-content performance evidence may be uploaded.
- Publication and checkout remain disabled until the separate release gates pass.

## Current verified baseline

The reconciled exact-source validation confirmed the 36-worker contract, 60-course surge selection, PMP isolation, 61 governed manifests, source preparation, checkpoint architecture, media architecture, LCMS staging architecture, and release-gate architecture. Its dedicated exact-source workflow passed after a validation-only database URL was supplied. That workflow did not invoke protected providers, generate learner packages, master media, load production LCMS data, publish courses, or enable checkout.

The performance implementation requires its dedicated `Academy Performance Output Gate` to pass before incorporation into the protected production branch. Direct provider throughput metrics will be written only by an actual protected course-production execution.

## Next optimization stages

1. Establish the first direct protected performance baseline.
2. Compare p50, p95, first-pass yield, retries, and utilization by course type and provider.
3. Adjust provider concurrency only from observed rate-limit and latency evidence.
4. Detect low-output and high-latency outliers before materialization.
5. Feed verified worker and course metrics into the private Owner Command Center Worker Operations dashboard.
6. Add cost per successful protected package when provider usage metadata is available and attributable.
7. Preserve rollback to the prior coordinator until the optimized run passes the protected workflow and owner acceptance.
