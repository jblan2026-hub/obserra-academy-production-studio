import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const outputDir = path.join(root, "catalog");
const outputPath = path.join(outputDir, "academy-course-catalog.json");

fs.mkdirSync(outputDir, { recursive: true });

const courses = [];
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.release.publishToAcademy || !["approved", "published"].includes(manifest.release.status)) continue;

  courses.push({
    id: manifest.course.id,
    title: manifest.course.title,
    department: manifest.course.department,
    level: manifest.course.level,
    track: manifest.course.track,
    audience: manifest.course.audience,
    description: manifest.course.description,
    duration: manifest.course.duration,
    outcomes: manifest.course.outcomes,
    moduleCount: manifest.course.modules.length,
    price: manifest.commerce.price,
    currency: manifest.commerce.currency,
    paymentLink: manifest.commerce.paymentLink ?? null,
    stripePriceId: manifest.commerce.stripePriceId ?? null,
    accessPolicy: manifest.commerce.accessPolicy,
    passingScore: manifest.completion.passingScore,
    certificateIssued: manifest.completion.certificateIssued,
    version: manifest.release.version,
    releaseStatus: manifest.release.status,
  });
}

courses.sort((a, b) => a.title.localeCompare(b.title));
fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: "1.0", generatedAt: new Date().toISOString(), courses }, null, 2)}\n`);
console.log(`[Academy Studio] Generated catalog with ${courses.length} approved course(s)`);
