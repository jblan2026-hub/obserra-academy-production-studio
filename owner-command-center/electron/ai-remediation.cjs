const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const APPROVED_REPOSITORIES = Object.freeze({
  website: {
    repository: "jblan2026-hub/obserra-website",
    defaultBranch: "main",
    workspaceEnv: "OBSERRA_WEBSITE_WORKSPACE",
    validation: [["npm", ["run", "verify:academy-release"]]],
    scopes: ["website", "academy", "commerce", "identity", "api", "purchase", "certificate"]
  },
  studio: {
    repository: "jblan2026-hub/obserra-academy-production-studio",
    defaultBranch: "main",
    workspaceEnv: "OBSERRA_STUDIO_WORKSPACE",
    validation: [["npm", ["run", "verify:500x"]]],
    scopes: ["studio", "command-center", "academy", "connector", "remediation"]
  },
  eios: {
    repository: "jblan2026-hub/Obserra-EIOS-Dual-Mode-Module-Platform",
    defaultBranch: "main",
    workspaceEnv: "OBSERRA_EIOS_WORKSPACE",
    validation: [
      ["python", ["scripts/verify_500x_enterprise_workload.py"]],
      ["npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], "apps/eios-web"],
      ["npm", ["run", "test:command-center-contract"], "apps/eios-web"],
      ["npm", ["run", "build"], "apps/eios-web"]
    ],
    scopes: ["eios", "platform", "enterprise", "api", "connector", "intelligence"]
  }
});

const ALLOWED_TEXT_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx", ".json", ".yml", ".yaml", ".md", ".py", ".ps1", ".css", ".html"]);
const FORBIDDEN_PATH_PARTS = [".git", "node_modules", ".next", "dist", "release-media", ".env", "secrets", "credentials"];
const MAX_FILES_PER_PLAN = 40;
const MAX_BYTES_PER_FILE = 1_000_000;

function run(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) }
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ command, args, cwd, code, stdout: stdout.slice(-250000), stderr: stderr.slice(-250000) }));
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) throw new Error("Patch path must remain inside the approved repository");
  if (FORBIDDEN_PATH_PARTS.some((part) => normalized.split("/").includes(part))) throw new Error(`Patch path is prohibited: ${normalized}`);
  if (!ALLOWED_TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase())) throw new Error(`Patch file type is not approved: ${normalized}`);
  return normalized;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("Remediation plan is required");
  const target = APPROVED_REPOSITORIES[plan.target];
  if (!target) throw new Error("Remediation target is not approved");
  if (!Array.isArray(plan.mappings) || plan.mappings.length === 0) throw new Error("MITRE or OWASP mapping is required");
  if (!plan.mappings.some((item) => /^MITRE-|^OWASP-/.test(String(item)))) throw new Error("A recognized MITRE or OWASP mapping is required");
  if (!Array.isArray(plan.files) || plan.files.length === 0 || plan.files.length > MAX_FILES_PER_PLAN) throw new Error("Remediation plan file count is invalid");
  if (!plan.ownerApprovalId) throw new Error("Owner approval record is required");
  if (!plan.findingId) throw new Error("Source vulnerability finding is required");
  const files = plan.files.map((item) => {
    const relativePath = normalizeRelativePath(item.path);
    const content = String(item.content ?? "");
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES_PER_FILE) throw new Error(`Patch file exceeds governed size limit: ${relativePath}`);
    return { path: relativePath, content, expectedSha256: item.expectedSha256 || null };
  });
  return { ...plan, targetConfig: target, files };
}

function resolveWorkspace(targetConfig) {
  const configured = process.env[targetConfig.workspaceEnv];
  if (!configured) throw new Error(`${targetConfig.workspaceEnv} is not configured`);
  const resolved = path.resolve(configured);
  if (!fs.existsSync(path.join(resolved, ".git"))) throw new Error(`Approved repository workspace is unavailable: ${resolved}`);
  return resolved;
}

async function assertCleanRepository(workspace, repository) {
  const remote = await run("git", ["remote", "get-url", "origin"], workspace);
  if (remote.code !== 0 || !remote.stdout.includes(repository)) throw new Error(`Workspace origin does not match approved repository ${repository}`);
  const status = await run("git", ["status", "--porcelain"], workspace);
  if (status.code !== 0) throw new Error(status.stderr || "Unable to inspect repository status");
  if (status.stdout.trim()) throw new Error("Repository contains uncommitted changes; remediation is fail closed");
}

function createBranchName(plan) {
  const suffix = sha256(`${plan.target}:${plan.findingId}:${Date.now()}`).slice(0, 10);
  return `ai-remediation/${String(plan.findingId).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48)}-${suffix}`;
}

function writePatchFiles(workspace, files) {
  const evidence = [];
  for (const file of files) {
    const absolutePath = path.resolve(workspace, file.path);
    if (!absolutePath.startsWith(`${workspace}${path.sep}`)) throw new Error("Patch escaped approved workspace");
    if (file.expectedSha256 && fs.existsSync(absolutePath)) {
      const current = sha256(fs.readFileSync(absolutePath));
      if (current !== file.expectedSha256) throw new Error(`Source changed since remediation plan was generated: ${file.path}`);
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const backupHash = fs.existsSync(absolutePath) ? sha256(fs.readFileSync(absolutePath)) : null;
    fs.writeFileSync(absolutePath, file.content, { encoding: "utf8", mode: 0o600 });
    evidence.push({ path: file.path, beforeSha256: backupHash, afterSha256: sha256(file.content), bytes: Buffer.byteLength(file.content, "utf8") });
  }
  return evidence;
}

async function runValidations(workspace, validations) {
  const results = [];
  for (const [command, args, relativeCwd] of validations) {
    const result = await run(command, args, relativeCwd ? path.join(workspace, relativeCwd) : workspace);
    results.push(result);
    if (result.code !== 0) throw Object.assign(new Error(`Validation failed: ${command} ${args.join(" ")}`), { validationResults: results });
  }
  return results;
}

async function executeApprovedRemediation(planInput) {
  const plan = validatePlan(planInput);
  if (plan.approvalDecision !== "approved") throw new Error("Owner approval decision must be approved before patch execution");
  const workspace = resolveWorkspace(plan.targetConfig);
  await assertCleanRepository(workspace, plan.targetConfig.repository);

  const branch = createBranchName(plan);
  const baseBranch = plan.baseBranch || plan.targetConfig.defaultBranch;
  const commandEvidence = [];
  const checkout = await run("git", ["checkout", baseBranch], workspace); commandEvidence.push(checkout);
  if (checkout.code !== 0) throw new Error(checkout.stderr || `Unable to checkout ${baseBranch}`);
  const pull = await run("git", ["pull", "--ff-only", "origin", baseBranch], workspace); commandEvidence.push(pull);
  if (pull.code !== 0) throw new Error(pull.stderr || "Unable to fast-forward approved base branch");
  const branchResult = await run("git", ["checkout", "-b", branch], workspace); commandEvidence.push(branchResult);
  if (branchResult.code !== 0) throw new Error(branchResult.stderr || "Unable to create remediation branch");

  try {
    const fileEvidence = writePatchFiles(workspace, plan.files);
    const validationResults = await runValidations(workspace, plan.targetConfig.validation);
    const add = await run("git", ["add", "--", ...plan.files.map((item) => item.path)], workspace); commandEvidence.push(add);
    if (add.code !== 0) throw new Error(add.stderr || "Unable to stage remediation patch");
    const commitMessage = `fix(security): remediate ${plan.findingId}`;
    const commit = await run("git", ["commit", "-m", commitMessage], workspace); commandEvidence.push(commit);
    if (commit.code !== 0) throw new Error(commit.stderr || "Unable to commit remediation patch");
    const push = await run("git", ["push", "--set-upstream", "origin", branch], workspace); commandEvidence.push(push);
    if (push.code !== 0) throw new Error(push.stderr || "Unable to push remediation branch");

    const title = `[AI remediation] ${plan.title || plan.findingId}`;
    const body = [
      "## Governed AI remediation",
      `Finding: ${plan.findingId}`,
      `Mappings: ${plan.mappings.join(", ")}`,
      `Owner approval: ${plan.ownerApprovalId}`,
      `Scope: ${(plan.scopes || plan.targetConfig.scopes).join(", ")}`,
      "",
      "This draft pull request was generated by the Obserra Owner AI Command Center.",
      "It must not be merged until CI, security review, and owner approval are complete.",
      "",
      `Evidence digest: ${sha256(JSON.stringify({ fileEvidence, validationResults: validationResults.map((item) => ({ command: item.command, args: item.args, code: item.code })) }))}`
    ].join("\n");
    const pr = await run("gh", ["pr", "create", "--draft", "--repo", plan.targetConfig.repository, "--base", baseBranch, "--head", branch, "--title", title, "--body", body], workspace); commandEvidence.push(pr);
    if (pr.code !== 0) throw new Error(pr.stderr || "Unable to create draft remediation pull request");

    return {
      schemaVersion: "1.0",
      status: "draft-pr-created",
      target: plan.target,
      repository: plan.targetConfig.repository,
      findingId: plan.findingId,
      mappings: plan.mappings,
      ownerApprovalId: plan.ownerApprovalId,
      branch,
      pullRequestUrl: pr.stdout.trim().split(/\s+/).find((value) => /^https:\/\/github\.com\//.test(value)) || null,
      fileEvidence,
      validationResults: validationResults.map((item) => ({ command: item.command, args: item.args, cwd: item.cwd, code: item.code, stdout: item.stdout, stderr: item.stderr })),
      evidenceDigest: sha256(JSON.stringify({ branch, fileEvidence, commandEvidence: commandEvidence.map((item) => ({ command: item.command, args: item.args, code: item.code })) })),
      createdAt: new Date().toISOString(),
      mergeRequiresOwnerApproval: true,
      productionDeploymentAutomatic: false
    };
  } catch (error) {
    await run("git", ["reset", "--hard"], workspace);
    await run("git", ["checkout", baseBranch], workspace);
    await run("git", ["branch", "-D", branch], workspace);
    throw error;
  }
}

function createRemediationProposal(finding, target, files = []) {
  const targetConfig = APPROVED_REPOSITORIES[target];
  if (!targetConfig) throw new Error("Unknown remediation target");
  return {
    schemaVersion: "1.0",
    status: "owner-approval-required",
    target,
    repository: targetConfig.repository,
    findingId: finding?.id || finding?.findingId || sha256(JSON.stringify(finding || {})).slice(0, 16),
    title: finding?.title || `Remediate ${finding?.type || "known vulnerability"}`,
    mappings: finding?.mappings || [],
    severity: finding?.severity || "unknown",
    knownBad: finding?.knownBad === true,
    files: files.map((item) => ({ path: normalizeRelativePath(item.path), content: String(item.content ?? ""), expectedSha256: item.expectedSha256 || null })),
    requiredValidations: targetConfig.validation,
    ownerApprovalRequired: true,
    draftPullRequestOnly: true,
    forcePushAllowed: false,
    directDefaultBranchWriteAllowed: false,
    automaticMergeAllowed: false,
    automaticProductionDeploymentAllowed: false
  };
}

module.exports = {
  APPROVED_REPOSITORIES,
  MAX_FILES_PER_PLAN,
  createRemediationProposal,
  executeApprovedRemediation,
  validatePlan
};
