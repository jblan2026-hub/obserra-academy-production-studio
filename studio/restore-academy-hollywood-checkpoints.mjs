import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { restoreHollywoodCheckpoints } from "./academy-hollywood-checkpoints.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

const summary = await restoreHollywoodCheckpoints();
let researchRestored = 0;
let reviewRestored = 0;
for (const courseId of summary.restoredCourseIds || []) {
  const courseRoot = path.join(root, "courses", courseId);
  const packagePath = path.join(courseRoot, "generated", "authoring", "course-package.json");
  if (!fs.existsSync(packagePath)) continue;
  const envelope = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (envelope.protectedEvidence?.research) {
    writePrivateJson(
      path.join(courseRoot, "generated", "research", "authoritative-source-research.json"),
      envelope.protectedEvidence.research,
    );
    researchRestored += 1;
  }
  if (envelope.protectedEvidence?.independentReview) {
    writePrivateJson(
      path.join(courseRoot, "generated", "quality", "independent-course-quality-review.json"),
      envelope.protectedEvidence.independentReview,
    );
    reviewRestored += 1;
  }
}
console.log(`[Academy Studio] Cinematic checkpoint restore evaluated ${summary.evaluated} course(s), restored ${summary.restored} package(s), ${researchRestored} research record(s), and ${reviewRestored} independent review record(s).`);
