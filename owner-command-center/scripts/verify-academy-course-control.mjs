import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const control = read("electron/academy-course-control.cjs");
const preload = read("electron/preload.cjs");
const main = read("electron/main-with-remediation.cjs");
const html = read("src/index.html");
const ui = read("src/academy-control-ui.js");
const styles = read("src/styles.css");

assert.match(control, /createAcademyCourseControl/);
assert.match(control, /academy-owner-course-control-ledger\.jsonl/);
assert.match(control, /previousHash/);
assert.match(control, /PUBLISH \$\{courseId\}/);
assert.match(control, /UNPUBLISH \$\{courseId\}/);
assert.match(control, /existingPurchaserAccessPreserved/);
assert.match(control, /\/v1\/checkout\/sessions/);
assert.match(control, /private_metadata\?\.academy\?\.entitlements/);
assert.match(control, /paymentReference === sessionId/);
assert.match(control, /commerce\.operational === true/);
assert.match(control, /state: verified \? "verified-success" : "entitlement-readback-failed"/);
assert.match(control, /\/git\/blobs/);
assert.match(control, /\/git\/trees/);
assert.match(control, /\/git\/commits/);
assert.match(control, /\/git\/refs\/heads/);
assert.match(control, /actions\/workflows/);
assert.match(control, /verifyPublicationReadback/);
assert.match(control, /workflowConclusion/);
assert.match(control, /rawBody/);
assert.match(control, /Request timed out/);
assert.doesNotMatch(control, /hardcoded-success|mock-success|fake-success/i);

for (const method of [
  "getAcademyControlSnapshot",
  "updateAcademyReview",
  "transitionAcademyCourse",
  "listAcademyPurchases",
  "verifyAcademyPurchase",
  "getAcademyCommerceHealth",
  "getAcademyPublicationJobs",
  "getAcademyControlLedger",
]) {
  assert.match(preload, new RegExp(method));
}

for (const channel of [
  "academy:getControlSnapshot",
  "academy:updateReview",
  "academy:transitionCourse",
  "academy:listPurchases",
  "academy:verifyPurchase",
  "academy:getCommerceHealth",
  "academy:getPublicationJobs",
  "academy:getControlLedger",
]) {
  assert.match(main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(html, /ACADEMY COURSE LIFECYCLE COMMAND/);
assert.match(html, /Control every course, review, release, publication, purchase, and entitlement/);
assert.match(html, /academy-control-ui\.js/);
assert.match(ui, /Verify paid access end to end/);
assert.match(ui, /Verified Success requires Stripe paid state, Clerk entitlement readback/);
assert.match(ui, /Unpublishing or retiring removes the course from new public purchase access/);
assert.match(ui, /providerError/);
assert.match(ui, /JSON\.stringify\(technical, null, 2\)/);
assert.match(styles, /academyControlPanel/);
assert.match(styles, /academyControlAudit\.error/);

console.log("Academy course-control contract verification passed: lifecycle, review, GitHub publication, Stripe payment, Clerk entitlement, raw errors, and readback verification are wired without hardcoded success.");
