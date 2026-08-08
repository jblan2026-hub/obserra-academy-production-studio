import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { studioActionArgs, actionTimeoutMs } = require("../electron/academy-studio.cjs");

const courseId = "cybersecurity-foundations";

assert.deepEqual(studioActionArgs("author", courseId), ["run", "author:course", "--", "--course", courseId]);
assert.deepEqual(studioActionArgs("revise", courseId), ["run", "author:course", "--", "--course", courseId, "--force"]);
assert.deepEqual(studioActionArgs("build", courseId), ["run", "build:course", "--", "--course", courseId]);

assert.deepEqual(studioActionArgs("author-all"), ["run", "author:all"]);
assert.deepEqual(studioActionArgs("build-all"), ["run", "build:all"]);
assert.deepEqual(studioActionArgs("catalog"), ["run", "catalog"]);
assert.deepEqual(studioActionArgs("verify"), ["run", "verify:70x"]);

assert.throws(() => studioActionArgs("author"), /Invalid course identifier/);
assert.throws(() => studioActionArgs("build", "../unsafe"), /Invalid course identifier/);
assert.throws(() => studioActionArgs("unsupported"), /Unsupported Studio action/);

const previousTimeout = process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
try {
  delete process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
  assert.equal(actionTimeoutMs("catalog"), 10 * 60 * 1000);
  assert.equal(actionTimeoutMs("author"), 30 * 60 * 1000);
  assert.equal(actionTimeoutMs("author-all"), 180 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = "1";
  assert.equal(actionTimeoutMs("verify"), 2 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = String(24 * 60 * 60 * 1000);
  assert.equal(actionTimeoutMs("verify"), 4 * 60 * 60 * 1000);

  process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = "not-a-number";
  assert.equal(actionTimeoutMs("build-all"), 60 * 60 * 1000);
} finally {
  if (previousTimeout === undefined) delete process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS;
  else process.env.ACADEMY_COMMAND_CENTER_ACTION_TIMEOUT_MS = previousTimeout;
}

console.log("[Owner Command Center] Academy action dispatch and timeout runtime verification passed.");
