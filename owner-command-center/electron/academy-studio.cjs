const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const ALLOWED_ACTIONS = new Set(["author", "author-all", "build", "build-all", "catalog", "verify"]);
const ALLOWED_RELEASE_STATUSES = new Set(["draft", "in-review", "approved", "published", "retired"]);

function workspaceCandidates() {
  const home = os.homedir();
  return [
    process.env.OBSERRA_ACADEMY_STUDIO_ROOT,
    path.resolve(__dirname, "../.."),
    path.join(home, "source", "repos", "obserra-academy-production-studio"),
    path.join(home, "Documents", "GitHub", "obserra-academy-production-studio"),
    path.join(home, "GitHub", "obserra-academy-production-studio")
  ].filter(Boolean);
}

function isStudioRoot(candidate) {
  return Boolean(candidate && fs.existsSync(path.join(candidate, "package.json")) && fs.existsSync(path.join(candidate, "courses")) && fs.existsSync(path.join(candidate, "studio")));
}

function resolveStudioRoot() {
  const configured = workspaceCandidates().find(isStudioRoot);
  return configured ? fs.realpathSync(configured) : null;
}

function assertCourseId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,120}$/.test(value)) throw new Error("Invalid course identifier");
  return value;
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}
function fileExists(root, ...segments) { return fs.existsSync(path.join(root, ...segments)); }

function summarizeCourse(root, courseId) {
  const courseRoot = path.join(root, "courses", assertCourseId(courseId));
  const manifestPath = path.join(courseRoot, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  const queuePath = path.join(courseRoot, "production-queue.json");
  const queue = fs.existsSync(queuePath) ? readJson(queuePath) : null;
  const generatedPackage = path.join(courseRoot, "generated", "authoring", "course-package.json");
  const finalRelease = path.join(root, "releases", courseId, "FINAL", "release-record.json");
  const requiredArtifacts = queue?.requiredArtifacts || ["instructor-manuscript.md", "learner-guide.md", "assessment-bank.json", "answer-key.json"];
  const artifactStatus = requiredArtifacts.map((artifact) => ({ artifact, present: fileExists(courseRoot, artifact) }));
  const reviewEntries = Object.entries(manifest.reviews || {}).map(([name, review]) => ({ name, required: review.required !== false, status: review.status || "not-started", reviewedBy: review.reviewedBy || null, reviewedAt: review.reviewedAt || null }));
  const requiredReviews = reviewEntries.filter((review) => review.required);
  const completedReviews = requiredReviews.filter((review) => ["approved", "complete", "completed"].includes(review.status));
  const missingArtifacts = artifactStatus.filter((item) => !item.present).map((item) => item.artifact);
  const recommendations = [];
  if (!fs.existsSync(generatedPackage)) recommendations.push("Generate the governed AI course package.");
  if (missingArtifacts.length) recommendations.push(`Create missing release artifacts: ${missingArtifacts.join(", ")}.`);
  if (completedReviews.length < requiredReviews.length) recommendations.push(`Complete ${requiredReviews.length - completedReviews.length} required review(s).`);
  if (!manifest.commerce?.stripePriceId && !manifest.commerce?.paymentLink) recommendations.push("Configure a Stripe price or governed payment link before publication.");
  if (!manifest.release?.publishToAcademy) recommendations.push("Keep publication disabled until generation, review, and release evidence are complete.");
  return {
    id: manifest.course.id,
    title: manifest.course.title,
    department: manifest.course.department,
    level: manifest.course.level,
    track: manifest.course.track,
    description: manifest.course.description,
    duration: manifest.course.duration,
    price: manifest.commerce?.price ?? null,
    currency: manifest.commerce?.currency ?? "USD",
    moduleCount: Array.isArray(manifest.course.modules) ? manifest.course.modules.length : 0,
    releaseStatus: manifest.release?.status || "draft",
    publishToAcademy: manifest.release?.publishToAcademy === true,
    version: manifest.release?.version || "0.0.0",
    generation: fs.existsSync(generatedPackage) ? "generated" : "not-generated",
    finalRelease: fs.existsSync(finalRelease),
    queueStatus: queue?.status || "not-queued",
    artifacts: artifactStatus,
    missingArtifacts,
    reviews: reviewEntries,
    reviewCompletion: requiredReviews.length ? Math.round((completedReviews.length / requiredReviews.length) * 100) : 100,
    recommendations
  };
}

function getStudioSnapshot() {
  const root = resolveStudioRoot();
  if (!root) return { available: false, mode: "detached", root: null, courses: [], summary: { total: 0, generated: 0, published: 0, reviewReady: 0, gaps: 1 }, gaps: ["Academy Studio workspace was not found. Set OBSERRA_ACADEMY_STUDIO_ROOT to the local repository path."] };
  const courses = fs.readdirSync(path.join(root, "courses"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => summarizeCourse(root, entry.name)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  const notGenerated = courses.filter((course) => course.generation !== "generated").length;
  const unpublished = courses.filter((course) => !course.publishToAcademy).length;
  const missingRelease = courses.filter((course) => !course.finalRelease).length;
  const gaps = [];
  if (!courses.length) gaps.push("No course manifests are available.");
  if (notGenerated) gaps.push(`${notGenerated} course(s) have no governed AI-authored package.`);
  if (missingRelease) gaps.push(`${missingRelease} course(s) have no FINAL release record.`);
  if (unpublished) gaps.push(`${unpublished} course(s) are not approved for Academy publication.`);
  return {
    available: true,
    mode: "local-workspace",
    root,
    checkedAt: new Date().toISOString(),
    courses,
    summary: {
      total: courses.length,
      generated: courses.filter((course) => course.generation === "generated").length,
      published: courses.filter((course) => course.publishToAcademy && ["approved", "published"].includes(course.releaseStatus)).length,
      reviewReady: courses.filter((course) => course.generation === "generated" && course.missingArtifacts.length === 0).length,
      gaps: courses.reduce((count, course) => count + course.recommendations.length, 0)
    },
    gaps
  };
}

function updateCourseMetadata(payload) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");
  const courseId = assertCourseId(payload?.courseId);
  const manifestPath = path.join(root, "courses", courseId, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Course manifest not found");
  const manifest = readJson(manifestPath);
  const updates = payload?.updates || {};
  if (typeof updates.title === "string" && updates.title.trim()) manifest.course.title = updates.title.trim();
  if (typeof updates.description === "string" && updates.description.trim()) manifest.course.description = updates.description.trim();
  if (typeof updates.duration === "string" && updates.duration.trim()) manifest.course.duration = updates.duration.trim();
  if (Number.isFinite(updates.price) && updates.price >= 0) manifest.commerce.price = Number(updates.price);
  if (typeof updates.releaseStatus === "string") {
    if (!ALLOWED_RELEASE_STATUSES.has(updates.releaseStatus)) throw new Error("Unsupported release status");
    manifest.release.status = updates.releaseStatus;
  }
  if (typeof updates.publishToAcademy === "boolean") {
    if (updates.publishToAcademy && !["approved", "published"].includes(manifest.release.status)) throw new Error("Only approved or published courses may be enabled for Academy publication");
    manifest.release.publishToAcademy = updates.publishToAcademy;
  }
  atomicWriteJson(manifestPath, manifest);
  return summarizeCourse(root, courseId);
}

function runStudioAction(action, courseId) {
  const root = resolveStudioRoot();
  if (!root) throw new Error("Academy Studio workspace is unavailable");
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("Unsupported Studio action");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const commandMap = {
    author: ["run", "author:course", "--", "--course", assertCourseId(courseId)],
    "author-all": ["run", "author:all"],
    build: ["run", "build:course", "--", "--course", assertCourseId(courseId)],
    "build-all": ["run", "build:all"],
    catalog: ["run", "catalog"],
    verify: ["run", "verify:70x"]
  };
  const args = commandMap[action];
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(npmCommand, args, { cwd: root, env: { ...process.env }, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-100000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-100000); });
    child.on("error", (error) => resolve({ ok: false, action, courseId: courseId || null, startedAt, completedAt: new Date().toISOString(), exitCode: null, stdout, stderr: error.message }));
    child.on("close", (exitCode) => resolve({ ok: exitCode === 0, action, courseId: courseId || null, startedAt, completedAt: new Date().toISOString(), exitCode, stdout, stderr }));
  });
}

module.exports = { getStudioSnapshot, updateCourseMetadata, runStudioAction, resolveStudioRoot };
