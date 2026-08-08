import assert from "node:assert/strict";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";
import {
  assertAcademyWorkerAllocation,
  portfolioWorkerCount,
  applicationWorkerAllocation,
  courseWorkerAllocation,
  workerMode,
} from "./academy-worker-contract.mjs";

const allocation = assertAcademyWorkerAllocation();
const portfolio = academySurgePortfolio();

assert.equal(portfolioWorkerCount, 36, "portfolio worker count must be 36");
assert.equal(applicationWorkerAllocation, 0, "application worker count must be 0");
assert.equal(courseWorkerAllocation, 36, "course worker count must be 36");
assert.equal(allocation.portfolioWorkerCount, 36, "runtime portfolio worker count must be 36");
assert.equal(allocation.applicationWorkerAllocation, 0, "runtime application worker count must be 0");
assert.equal(allocation.courseWorkerAllocation, 36, "runtime course worker count must be 36");
assert.equal(allocation.workerMode, workerMode, "worker mode mismatch");
assert.equal(portfolio.expectedCourses, 61, "61-course completion lane must expect 61 courses");
assert.equal(portfolio.selectedCourses.length, 61, "61-course completion lane must select 61 courses");
assert.equal(new Set(portfolio.selectedCourseIds).size, 61, "61 selected course IDs must be unique");
assert.equal(portfolio.discoveredManifests, 61, "repository must contain 61 governed course manifests");

console.log(`[Academy Studio] 61-course worker contract passed: workers=${allocation.courseWorkerAllocation}, applicationWorkers=${allocation.applicationWorkerAllocation}, courses=${portfolio.selectedCourses.length}.`);
