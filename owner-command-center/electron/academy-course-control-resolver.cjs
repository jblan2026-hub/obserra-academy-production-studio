const academyStudio = require("./academy-studio.cjs");
const { ownerSafe, ownerSafeError } = require("./academy-data-protection.cjs");

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

  async function safeInvoke(operation) {
    try {
      return ownerSafe(await operation());
    } catch (error) {
      throw new Error(ownerSafeError(error));
    }
  }

  async function snapshot() {
    return safeInvoke(async () => {
      const value = await active().snapshot();
      return {
        ...value,
        controlMode: useLocal() ? "local-studio-workspace" : "github-remote-control",
        installedAnywhereReady: useLocal() || value?.available === true,
        privacyBoundary:
          "Owner UI receives redacted, minimum-necessary operational metadata. Secrets, cookies, tokens, card data, payment-method details, and direct customer/student contact data are removed before renderer delivery.",
      };
    });
  }

  async function runCourseAction(payload) {
    return safeInvoke(async () => {
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
    });
  }

  return {
    snapshot,
    updateReview: (payload) => safeInvoke(() => active().updateReview(payload)),
    transitionCourse: (payload) => safeInvoke(() => active().transitionCourse(payload)),
    runCourseAction,
    listPurchases: (payload) => safeInvoke(() => active().listPurchases(payload)),
    verifyPurchase: (payload) => safeInvoke(() => active().verifyPurchase(payload)),
    commerceHealth: (options) => safeInvoke(() => active().commerceHealth(options)),
    publicationJobs: () => ownerSafe(active().publicationJobs()),
    studioJobs: () => ownerSafe(typeof active().studioJobs === "function" ? active().studioJobs() : {}),
    ledger: (limit) => ownerSafe(active().ledger(limit)),
    mode: () => (useLocal() ? "local-studio-workspace" : "github-remote-control"),
  };
}

module.exports = { createAcademyCourseControlResolver };
