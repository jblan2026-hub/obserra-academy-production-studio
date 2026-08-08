import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  actionTimeoutMs,
  assertPublicationEligible,
  studioActionArgs,
} = require("../electron/academy-studio.cjs");

const courseId = "cybersecurity-foundations";

assert.deepEqual(
  studioActionArgs("author", courseId),
  ["run", "author:course", "--", "--course", courseId],
);
assert.deepEqual(
  studioActionArgs("revise", courseId),
  ["run", "author:course", "--", "--course", courseId, "--force"],
);
assert.deepEqual(
  studioActionArgs("build", courseId),
  ["run", "build:course", "--", "--course", courseId],
);
assert.deepEqual(studioActionArgs("author-all"), ["run", "author:parallel"]);
assert.deepEqual(studioActionArgs("build-all"), ["run", "build:all"]);
assert.deepEqual(studioActionArgs("stage-all"), ["run", "stage:courses"]);
assert.deepEqual(studioActionArgs("source-queue"), ["run", "collect:sources"]);
assert.deepEqual(
  studioActionArgs("release-check"),
  ["run", "validate:commercial-release"],
);
assert.deepEqual(studioActionArgs("catalog"), ["run", "catalog"]);
assert.deepEqual(studioActionArgs("verify"), ["run", "verify:protected"]);

assert.throws(() => studioActionArgs("author"), /Invalid course identifier/);
assert.throws(() => studioActionArgs("build", "../unsafe"), /Invalid course identifier/);
assert.throws(() => studioActionArgs("finalize", courseId), /Unsupported Studio action/);
assert.throws(() => studioActionArgs("publish", courseId), /Unsupported Studio action/);

const previousTimeout = process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
try {
  delete process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
  assert.equal(actionTimeoutMs("catalog"), 15 * 60 * 1000);
  assert.equal(actionTimeoutMs("author"), 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("author-all"), 4 * 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("stage-all"), 3 * 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("release-check"), 60 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = "1";
  assert.equal(actionTimeoutMs("verify"), 2 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = String(24 * 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("verify"), 4 * 60 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = "not-a-number";
  assert.equal(actionTimeoutMs("build-all"), 2 * 60 * 60 * 1000);
} finally {
  if (previousTimeout === undefined) delete process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
  else process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = previousTimeout;
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "obserra-publication-gate-"));
try {
  const courseRoot = path.join(temporaryRoot, "courses", courseId);
  const finalRoot = path.join(temporaryRoot, "releases", courseId, "FINAL");
  fs.mkdirSync(courseRoot, { recursive: true });
  fs.mkdirSync(finalRoot, { recursive: true });
  const manifest = {
    release: { status: "approved", publishToAcademy: false },
  };

  assert.throws(
    () => assertPublicationEligible(temporaryRoot, courseId, manifest),
    /valid FINAL governed package/,
  );

  fs.writeFileSync(
    path.join(finalRoot, "release-record.json"),
    JSON.stringify({
      packageStage: "FINAL",
      qualityClaimAllowed: true,
    }),
  );
  assert.throws(
    () => assertPublicationEligible(temporaryRoot, courseId, manifest),
    /accepted commercial release evidence/,
  );

  fs.writeFileSync(
    path.join(courseRoot, "commercial-release-evidence.json"),
    JSON.stringify({
      accepted: true,
      ownerAcceptance: { decision: "approved" },
      referenceResolution: { unresolvedExternalReferences: 0 },
      mediaInventory: { missingRequiredAssets: 0 },
    }),
  );
  const eligible = assertPublicationEligible(temporaryRoot, courseId, manifest);
  assert.equal(eligible.eligible, true);

  assert.throws(
    () => assertPublicationEligible(
      temporaryRoot,
      courseId,
      { release: { status: "draft", publishToAcademy: false } },
    ),
    /approved or published release status/,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "[Owner Command Center] Academy governed action dispatch, timeout, and publication evidence gates passed.",
);
