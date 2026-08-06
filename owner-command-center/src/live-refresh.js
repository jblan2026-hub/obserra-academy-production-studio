const LIVE_REFRESH_INTERVAL_MS = 15000;

async function refreshAllVisibleCommandCenterState() {
  const tasks = [];
  if (typeof probeAll === "function") tasks.push(probeAll());
  if (typeof refreshAcademy === "function") tasks.push(refreshAcademy());
  await Promise.allSettled(tasks);
}

setInterval(() => {
  refreshAllVisibleCommandCenterState().catch(() => {});
}, LIVE_REFRESH_INTERVAL_MS);
