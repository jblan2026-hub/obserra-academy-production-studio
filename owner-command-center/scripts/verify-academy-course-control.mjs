import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(root, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const readRepository = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const control = read("electron/academy-course-control.cjs");
const remote = read("electron/academy-remote-course-control.cjs");
const resolver = read("electron/academy-course-control-resolver.cjs");
const preload = read("electron/preload.cjs");
const main = read("electron/main-with-remediation.cjs");
const html = read("src/index.html");
const ui = read("src/academy-control-ui.js");
const styles = read("src/styles.css");
const studioWorkflow = readRepository(".github/workflows/studio-console.yml");

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

assert.match(remote, /createAcademyRemoteCourseControl/);
assert.match(remote, /mode: "github-remote-control"/);
assert.match(remote, /git\/trees\/\$\{encodeURIComponent\(commitSha\)\}\?recursive=1/);
assert.match(remote, /course-manifest\\\.json/);
assert.match(remote, /MAX_BLOB_CONCURRENCY/);
assert.match(remote, /actions\/workflows\/\$\{STUDIO_WORKFLOW\}\/dispatches/);
assert.match(remote, /commit_generated_changes: "true"/);
assert.match(remote, /existingPurchaserAccessPreserved/);
assert.match(remote, /paid-pending-account-claim/);
assert.match(remote, /entitlement\?\.paymentReference === sessionId/);
assert.match(remote, /github-remote-control/);
assert.doesNotMatch(remote, /hardcoded-success|mock-success|fake-success/i);

assert.match(resolver, /createAcademyCourseControlResolver/);
assert.match(resolver, /resolveStudioRoot/);
assert.match(resolver, /installedAnywhereReady/);
assert.match(resolver, /local-studio-workspace/);
assert.match(resolver, /github-remote-control/);

for (const method of [
  "getAcademyControlSnapshot",
  "updateAcademyReview",
  "transitionAcademyCourse",
  "runAcademyControlledAction",
  "listAcademyPurchases",
  "verifyAcademyPurchase",
  "getAcademyCommerceHealth",
  "getAcademyPublicationJobs",
  "getAcademyStudioJobs",
  "getAcademyControlLedger",
]) {
  assert.match(preload, new RegExp(method));
}
assert.match(preload, /runAcademyAction: \(payload\) => ipcRenderer\.invoke\("academy:runControlledAction", payload\)/);

for (const channel of [
  "academy:getControlSnapshot",
  "academy:updateReview",
  "academy:transitionCourse",
  "academy:runControlledAction",
  "academy:listPurchases",
  "academy:verifyPurchase",
  "academy:getCommerceHealth",
  "academy:getPublicationJobs",
  "academy:getStudioJobs",
  "academy:getControlLedger",
]) {
  assert.match(main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(main, /createAcademyCourseControlResolver/);

for (const operation of [
  "author_course",
  "revise_course",
  "author_all",
  "build_all_drafts",
  "validate_all",
  "build_course_release",
  "publish_approved_catalog",
]) {
  assert.match(studioWorkflow, new RegExp(operation));
}
assert.match(studioWorkflow, /npm run author:course -- --course/);
assert.match(studioWorkflow, /npm run author:course -- --course .* --force/);
assert.match(studioWorkflow, /npm run author:all/);
assert.match(studioWorkflow, /commit_generated_changes/);

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

console.log("Academy course-control contract verification passed: local and installed-anywhere GitHub control, lifecycle, review, publication, Stripe payment, Clerk entitlement, raw errors, and provider readback are wired without hardcoded success.");
