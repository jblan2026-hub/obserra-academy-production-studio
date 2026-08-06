const remediationMetrics = document.getElementById("remediationMetrics");
const remediationQueueList = document.getElementById("remediationQueueList");
const remediationExecutions = document.getElementById("remediationExecutions");
const remediationStatus = document.getElementById("remediationStatus");

function remediationMetric(label, value) {
  const card = document.createElement("div");
  card.className = "metric";
  const name = document.createElement("span");
  name.textContent = label;
  const result = document.createElement("strong");
  result.textContent = String(value);
  card.append(name, result);
  return card;
}

function remediationEmpty(container, text) {
  const item = document.createElement("article");
  item.className = "gapItem clear";
  item.textContent = text;
  container.append(item);
}

async function refreshRemediationQueue() {
  const snapshot = await window.obserraOwner.getRemediationSnapshot();
  remediationMetrics.replaceChildren(...[
    ["Total proposals", snapshot.proposalCount || 0],
    ["Pending owner approval", snapshot.pendingCount || 0],
    ["Approved", snapshot.approvedCount || 0],
    ["Executing", snapshot.executingCount || 0],
    ["Draft PRs", snapshot.draftPrCount || 0],
    ["Failed and rolled back", snapshot.failedRollbackCount || 0]
  ].map(([label, value]) => remediationMetric(label, value)));

  remediationStatus.textContent = snapshot.updatedAt
    ? `Queue updated ${new Date(snapshot.updatedAt).toLocaleString()}`
    : "No remediation proposals have been recorded.";

  remediationQueueList.replaceChildren();
  for (const proposal of snapshot.proposals || []) {
    const item = document.createElement("article");
    item.className = `gapItem ${proposal.severity === "critical" ? "critical" : "high"}`;
    const title = document.createElement("strong");
    title.textContent = `${proposal.target} · ${proposal.title || proposal.findingId}`;
    const detail = document.createElement("span");
    detail.textContent = `${proposal.status} · ${(proposal.mappings || []).join(", ")} · ${proposal.files?.length || 0} file(s)`;
    const actions = document.createElement("div");
    actions.className = "actions";

    if (proposal.status === "pending-owner-approval") {
      for (const decision of ["approved", "rejected"]) {
        const button = document.createElement("button");
        button.className = decision === "approved" ? "secondary" : "";
        button.textContent = decision === "approved" ? "Approve patch" : "Reject";
        button.addEventListener("click", async () => {
          const note = window.prompt(`Decision note for ${proposal.title || proposal.findingId}`, "Reviewed by owner");
          if (!note) return;
          await window.obserraOwner.decideRemediation({ proposalId: proposal.id, decision, note });
          await refreshRemediationQueue();
        });
        actions.append(button);
      }
    }

    if (proposal.status === "approved-for-execution") {
      const execute = document.createElement("button");
      execute.textContent = "Validate and create draft PR";
      execute.addEventListener("click", async () => {
        const confirmed = window.confirm("Run repository validation, create an isolated remediation branch, push it, and open a draft PR? Production will not be changed automatically.");
        if (!confirmed) return;
        remediationStatus.textContent = `Executing remediation ${proposal.id}…`;
        try {
          await window.obserraOwner.executeRemediation(proposal.id);
        } catch (error) {
          remediationStatus.textContent = `Remediation failed and rollback was requested: ${error.message || String(error)}`;
        }
        await refreshRemediationQueue();
      });
      actions.append(execute);
    }

    if (proposal.status === "draft-pr-created") {
      const execution = (snapshot.executions || []).find((entry) => entry.id === proposal.executionId);
      const url = execution?.result?.pullRequestUrl;
      const evidence = document.createElement("span");
      evidence.textContent = url ? `Draft PR created: ${url}` : "Draft PR created. Review GitHub evidence before merge.";
      item.append(title, detail, evidence, actions);
    } else {
      item.append(title, detail, actions);
    }
    remediationQueueList.append(item);
  }
  if (!(snapshot.proposals || []).length) remediationEmpty(remediationQueueList, "No known-bad vulnerability is awaiting remediation approval.");

  remediationExecutions.replaceChildren();
  for (const execution of snapshot.executions || []) {
    const item = document.createElement("article");
    item.className = `gapItem ${execution.status === "failed-rolled-back" ? "critical" : "medium"}`;
    const title = document.createElement("strong");
    title.textContent = `${execution.target} · ${execution.status}`;
    const detail = document.createElement("span");
    detail.textContent = execution.error || execution.result?.evidenceDigest || `Execution ${execution.id}`;
    item.append(title, detail);
    remediationExecutions.append(item);
  }
  if (!(snapshot.executions || []).length) remediationEmpty(remediationExecutions, "No remediation execution evidence is available.");
}

document.getElementById("remediationRefresh").addEventListener("click", () => refreshRemediationQueue().catch((error) => {
  remediationStatus.textContent = `Remediation queue unavailable: ${error.message || String(error)}`;
}));

refreshRemediationQueue().catch((error) => {
  remediationStatus.textContent = `Remediation queue unavailable: ${error.message || String(error)}`;
});
setInterval(() => refreshRemediationQueue().catch(() => {}), 15000);
