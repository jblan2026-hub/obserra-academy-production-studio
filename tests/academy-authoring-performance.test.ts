import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAuthoringPerformanceMetrics,
  estimateCourseWork,
  orderTargetsByEstimatedWork,
  percentile,
  retryDelayMs,
} from "../studio/academy-authoring-performance.mjs";

test("course work estimation increases with modules, duration, and level", () => {
  const foundation = estimateCourseWork({
    course: {
      level: "foundation",
      duration: "2 hours",
      outcomes: ["one"],
      modules: [{ duration: "1 hour" }],
    },
  });
  const advanced = estimateCourseWork({
    course: {
      level: "advanced executive",
      duration: "8 hours",
      outcomes: ["one", "two", "three"],
      modules: [
        { duration: "2 hours" },
        { duration: "2 hours" },
        { duration: "2 hours" },
        { duration: "2 hours" },
      ],
    },
    tags: { frameworks: ["NIST", "ISO"] },
  });

  assert.ok(advanced > foundation);
});

test("longest estimated work is scheduled first with deterministic tie breaking", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "academy-performance-"));
  try {
    for (const [courseId, modules] of [["small-course", 1], ["large-course", 6], ["alpha-course", 1]] as const) {
      const courseDir = path.join(root, "courses", courseId);
      fs.mkdirSync(courseDir, { recursive: true });
      fs.writeFileSync(
        path.join(courseDir, "course-manifest.json"),
        JSON.stringify({
          course: {
            id: courseId,
            level: "professional",
            duration: `${modules * 2} hours`,
            outcomes: ["apply"],
            modules: Array.from({ length: modules }, () => ({ duration: "2 hours" })),
          },
        }),
      );
    }

    const ordered = orderTargetsByEstimatedWork(root, [
      { courseId: "small-course" },
      { courseId: "large-course" },
      { courseId: "alpha-course" },
    ]);

    assert.equal(ordered[0].courseId, "large-course");
    assert.equal(ordered[1].courseId, "alpha-course");
    assert.equal(ordered[2].courseId, "small-course");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("retry delay uses bounded deterministic jitter", () => {
  const first = retryDelayMs(5_000, 2, "course-a");
  const repeated = retryDelayMs(5_000, 2, "course-a");
  const other = retryDelayMs(5_000, 2, "course-b");

  assert.equal(first, repeated);
  assert.ok(first >= 8_000 && first <= 12_000);
  assert.ok(other >= 8_000 && other <= 12_000);
});

test("performance metrics report throughput, yield, retries, latency, output, and utilization", () => {
  const metrics = buildAuthoringPerformanceMetrics({
    elapsedMs: 3_600_000,
    launchedWorkerCount: 2,
    requestedCourses: 4,
    results: [
      { ok: true, attempt: 1, elapsedMs: 1_000_000, outputBytes: 1_000 },
      { ok: true, attempt: 2, elapsedMs: 1_400_000, outputBytes: 2_000 },
      { ok: true, attempt: 1, elapsedMs: 1_800_000, outputBytes: 3_000 },
      { ok: false, attempt: 3, elapsedMs: 500_000, outputBytes: 0 },
    ],
  });

  assert.equal(metrics.successfulCourses, 3);
  assert.equal(metrics.failedCourses, 1);
  assert.equal(metrics.firstPassSuccesses, 2);
  assert.equal(metrics.totalRetries, 3);
  assert.equal(metrics.throughputCoursesPerHour, 3);
  assert.equal(metrics.totalOutputBytes, 6_000);
  assert.ok(metrics.p95SuccessfulCourseMs >= metrics.p50SuccessfulCourseMs);
  assert.ok(metrics.estimatedWorkerUtilizationPercent > 0);
});

test("percentile interpolates stable latency values", () => {
  assert.equal(percentile([100, 200, 300, 400], 50), 250);
  assert.equal(percentile([], 95), 0);
});
