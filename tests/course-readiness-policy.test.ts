import assert from "node:assert/strict";
import test from "node:test";
import { officialBrand } from "../studio/brand-policy.mjs";
import {
  isBlockingCourseFinding,
  resolveOfficialCourseLogoAsset,
} from "../studio/course-readiness-policy.mjs";

test("course readiness uses the owner-approved brand policy as the logo authority", () => {
  assert.equal(
    resolveOfficialCourseLogoAsset(officialBrand),
    officialBrand.officialLogo.assetPath,
  );
  assert.equal(
    resolveOfficialCourseLogoAsset(officialBrand),
    "brand/assets/obserra-official-logo.png",
  );
});

test("draft course findings remain visible but do not block Studio production readiness", () => {
  assert.equal(
    isBlockingCourseFinding({
      approved: false,
      finding: "duration-mismatch-240-vs-270",
    }),
    false,
  );
  assert.equal(
    isBlockingCourseFinding({
      approved: false,
      finding: "official-logo-mismatch",
    }),
    false,
  );
});

test("approved course quality defects fail closed", () => {
  assert.equal(
    isBlockingCourseFinding({
      approved: true,
      finding: "duration-mismatch-240-vs-270",
    }),
    true,
  );
  assert.equal(
    isBlockingCourseFinding({
      approved: true,
      finding: "official-logo-mismatch",
    }),
    true,
  );
});

test("generated-draft artifacts remain nonblocking even for approved courses", () => {
  assert.equal(
    isBlockingCourseFinding({
      approved: true,
      finding: "missing-ai-course-package",
    }),
    false,
  );
  assert.equal(
    isBlockingCourseFinding({
      approved: true,
      finding: "stale-ai-course-package",
    }),
    false,
  );
  assert.equal(
    isBlockingCourseFinding({
      approved: true,
      finding: "missing-generated-workbook.md",
    }),
    false,
  );
});
