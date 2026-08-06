const { app, ipcMain } = require("electron");
const Store = require("electron-store");
const { createRemediationQueue } = require("./remediation-queue.cjs");

const store = new Store({ name: "owner-command-center" });
const remediationQueue = createRemediationQueue(store);

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is required`);
  return value;
}

app.whenReady().then(() => {
  ipcMain.handle("remediation:getSnapshot", async () => remediationQueue.snapshot());
  ipcMain.handle("remediation:propose", async (_event, payload) => {
    const request = requireObject(payload, "Remediation proposal");
    return remediationQueue.propose(
      requireObject(request.finding, "Known-bad finding"),
      String(request.target || ""),
      Array.isArray(request.files) ? request.files : [],
    );
  });
  ipcMain.handle("remediation:decide", async (_event, payload) => {
    const request = requireObject(payload, "Remediation decision");
    return remediationQueue.decide(String(request.proposalId || ""), String(request.decision || ""), String(request.note || ""));
  });
  ipcMain.handle("remediation:execute", async (_event, proposalId) => remediationQueue.execute(String(proposalId || "")));
});

require("./main.cjs");
