import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { canPerformFinalCourseReview } from "../lib/final-review-auth";
import { finalReviewStudentExperienceUrl } from "../lib/final-review-student-url";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("final review authorization is restricted to owner or administrator roles", () => {
  assert.equal(canPerformFinalCourseReview("user_1", "org:owner"), true);
  assert.equal(canPerformFinalCourseReview("user_1", "org:admin"), true);
  assert.equal(canPerformFinalCourseReview("user_1", "org:member"), false);
  assert.equal(canPerformFinalCourseReview(null, "org:owner"), false);
});

test("final review student URL fails closed and requires an approved secure origin", () => {
  const previousBase = process.env.FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL;
  const previousAllowed = process.env.FINAL_REVIEW_ALLOWED_STUDENT_ORIGINS;
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL;
    delete process.env.FINAL_REVIEW_ALLOWED_STUDENT_ORIGINS;
    assert.equal(finalReviewStudentExperienceUrl("pmp-course"), null);

    process.env.FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL = "http://academy.example.test";
    assert.equal(finalReviewStudentExperienceUrl("pmp-course"), null);

    process.env.FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL = "https://preview.obserrallc.com";
    process.env.FINAL_REVIEW_ALLOWED_STUDENT_ORIGINS = "https://preview.obserrallc.com";
    const result = finalReviewStudentExperienceUrl("pmp-course");
    assert.ok(result);
    const parsed = new URL(result);
    assert.equal(parsed.origin, "https://preview.obserrallc.com");
    assert.equal(parsed.pathname, "/academy/learn/pmp-course");
    assert.equal(parsed.searchParams.get("review"), "owner-final");
  } finally {
    process.env.FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL = previousBase;
    process.env.FINAL_REVIEW_ALLOWED_STUDENT_ORIGINS = previousAllowed;
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("admin final review page excludes scripts and prototypes", () => {
  const queuePage = read("app/admin/final-review/page.tsx");
  const coursePage = read("app/admin/final-review/[courseSlug]/page.tsx");

  assert.match(queuePage, /Draft scripts, prototypes, partial videos/);
  assert.match(queuePage, /getFinalReviewQueue/);
  assert.match(coursePage, /getFinalReviewReadiness/);
  assert.match(coursePage, /Exact staged paid learner experience/);
  assert.match(coursePage, /iframe/);
  assert.doesNotMatch(coursePage, /production-script\.md/);
});

test("owner approval records a decision without publishing", () => {
  const repository = read("lib/repositories/final-review-decision-repository.ts");
  const action = read("app/admin/final-review/actions.ts");

  assert.match(repository, /course-not-ready-for-final-review/);
  assert.match(repository, /status: "APPROVED"/);
  assert.match(repository, /status: "READY"/);
  assert.match(repository, /publicationTriggered: false/);
  assert.doesNotMatch(repository, /status: "PUBLISHED"/);
  assert.match(action, /studentExperienceReviewed/);
  assert.match(action, /noAutomaticPublication/);
});
