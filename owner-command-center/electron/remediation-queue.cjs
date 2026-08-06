const crypto = require("node:crypto");
const { createRemediationProposal, executeApprovedRemediation } = require("./ai-remediation.cjs");

const STORE_KEY = "remediation.queue";
const MAX_RECORDS = 5000;

function id(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(`${Date.now()}:${Math.random()}:${value}`).digest("hex").slice(0, 16)}`;
}

function createRemediationQueue(store) {
  function read() {
    const current = store.get(STORE_KEY);
    return current && current.schemaVersion === "1.0"
      ? current
      : { schemaVersion: "1.0", proposals: [], executions: [], updatedAt: null };
  }

  function write(state) {
    state.proposals = state.proposals.slice(-MAX_RECORDS);
    state.executions = state.executions.slice(-MAX_RECORDS);
    state.updatedAt = new Date().toISOString();
    store.set(STORE_KEY, state);
    return state;
  }

  function propose(finding, target, files) {
    if (finding?.knownBad !== true) throw new Error("Only mapped known-bad findings can enter automated remediation");
    const proposal = {
      ...createRemediationProposal(finding, target, files),
      id: id("proposal", finding?.id || finding?.type || target),
      createdAt: new Date().toISOString(),
      status: "pending-owner-approval",
      approval: null,
      executionId: null
    };
    const state = read();
    state.proposals.push(proposal);
    write(state);
    return proposal;
  }

  function decide(proposalId, decision, note) {
    if (!["approved", "rejected"].includes(decision)) throw new Error("Decision must be approved or rejected");
    if (!String(note || "").trim()) throw new Error("Owner decision note is required");
    const state = read();
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error("Remediation proposal not found");
    if (proposal.status !== "pending-owner-approval") throw new Error("Remediation proposal is no longer pending");
    proposal.approval = { id: id("approval", proposalId), decision, note: String(note).trim(), decidedAt: new Date().toISOString() };
    proposal.status = decision === "approved" ? "approved-for-execution" : "rejected";
    write(state);
    return proposal;
  }

  async function execute(proposalId) {
    const state = read();
    const proposal = state.proposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error("Remediation proposal not found");
    if (proposal.status !== "approved-for-execution" || proposal.approval?.decision !== "approved") throw new Error("Owner approval is required before execution");
    proposal.status = "executing";
    write(state);

    const execution = { id: id("execution", proposalId), proposalId, target: proposal.target, startedAt: new Date().toISOString(), status: "running" };
    state.executions.push(execution);
    proposal.executionId = execution.id;
    write(state);

    try {
      const result = await executeApprovedRemediation({
        ...proposal,
        ownerApprovalId: proposal.approval.id,
        approvalDecision: proposal.approval.decision
      });
      execution.status = "draft-pr-created";
      execution.completedAt = new Date().toISOString();
      execution.result = result;
      proposal.status = "draft-pr-created";
      write(state);
      return result;
    } catch (error) {
      execution.status = "failed-rolled-back";
      execution.completedAt = new Date().toISOString();
      execution.error = error instanceof Error ? error.message : String(error);
      proposal.status = "failed-rolled-back";
      write(state);
      throw error;
    }
  }

  function snapshot() {
    const state = read();
    return {
      schemaVersion: state.schemaVersion,
      updatedAt: state.updatedAt,
      proposalCount: state.proposals.length,
      pendingCount: state.proposals.filter((item) => item.status === "pending-owner-approval").length,
      approvedCount: state.proposals.filter((item) => item.status === "approved-for-execution").length,
      executingCount: state.proposals.filter((item) => item.status === "executing").length,
      draftPrCount: state.proposals.filter((item) => item.status === "draft-pr-created").length,
      failedRollbackCount: state.proposals.filter((item) => item.status === "failed-rolled-back").length,
      proposals: state.proposals.slice(-250).reverse(),
      executions: state.executions.slice(-250).reverse()
    };
  }

  return { propose, decide, execute, snapshot };
}

module.exports = { createRemediationQueue, MAX_RECORDS };