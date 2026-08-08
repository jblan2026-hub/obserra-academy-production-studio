import fs from "node:fs";
import path from "node:path";

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDurationHours(value) {
  if (typeof value === "number") return Math.max(0, value);
  const normalized = String(value ?? "").toLowerCase();
  if (!normalized) return 0;

  const hourMatches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/g)];
  const minuteMatches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/g)];
  const hours = hourMatches.reduce((total, match) => total + finiteNumber(match[1]), 0);
  const minutes = minuteMatches.reduce((total, match) => total + finiteNumber(match[1]), 0);
  if (hours > 0 || minutes > 0) return hours + (minutes / 60);

  const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function levelWeight(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("advanced") || normalized.includes("executive")) return 1.35;
  if (normalized.includes("intermediate") || normalized.includes("professional")) return 1.18;
  return 1;
}

export function estimateCourseWork(manifest, manifestBytes = 0) {
  const course = manifest?.course ?? {};
  const modules = Array.isArray(course.modules) ? course.modules : [];
  const outcomes = Array.isArray(course.outcomes) ? course.outcomes : [];
  const frameworkCount = Array.isArray(manifest?.tags?.frameworks)
    ? manifest.tags.frameworks.length
    : 0;
  const durationHours = parseDurationHours(course.duration);
  const moduleDurationHours = modules.reduce(
    (total, module) => total + parseDurationHours(module?.duration),
    0,
  );
  const effectiveHours = Math.max(durationHours, moduleDurationHours);
  const base = 100
    + (modules.length * 140)
    + (outcomes.length * 18)
    + (frameworkCount * 22)
    + (effectiveHours * 35)
    + (Math.max(0, manifestBytes) / 2048);

  return Math.max(1, Math.round(base * levelWeight(course.level)));
}

export function orderTargetsByEstimatedWork(root, targets) {
  return [...targets]
    .map((target) => {
      const courseId = String(target?.courseId ?? "").trim();
      const manifestPath = path.join(root, "courses", courseId, "course-manifest.json");
      let manifest = null;
      let manifestBytes = 0;
      try {
        manifestBytes = fs.statSync(manifestPath).size;
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch {
        // Missing or malformed manifests remain in the queue and fail in the governed authoring process.
      }
      return {
        ...target,
        courseId,
        estimatedWork: estimateCourseWork(manifest, manifestBytes),
      };
    })
    .sort((left, right) =>
      right.estimatedWork - left.estimatedWork
      || left.courseId.localeCompare(right.courseId),
    );
}

function stableFraction(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function retryDelayMs(baseDelayMs, attempt, jitterKey = "") {
  const base = Math.max(1, finiteNumber(baseDelayMs, 1));
  const boundedAttempt = Math.max(1, Math.trunc(finiteNumber(attempt, 1)));
  const exponential = base * (2 ** (boundedAttempt - 1));
  const jitterMultiplier = 0.8 + (stableFraction(`${jitterKey}:${boundedAttempt}`) * 0.4);
  return Math.max(1, Math.round(exponential * jitterMultiplier));
}

export function percentile(values, percentileValue) {
  const ordered = values
    .map((value) => finiteNumber(value, Number.NaN))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (ordered.length === 0) return 0;
  const bounded = Math.max(0, Math.min(100, finiteNumber(percentileValue, 0)));
  const rank = (bounded / 100) * (ordered.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + ((ordered[upper] - ordered[lower]) * (rank - lower));
}

export function buildAuthoringPerformanceMetrics({
  results,
  elapsedMs,
  launchedWorkerCount,
  requestedCourses,
}) {
  const completed = Array.isArray(results) ? results : [];
  const successful = completed.filter((result) => result?.ok === true);
  const durations = successful
    .map((result) => finiteNumber(result.elapsedMs, 0))
    .filter((value) => value > 0);
  const attempts = completed.map((result) => Math.max(1, finiteNumber(result?.attempt, 1)));
  const retries = attempts.reduce((total, attempt) => total + Math.max(0, attempt - 1), 0);
  const outputBytes = successful.reduce(
    (total, result) => total + Math.max(0, finiteNumber(result?.outputBytes, 0)),
    0,
  );
  const elapsedHours = Math.max(1 / 3600, Math.max(0, finiteNumber(elapsedMs, 0)) / 3_600_000);
  const workerCapacityMs = Math.max(1, Math.max(1, finiteNumber(launchedWorkerCount, 1)) * Math.max(1, finiteNumber(elapsedMs, 1)));
  const productiveMs = durations.reduce((total, duration) => total + duration, 0);

  return {
    requestedCourses: Math.max(0, finiteNumber(requestedCourses, 0)),
    completedCourses: completed.length,
    successfulCourses: successful.length,
    failedCourses: completed.length - successful.length,
    firstPassSuccesses: successful.filter((result) => finiteNumber(result.attempt, 1) === 1).length,
    firstPassYieldPercent: successful.length === 0
      ? 0
      : Number(((successful.filter((result) => finiteNumber(result.attempt, 1) === 1).length / successful.length) * 100).toFixed(2)),
    totalRetries: retries,
    retryRatePercent: completed.length === 0
      ? 0
      : Number(((retries / completed.length) * 100).toFixed(2)),
    averageAttempts: completed.length === 0
      ? 0
      : Number((attempts.reduce((total, value) => total + value, 0) / completed.length).toFixed(2)),
    throughputCoursesPerHour: Number((successful.length / elapsedHours).toFixed(2)),
    averageSuccessfulCourseMs: successful.length === 0
      ? 0
      : Math.round(durations.reduce((total, value) => total + value, 0) / successful.length),
    p50SuccessfulCourseMs: Math.round(percentile(durations, 50)),
    p95SuccessfulCourseMs: Math.round(percentile(durations, 95)),
    maximumSuccessfulCourseMs: durations.length === 0 ? 0 : Math.max(...durations),
    totalOutputBytes: outputBytes,
    averageOutputBytes: successful.length === 0 ? 0 : Math.round(outputBytes / successful.length),
    estimatedWorkerUtilizationPercent: Number((Math.min(1, productiveMs / workerCapacityMs) * 100).toFixed(2)),
  };
}
