const academyStudio = require("./academy-studio.cjs");

// The lifecycle controller was introduced after the original local Studio snapshot
// contract. Keep the legacy Studio UI unchanged while presenting the richer shapes
// expected by the lifecycle controller during module initialization.
const originalGetStudioSnapshot = academyStudio.getStudioSnapshot;
const originalRunStudioAction = academyStudio.runStudioAction;

function lifecycleStudioSnapshot() {
  const snapshot = originalGetStudioSnapshot();
  return {
    ...snapshot,
    courses: (snapshot.courses || []).map((course) => ({
      ...course,
      generation:
        course && typeof course.generation === "object" && course.generation !== null
          ? course.generation
          : { status: String(course?.generation || "not-generated") },
    })),
  };
}

async function lifecycleRunStudioAction(action, courseId) {
  const result = await originalRunStudioAction(action, courseId);
  return {
    ...result,
    // academy-course-control.cjs predates the current runStudioAction result name.
    // Preserve both fields so the lifecycle controller can fail closed correctly.
    code: result?.exitCode ?? null,
  };
}

academyStudio.getStudioSnapshot = lifecycleStudioSnapshot;
academyStudio.runStudioAction = lifecycleRunStudioAction;
const { createAcademyCourseControl } = require("./academy-course-control.cjs");
academyStudio.getStudioSnapshot = originalGetStudioSnapshot;
academyStudio.runStudioAction = originalRunStudioAction;

const { createAcademyRemoteCourseControl } = require("./academy-remote-course-control.cjs");
const { resolveStudioRoot, runStudioAction } = academyStudio;

function createAcademyCourseControlResolver({ store, safeStorage, app } = {}) {
  if (!store || !safeStorage || !app) {
    throw new Error("Academy course-control resolver dependencies are required.");
  }

  const local = createAcademyCourseControl({
    store,
    safeStorage,
    studioRootProvider: resolveStudioRoot,
  });
  const remote = createAcademyRemoteCourseControl({ store, safeStorage, app });

  function useLocal() {
    return Boolean(resolveStudioRoot());
  }

  function active() {
    return useLocal() ? local : remote;
  }

  async function snapshot() {
    const selected = active();
    const value = await selected.snapshot();
    return {
      ...value,
      controlMode: useLocal() ? "local-studio-workspace" : "github-remote-control",
      installedAnywhereReady: useLocal() || value?.available === true,
    };
  }

  async function runCourseAction(payload) {
    if (!useLocal()) return remote.runCourseAction(payload);
    const action = String(payload?.action || "").trim();
    const courseId = payload?.courseId || null;
    const result = await runStudioAction(action, courseId);
    return {
      ok: result.ok === true,
      state: result.ok === true ? "verified-success" : "failed",
      mode: "local-studio-workspace",
      result,
    };
  }

  return {
    snapshot,
    updateReview: (payload) => active().updateReview(payload),
    transitionCourse: (payload) => active().transitionCourse(payload),
    runCourseAction,
    listPurchases: (payload) => active().listPurchases(payload),
    verifyPurchase: (payload) => active().verifyPurchase(payload),
    commerceHealth: (options) => active().commerceHealth(options),
    publicationJobs: () => active().publicationJobs(),
    studioJobs: () => (typeof active().studioJobs === "function" ? active().studioJobs() : {}),
    ledger: (limit) => active().ledger(limit),
    mode: () => (useLocal() ? "local-studio-workspace" : "github-remote-control"),
  };
}

module.exports = { createAcademyCourseControlResolver };
