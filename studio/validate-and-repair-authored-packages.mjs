import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  4,
  1,
  8,
);
const processTimeoutMs = boundedNumber(
  process.env.ACADEMY_AUTHORING_REPAIR_TIMEOUT_MS,
  20 * 60 * 1000,
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

function normalizedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function packagePaths(courseId) {
  const courseRoot = path.join(coursesRoot, courseId);
  return {
    courseRoot,
    manifestPath: path.join(courseRoot, "course-manifest.json"),
    packagePath: path.join(courseRoot, "generated", "authoring", "course-package.json"),
  };
}

function validateCoursePackage(courseId) {
  const { manifestPath, packagePath } = packagePaths(courseId);
  const findings = [];
  if (!fs.existsSync(manifestPath)) return [`${courseId}:missing-manifest`];
  if (!fs.existsSync(packagePath)) return [`${courseId}:missing-authored-package`];

  let manifest;
  let envelope;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    return [`${courseId}:invalid-manifest-json:${error.message}`];
  }
  try {
    envelope = readJson(packagePath);
  } catch (error) {
    return [`${courseId}:invalid-authored-json:${error.message}`];
  }

  const content = envelope?.content || {};
  const expectedModules = Array.isArray(manifest?.course?.modules)
    ? manifest.course.modules
    : [];
  const modules = Array.isArray(content.modules) ? content.modules : [];
  const modulesById = new Map(modules.map((module) => [module?.id, module]));
  const workbookByModule = new Map(
    (Array.isArray(content.learnerWorkbook) ? content.learnerWorkbook : [])
      .map((entry) => [entry?.moduleId, entry]),
  );

  if (!normalizedText(content?.courseSummary?.executiveValue)) {
    findings.push(`${courseId}:missing-course-summary-executive-value`);
  }
  if (!normalizedText(content?.courseSummary?.instructionalStrategy)) {
    findings.push(`${courseId}:missing-course-summary-instructional-strategy`);
  }
  if (!Array.isArray(content.sourceRegister) || content.sourceRegister.length === 0) {
    findings.push(`${courseId}:missing-source-register`);
  }
  if (!Array.isArray(content.frameworkAlignment)) {
    findings.push(`${courseId}:missing-framework-alignment-array`);
  }
  if (!content.assessmentBlueprint || !Array.isArray(content.assessmentBlueprint.coverageByModule)) {
    findings.push(`${courseId}:missing-assessment-blueprint`);
  }
  if (modules.length !== expectedModules.length) {
    findings.push(`${courseId}:expected-${expectedModules.length}-modules-found-${modules.length}`);
  }

  for (const expected of expectedModules) {
    const module = modulesById.get(expected.id);
    const prefix = `${courseId}/${expected.id}`;
    if (!module) {
      findings.push(`${prefix}:missing-module`);
      continue;
    }
    if (!normalizedText(module.lessonNarrative)) findings.push(`${prefix}:missing-lesson-narrative`);
    if (!Array.isArray(module.learningObjectives) || module.learningObjectives.length === 0) {
      findings.push(`${prefix}:missing-learning-objectives`);
    }
    if (!Array.isArray(module.keyConcepts) || module.keyConcepts.length < 4) {
      findings.push(`${prefix}:insufficient-key-concepts`);
    }
    if (!module.scenario) findings.push(`${prefix}:missing-scenario`);
    if (!module.exercise) findings.push(`${prefix}:missing-exercise`);
    if (!Array.isArray(module.knowledgeChecks) || module.knowledgeChecks.length < 4) {
      findings.push(`${prefix}:insufficient-knowledge-checks`);
    }
    if (!Array.isArray(module.slideNarrative) || module.slideNarrative.length < 8) {
      findings.push(`${prefix}:insufficient-slide-narrative`);
    }
    if (!module.videoScript) findings.push(`${prefix}:missing-video-script`);
    if (!Array.isArray(module.accessibilityNotes) || module.accessibilityNotes.length < 4) {
      findings.push(`${prefix}:insufficient-accessibility-notes`);
    }
    const workbook = workbookByModule.get(expected.id);
    if (!workbook) findings.push(`${prefix}:missing-workbook`);
  }

  const finalAssessment = Array.isArray(content.finalAssessment)
    ? content.finalAssessment
    : [];
  if (finalAssessment.length < 25) {
    findings.push(`${courseId}:insufficient-final-assessment-${finalAssessment.length}`);
  }

  return findings;
}

function courseIds() {
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
    .sort();
}

function regenerate(courseId) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(root, "studio", "author-course-ai.mjs"), "--course", courseId, "--force"],
      {
        cwd: root,
        env: { ...process.env },
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
  const results = [];
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

async function main() {
  const ids = courseIds();
  const initial = Object.fromEntries(ids.map((courseId) => [courseId, validateCoursePackage(courseId)]));
  let pending = ids.filter((courseId) => initial[courseId].length > 0);
  const attempts = [];

  for (let attempt = 1; attempt <= maximumRepairAttempts && pending.length > 0; attempt += 1) {
    console.log(
      `[Academy Studio] Selective authoring repair attempt ${attempt}/${maximumRepairAttempts} for ${pending.length} incomplete course package(s).`,
    );
    const regenerated = await runBounded(pending, repairConcurrency, async (courseId) => {
      const result = await regenerate(courseId);
      const findings = validateCoursePackage(courseId);
      return { attempt, ...result, findings };
    });
    attempts.push(...regenerated);
    pending = regenerated
      .filter((result) => !result.ok || result.findings.length > 0)
      .map((result) => result.courseId);
  }

  const final = Object.fromEntries(ids.map((courseId) => [courseId, validateCoursePackage(courseId)]));
  const failed = ids.filter((courseId) => final[courseId].length > 0);
  const repaired = ids.filter(
    (courseId) => initial[courseId].length > 0 && final[courseId].length === 0,
  );
  const report = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    discoveredCourses: ids.length,
    initiallyIncomplete: Object.values(initial).filter((findings) => findings.length > 0).length,
    repairedCourses: repaired,
    failedCourses: failed,
    maximumRepairAttempts,
    repairConcurrency,
    attempts,
    initialFindings: initial,
    finalFindings: final,
    passed: failed.length === 0,
  };
  writeJson(reportPath, report);

  if (failed.length > 0) {
    console.error(
      `[Academy Studio] Authored-package quality gate failed for ${failed.length} course(s).`,
    );
    for (const courseId of failed) {
      console.error(`- ${courseId}: ${final[courseId].join(", ")}`);
    }
    process.exit(2);
  }

  console.log(
    `[Academy Studio] Authored-package quality gate passed for all ${ids.length} course(s); selectively repaired ${repaired.length}.`,
  );
}

await main();
