import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORING_POLICY_VERSION,
  authoringPackageHash,
  authoringSourceHash,
  checkpointsRequired,
  validateAuthoringEnvelope,
} from "../studio/authoring-checkpoints.mjs";

function manifest() {
  return {
    course: {
      id: "secure-leadership",
      title: "Secure Leadership",
      modules: [{ id: "module-1", title: "Governed decisions" }],
    },
    completion: { passingScore: 80 },
  };
}

function envelope(sourceManifestHash: string) {
  return {
    schemaVersion: "1.2",
    courseId: "secure-leadership",
    provider: "openai",
    model: "gpt-5",
    authoringPolicyVersion: AUTHORING_POLICY_VERSION,
    generatedAt: "2026-08-07T00:00:00.000Z",
    sourceManifestHash,
    reviewStatus: "draft-ai-generated",
    legalName: "OBSERRA EXECUTIVE PROTECTION & INTELLIGENCE LLC",
    proprietaryNotice: "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.",
    content: { modules: [] },
  };
}

test("authoring source hashes are deterministic and policy bound", () => {
  const source = manifest();
  const first = authoringSourceHash(source);
  const second = authoringSourceHash(source);

  assert.equal(first, second);
  assert.notEqual(first, authoringSourceHash(source, "older-policy"));
  assert.notEqual(first, authoringSourceHash({ ...source, completion: { passingScore: 90 } }));
});

test("matching protected authoring envelope validates with an integrity hash", () => {
  const source = manifest();
  const authored = envelope(authoringSourceHash(source));
  const result = validateAuthoringEnvelope({
    courseId: "secure-leadership",
    envelope: authored,
    manifest: source,
  });

  assert.equal(result.courseId, "secure-leadership");
  assert.equal(result.expectedManifestHash, authored.sourceManifestHash);
  assert.equal(result.packageHash, authoringPackageHash(authored));
});

test("stale, mis-scoped, or review-invalid checkpoints fail closed", () => {
  const source = manifest();
  const valid = envelope(authoringSourceHash(source));

  assert.throws(
    () => validateAuthoringEnvelope({
      courseId: "other-course",
      envelope: valid,
      manifest: source,
    }),
    /course identity mismatch/,
  );
  assert.throws(
    () => validateAuthoringEnvelope({
      courseId: "secure-leadership",
      envelope: { ...valid, sourceManifestHash: "0".repeat(64) },
      manifest: source,
    }),
    /manifest integrity mismatch/,
  );
  assert.throws(
    () => validateAuthoringEnvelope({
      courseId: "secure-leadership",
      envelope: { ...valid, authoringPolicyVersion: "older-policy" },
      manifest: source,
    }),
    /policy mismatch/,
  );
  assert.throws(
    () => validateAuthoringEnvelope({
      courseId: "secure-leadership",
      envelope: { ...valid, reviewStatus: "approved" },
      manifest: source,
    }),
    /review status is invalid/,
  );
});

test("checkpoint-required mode uses an exact controlled boolean vocabulary", () => {
  const original = process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED;
  try {
    process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED = "true";
    assert.equal(checkpointsRequired(), true);
    process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED = "1";
    assert.equal(checkpointsRequired(), true);
    process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED = "false";
    assert.equal(checkpointsRequired(), false);
    process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED = "unexpected";
    assert.equal(checkpointsRequired(), false);
  } finally {
    if (original === undefined) delete process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED;
    else process.env.ACADEMY_AUTHORING_CHECKPOINTS_REQUIRED = original;
  }
});
