const batchLog = document.getElementById("academyActionLog");
let batchRunning = false;

function writeBatchLog(message, state = "info") {
  const entry = document.createElement("div");
  entry.className = `logEntry ${state}`;
  entry.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  batchLog.prepend(entry);
}

async function runBatch(action, label) {
  if (batchRunning) return;
  batchRunning = true;
  const buttons = document.querySelectorAll("[data-batch-action]");
  buttons.forEach((button) => { button.disabled = true; });
  writeBatchLog(`${label} started.`);
  try {
    const result = await window.obserraOwner.runAcademyAction({ action });
    writeBatchLog(`${label} ${result.ok ? "completed" : "failed"}${result.exitCode === null ? "" : ` with exit code ${result.exitCode}`}.`, result.ok ? "ok" : "error");
    if (result.stderr) writeBatchLog(result.stderr.slice(-3000), "error");
    if (result.stdout) writeBatchLog(result.stdout.slice(-3000), "info");
    document.getElementById("academyRefresh").click();
  } catch (error) {
    writeBatchLog(error.message || String(error), "error");
  } finally {
    batchRunning = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.getElementById("academyGenerateAll").addEventListener("click", () => runBatch("author-all", "Generate all pending courses"));
document.getElementById("academyBuildAll").addEventListener("click", () => runBatch("build-all", "Build all release-ready courses"));
