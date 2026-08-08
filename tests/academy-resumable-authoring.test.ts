import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("initial Academy authoring can continue into selective repair", () => {
  const workflow = read(
    ".github/workflows/accelerated-protected-course-build.yml",
  );

  assert.match(workflow, /id: initial_authoring/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(
    workflow,
    /Validate and selectively repair every incomplete package/,
  );
  assert.match(workflow, /if: always\(\) && !cancelled\(\)/);
  assert.match(workflow, /ACADEMY_AUTHORING_CONCURRENCY: 12/);
  assert.match(workflow, /ACADEMY_AUTHORING_REPAIR_CONCURRENCY: 6/);
  assert.match(workflow, /Course worker allocation: 16/);
});

test("authoring targets above the quality floor and preserves partial evidence", () => {
  const authoring = read("studio/author-course-ai.mjs");

  assert.match(authoring, /ACADEMY_AUTHORING_NARRATIVE_TARGET_WORDS/);
  assert.match(authoring, /1500/);
  assert.match(authoring, /requiredFinalAssessmentQuestions\(manifest\)/);
  assert.match(authoring, /max_output_tokens: openAiMaxOutputTokens/);
  assert.match(authoring, /course-package\.partial\.json/);
  assert.match(authoring, /state: "validation-failed"/);
  assert.match(authoring, /academyAuthoringQualityContract\(manifest\)/);
  assert.doesNotMatch(authoring, /lessonNarrativeWords:\s*700/);
  assert.doesNotMatch(authoring, /finalAssessmentQuestions:\s*25/);
});

test("repair uses partial package diagnostics and lower provider pressure", () => {
  const repair = read("studio/validate-and-repair-authored-packages.mjs");

  assert.match(repair, /course-package\.partial\.json/);
  assert.match(repair, /partial-authored-package-requires-repair/);
  assert.match(repair, /repairConcurrency/);
  assert.match(repair, /ACADEMY_AUTHORING_REPAIR_NARRATIVE_TARGET_WORDS/);
  assert.match(repair, /OPENAI_PMP_MAX_OUTPUT_TOKENS/);
  assert.match(repair, /OPENAI_REPAIR_REASONING_EFFORT/);
  assert.match(repair, /schemaVersion: "2\.1"/);
});
