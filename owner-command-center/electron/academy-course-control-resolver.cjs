const { createAcademyCourseControl } = require("./academy-course-control.cjs");
const { createAcademyRemoteCourseControl } = require("./academy-remote-course-control.cjs");
const { resolveStudioRoot, runStudioAction } = require("./academy-studio.cjs");

function createAcademyCourseControlResolver({ store, safeStorage, app } = {}) {
  if (!store || !safeStorage || !app) throw new Error("Academy course-control resolver dependencies are required.");

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
