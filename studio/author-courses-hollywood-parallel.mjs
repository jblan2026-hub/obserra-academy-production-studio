/*
 * Compatibility entrypoint for the integrated Academy production branch.
 *
 * The parent integration branch still maps `author:parallel` to this historical
 * filename. The authoritative production allocation is now 36 logical workers:
 * 20 reserved for applications and 16 reserved for Academy course production.
 * Delegate to the governed 16-worker coordinator rather than reactivating the
 * superseded 0-application / 36-course surge contract.
 */

process.env.OBSERRA_PORTFOLIO_WORKER_COUNT ||= "36";
process.env.OBSERRA_APPLICATION_WORKER_COUNT ||= "20";
process.env.ACADEMY_COURSE_WORKER_COUNT ||= "16";
process.env.ACADEMY_AUTHORING_CONCURRENCY ||= "16";

await import("./author-courses-parallel.mjs");
