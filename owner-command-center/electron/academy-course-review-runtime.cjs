const { app, ipcMain, safeStorage } = require("electron");

const { createAcademyCourseReview } = require("./academy-course-review.cjs");
const { getOwnerCommandCenterStore } = require("./store.cjs");

let registered = false;

function endpointSnapshotFromStore(store) {
  const enrollment = store.get("endpoint.enrollment") || null;
  const identity = store.get("endpoint.identity") || null;
  const receipt = store.get("endpoint.installationReceipt") || null;
  const lastHeartbeatAt = receipt?.verifiedAt || null;
  const heartbeatTime = Date.parse(String(lastHeartbeatAt || ""));
  const heartbeatFresh = Number.isFinite(heartbeatTime)
    && Date.now() - heartbeatTime >= 0
    && Date.now() - heartbeatTime <= 90000;
  const enrolled = enrollment?.state === "enrolled"
    && Boolean(enrollment.deviceId)
    && Boolean(enrollment.deviceFingerprint)
    && Boolean(identity?.encryptedSecret);
  return {
    endpointReady: enrolled && heartbeatFresh,
    enrollment: enrollment || { state: "not-enrolled" },
    deviceId: enrollment?.deviceId || identity?.deviceId || null,
    deviceFingerprint: enrollment?.deviceFingerprint || null,
    lastHeartbeatAt,
  };
}

function registerAcademyCourseReviewRuntime() {
  if (registered) return;
  registered = true;
  const store = getOwnerCommandCenterStore();
  const endpointRuntime = {
    getSnapshot: () => endpointSnapshotFromStore(store),
  };
  const review = createAcademyCourseReview({
    store,
    safeStorage,
    endpointRuntime,
  });

  for (const channel of [
    "academy:getCourseReview",
    "academy:getCourseMedia",
    "academy:recordCourseDecision",
  ]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle(
    "academy:getCourseReview",
    async (_event, courseId) => review.getCourseReview(courseId),
  );
  ipcMain.handle(
    "academy:getCourseMedia",
    async (_event, payload) => review.getMediaAssetUrl(
      payload?.courseId,
      payload?.assetId,
    ),
  );
  ipcMain.handle(
    "academy:recordCourseDecision",
    async (_event, payload) => review.recordDecision(payload),
  );
}

app.whenReady().then(registerAcademyCourseReviewRuntime);

module.exports = {
  endpointSnapshotFromStore,
  registerAcademyCourseReviewRuntime,
};
