import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { officialBrand, assertBrandAndTags } from "./brand-policy.mjs";

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
  const pattern = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "m");
  const cleaned = current.replace(pattern, "").trim();
  fs.writeFileSync(filePath, `${block}\n\n${cleaned}\n\n${block}\n`);
}

function updateJson(filePath, manifest) {
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  data.branding = manifest.branding;
  data.tags = manifest.tags;
  data.disclaimer = manifest.disclaimer;
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
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

  for (const file of ["instructor-manuscript.md", "learner-guide.md", "workbook.md", "visual-brief.md"]) {
    replaceOrInsertMarkdown(path.join(courseDir, file), block);
  }
  for (const file of ["assessment-bank.json", "answer-key.json"]) {
    updateJson(path.join(courseDir, file), manifest);
  }
  processed += 1;
}

console.log(`[Academy Studio] Enforced official branding, tags, informational disclaimer, acknowledgement, and liability terms across ${processed} generated course package(s)`);
