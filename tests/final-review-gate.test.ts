import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { canPerformFinalCourseReview } from "../lib/final-review-auth";
import { finalReviewStudentExperienceUrl } from "../lib/final-review-student-url";
import { finalReviewTutorRuntimeUrl } from "../lib/final-review-tutor-url";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function setEnvironment(name: string, value: string): void {
  process.env[name] = value;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("final review authorization is restricted to owner or administrator roles", () => {
  const previousOwnerIds = process.env.OBSERRA_OWNER_USER_IDS;
  try {
    delete process.env.OBSERRA_OWNER_USER_IDS;
    assert.equal(canPerformFinalCourseReview("user_final_review_test", "org:owner"), true);
    assert.equal(canPerformFinalCourseReview("user_final_review_test", "org:admin"), true);
    assert.equal(canPerformFinalCourseReview("user_final_review_test", "org:member"), false);
    assert.equal(canPerformFinalCourseReview(null, "org:owner"), false);
  } finally {
    restoreEnvironment("OBSERRA_OWNER_USER_IDS", previousOwnerIds);
  }
});

test("final review student URL fails closed and requires an approved secure origin", () => {
  const previousBase = process.env.FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL;
  const previousAllowed = process.env.FINAL_REVIEW_ALLOWED_STUDENT_ORIGINS;
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    setEnvironment("NODE_ENV", "production");
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
    restoreEnvironment("FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL", previousBase);
    restoreEnvironment("FINAL_REVIEW_ALLOWED_STUDENT_ORIGINS", previousAllowed);
    restoreEnvironment("NODE_ENV", previousNodeEnv);
  }
});

test("final review tutor URL also fails closed and requires an approved secure origin", () => {
  const previousBase = process.env.FINAL_REVIEW_TUTOR_RUNTIME_BASE_URL;
  const previousAllowed = process.env.FINAL_REVIEW_ALLOWED_TUTOR_ORIGINS;
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    setEnvironment("NODE_ENV", "production");
    delete process.env.FINAL_REVIEW_TUTOR_RUNTIME_BASE_URL;
    delete process.env.FINAL_REVIEW_ALLOWED_TUTOR_ORIGINS;
    assert.equal(finalReviewTutorRuntimeUrl("pmp-course"), null);

    process.env.FINAL_REVIEW_TUTOR_RUNTIME_BASE_URL = "https://academy.obserrallc.com";
    process.env.FINAL_REVIEW_ALLOWED_TUTOR_ORIGINS = "https://academy.obserrallc.com";
    const result = finalReviewTutorRuntimeUrl("pmp-course");
    assert.ok(result);
    assert.equal(new URL(result).pathname, "/api/academy/courses/pmp-course/tutor");
  } finally {
    restoreEnvironment("FINAL_REVIEW_TUTOR_RUNTIME_BASE_URL", previousBase);
    restoreEnvironment("FINAL_REVIEW_ALLOWED_TUTOR_ORIGINS", previousAllowed);
    restoreEnvironment("NODE_ENV", previousNodeEnv);
  }
});

test("final review queue remains empty until the complete learner experience passes", () => {
  const queuePage = read("app/admin/final-review/page.tsx");
  const repository = read("lib/repositories/final-review-repository.ts");

  assert.match(queuePage, /Draft scripts, prototypes, partial videos, incomplete audio/);
  assert.match(queuePage, /Nothing is ready for your final review yet/);
  assert.match(queuePage, /getFinalReviewQueue/);
  assert.match(repository, /if \(!readiness\.ready \|\| !readiness\.preview \|\| !release\) return \[\]/);
});

test("owner final review renders the staged student package instead of an iframe or script", () => {
  const coursePage = read("app/admin/final-review/[courseSlug]/page.tsx");
  const studentExperience = read("app/admin/final-review/StudentExperienceReview.tsx");

  assert.match(coursePage, /StudentExperienceReview preview=\{preview\}/);
  assert.doesNotMatch(coursePage, /<iframe/);
  assert.doesNotMatch(coursePage, /production-script\.md/);
  assert.match(studentExperience, /<video/);
  assert.match(studentExperience, /<track default kind="captions"/);
  assert.match(studentExperience, /Authoritative references used in this lesson/);
  assert.match(studentExperience, /Course AI Coach/);
  assert.match(studentExperience, /NO PROTECTED ANSWERS SHOWN/);
});

test("readiness requires final media, audible audio, accessibility, rights, AI, entitlement, reviews, and staging", () => {
  const repository = read("lib/repositories/final-review-repository.ts");

  for (const requirement of [
    "final-video-missing",
    "audio-qa-missing",
    "captions-missing",
    "transcript-missing",
    "rights-clearance-missing",
    "required-review-missing",
    "quality-gate-missing",
    "release-not-staged",
    "ai-tutor-runtime-missing",
    "entitlement-runtime-missing",
  ]) {
    assert.match(repository, new RegExp(requirement));
  }
  assert.match(repository, /course\.status !== "APPROVAL"/);
  assert.match(repository, /release\.status !== "STAGED"/);
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

test("the learner tutor review proxy is owner scoped and fails closed", () => {
  const route = read("app/api/learner/courses/[courseSlug]/tutor/route.ts");

  assert.match(route, /canPerformFinalCourseReview/);
  assert.match(route, /getFinalReviewReadiness/);
  assert.match(route, /if \(!readiness\?\.ready \|\| !readiness\.preview\)/);
  assert.match(route, /The governed learner tutor runtime is not configured for final review/);
  assert.match(route, /X-Obserra-Review-Mode/);
});

test("mission control exposes the owner final review route", () => {
  const page = read("app/page.tsx");
  assert.match(page, /\/admin\/final-review/);
  assert.match(page, /Open Final Review/);
});
