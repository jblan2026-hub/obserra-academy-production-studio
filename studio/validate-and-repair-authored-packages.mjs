import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACADEMY_AUTHORING_POLICY_VERSION,
  academyAuthoringQualityContract,
} from "./academy-authoring-quality-contract.mjs";
import { authoredPackageFindings } from "./validate-authored-package.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const catalogRoot = path.join(root, "catalog");
const reportPath = path.join(catalogRoot, "authoring-quality-repair.json");
const maximumRepairAttempts = boundedNumber(
  process.env.ACADEMY_AUTHORING_REPAIR_ATTEMPTS,
  2,
  0,
  3,
);
const repairConcurrency = boundedNumber(
  process.env.ACADEMY_AUTHORING_REPAIR_CONCURRENCY,
  6,
  1,
  8,
);
const processTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_REPAIR_TIMEOUT_MS,
  25 * 60 * 1000,
  2 * 60 * 1000,
  30 * 60 * 1000,
);

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

function packagePaths(courseId) {
  const courseRoot = path.join(coursesRoot, courseId);
  const authoringRoot = path.join(courseRoot, "generated", "authoring");
  return {
    manifestPath: path.join(courseRoot, "course-manifest.json"),
    packagePath: path.join(authoringRoot, "course-package.json"),
    partialPath: path.join(authoringRoot, "course-package.partial.json"),
  };
}

function validateCoursePackage(courseId) {
  const { manifestPath, packagePath, partialPath } = packagePaths(courseId);
  if (!fs.existsSync(manifestPath)) return [`${courseId}:missing-manifest`];

  const candidatePath = fs.existsSync(packagePath)
    ? packagePath
    : fs.existsSync(partialPath)
      ? partialPath
      : null;
  if (candidatePath === null) return [`${courseId}:missing-authored-package`];

  let manifest;
  let envelope;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    return [`${courseId}:invalid-manifest-json:${error.message}`];
  }
  try {
    envelope = readJson(candidatePath);
  } catch (error) {
    return [`${courseId}:invalid-authored-json:${error.message}`];
  }

  const findings = authoredPackageFindings({
    manifest,
    authored: envelope?.content,
  });
  if (candidatePath === partialPath) {
    findings.push("partial-authored-package-requires-repair");
  }
  if (envelope?.authoringPolicyVersion !== ACADEMY_AUTHORING_POLICY_VERSION) {
    findings.push(
      `authoring-policy-${envelope?.authoringPolicyVersion || "missing"}-expected-${ACADEMY_AUTHORING_POLICY_VERSION}`,
    );
  }
  return [...new Set(findings)]
    .sort()
    .map((finding) => `${courseId}:${finding}`);
}

function courseIds() {
  return fs
    .readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((courseId) =>
      fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")),
    )
    .sort();
}

function regenerate(courseId) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "studio", "author-course-ai.mjs"),
        "--course",
        courseId,
        "--provider",
        process.env.ACADEMY_AUTHORING_PROVIDER || "openai",
        "--force",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          ACADEMY_AUTHORING_NARRATIVE_TARGET_WORDS:
            process.env.ACADEMY_AUTHORING_REPAIR_NARRATIVE_TARGET_WORDS ||
            process.env.ACADEMY_AUTHORING_NARRATIVE_TARGET_WORDS ||
            "1650",
          OPENAI_MAX_OUTPUT_TOKENS:
            courseId === "pmp-exam-prep-business-application"
              ? process.env.OPENAI_PMP_MAX_OUTPUT_TOKENS || "100000"
              : process.env.OPENAI_MAX_OUTPUT_TOKENS || "64000",
          OPENAI_REASONING_EFFORT:
            process.env.OPENAI_REPAIR_REASONING_EFFORT || "low",
        },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, exitCode: child.exitCode, timedOut: true });
    }, processTimeoutMs);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        courseId,
        stdout: stdout.slice(-12000),
        stderr: stderr.slice(-12000),
        ...result,
      });
    }

    child.stdout?.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`;
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`;
    });
    child.on("error", (error) => {
      stderr = `${stderr}\n${error.message}`;
      finish({ ok: false, exitCode: null, timedOut: false });
    });
    child.on("close", (exitCode) => {
      finish({ ok: exitCode === 0, exitCode, timedOut: false });
    });
  });
}

async function runBounded(items, concurrency, worker) {
  if (items.length === 0) return [];
  const results = [];
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      runWorker,
    ),
  );
  return results;
}

async function main() {
  const ids = courseIds();
  const initial = Object.fromEntries(
    ids.map((courseId) => [courseId, validateCoursePackage(courseId)]),
  );
  let pending = ids.filter((courseId) => initial[courseId].length > 0);
  const attempts = [];

  for (
    let attempt = 1;
    attempt <= maximumRepairAttempts && pending.length > 0;
    attempt += 1
  ) {
    console.log(
      `[Academy Studio] Selective authoring repair attempt ${attempt}/${maximumRepairAttempts} for ${pending.length} package(s) that do not satisfy policy ${ACADEMY_AUTHORING_POLICY_VERSION}; provider concurrency is ${repairConcurrency}.`,
    );
    const regenerated = await runBounded(
      pending,
      repairConcurrency,
      async (courseId) => {
        const result = await regenerate(courseId);
        const findings = validateCoursePackage(courseId);
        return { attempt, ...result, findings };
      },
    );
    attempts.push(...regenerated);
    pending = regenerated
      .filter((result) => !result.ok || result.findings.length > 0)
      .map((result) => result.courseId);
  }

  const final = Object.fromEntries(
    ids.map((courseId) => [courseId, validateCoursePackage(courseId)]),
  );
  const failed = ids.filter((courseId) => final[courseId].length > 0);
  const repaired = ids.filter(
    (courseId) => initial[courseId].length > 0 && final[courseId].length === 0,
  );
  const report = {
    schemaVersion: "2.1",
    generatedAt: new Date().toISOString(),
    authoringQualityContract: academyAuthoringQualityContract(),
    discoveredCourses: ids.length,
    initiallyIncomplete: Object.values(initial).filter(
      (findings) => findings.length > 0,
    ).length,
    repairedCourses: repaired,
    failedCourses: failed,
    maximumRepairAttempts,
    repairConcurrency,
    processTimeoutMs,
    attempts,
    initialFindings: initial,
    finalFindings: final,
    passed: failed.length === 0,
  };
  writeJson(reportPath, report);

  if (failed.length > 0) {
    console.error(
      `[Academy Studio] Production authoring quality gate failed for ${failed.length} course(s).`,
    );
    for (const courseId of failed) {
      console.error(`- ${courseId}: ${final[courseId].join(", ")}`);
    }
    process.exit(2);
  }

  console.log(
    `[Academy Studio] Production authoring quality gate passed for all ${ids.length} course(s) under policy ${ACADEMY_AUTHORING_POLICY_VERSION}; selectively repaired ${repaired.length}.`,
  );
}

await main();
