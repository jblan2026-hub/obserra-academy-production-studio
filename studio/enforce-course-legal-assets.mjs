import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const markerStart = "<!-- OBSERRA-COURSE-LEGAL-START -->";
const markerEnd = "<!-- OBSERRA-COURSE-LEGAL-END -->";

function legalBlock(manifest) {
  return `${markerStart}\n\n> **${officialBrand.legalName}**  \\\n> **${officialBrand.disclaimer.shortText}**\n\n### Informational-use disclaimer\n\n${officialBrand.disclaimer.fullText}\n\n### Assumption of risk, release, and limitation of liability\n\n${officialBrand.disclaimer.releaseAndLimitationOfLiability}\n\n### Learner acknowledgement\n\n${officialBrand.disclaimer.acknowledgementText}\n\n**Official brand:** ${manifest.branding.logoAsset}  \\\n**Classification:** ${manifest.branding.classification}\n\n${markerEnd}`;
}

function replaceOrInsertMarkdown(filePath, block) {
  if (!fs.existsSync(filePath)) return;
  const current = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "gm");
  const cleaned = current.replace(pattern, "").trim();
  fs.writeFileSync(filePath, `${block}\n\n${cleaned}\n\n${block}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function updateJson(filePath, manifest) {
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const governed = Array.isArray(data)
    ? {
      schemaVersion: "1.0",
      courseId: manifest.course.id,
      records: data,
    }
    : data;
  governed.branding = manifest.branding;
  governed.tags = manifest.tags;
  governed.disclaimer = manifest.disclaimer;
  fs.writeFileSync(filePath, `${JSON.stringify(governed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

let processed = 0;
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const courseDir = path.join(coursesRoot, entry.name);
  const manifestPath = path.join(courseDir, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assertBrandAndTags(manifest, manifestPath);
  const block = legalBlock(manifest);

  for (const file of [
    "instructor-manuscript.md",
    "learner-guide.md",
    "workbook.md",
    "visual-brief.md",
    "implementation-and-application-guide.md",
  ]) {
    replaceOrInsertMarkdown(path.join(courseDir, file), block);
  }
  for (const file of [
    "assessment-bank.json",
    "answer-key.json",
    "documented-real-world-case-register.json",
    "course-implementation-strategy.json",
    "standards-implementation-map.json",
    "prioritized-recommendations.json",
    "implementation-guidance.json",
    "certificate-package.json",
  ]) {
    updateJson(path.join(courseDir, file), manifest);
  }
  processed += 1;
}

console.log(`[Academy Studio] Enforced official branding, tags, informational disclaimer, acknowledgement, and liability terms across ${processed} detailed course package(s).`);
