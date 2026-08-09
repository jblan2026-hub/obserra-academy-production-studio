import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("legacy accelerated authoring is guarded and cannot compete with the zero-cost course lane", () => {
  const workflow = read(
    ".github/workflows/accelerated-protected-course-build.yml",
  );

  assert.match(workflow, /Legacy Academy route guard/);
  assert.match(workflow, /Reject legacy paid or public-artifact Academy route/);
  assert.match(workflow, /academy-zero-cost-sharded-completion\.yml/);
  assert.match(workflow, /local deterministic research/);
  assert.match(workflow, /local Ollama authoring/);
  assert.match(workflow, /private backup only/);
  assert.match(workflow, /no commercial fallback/);
  assert.match(workflow, /no protected public artifacts/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY/);
  assert.doesNotMatch(workflow, /ACADEMY_AUTHORING_PROVIDER:\s*openai/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /id:\s*initial_authoring/);
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
