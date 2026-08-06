import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBrandAndTags, officialBrand } from "./brand-policy.mjs";

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
  assertBrandAndTags(manifest, manifestPath);
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
    prerequisites: manifest.course.prerequisites || [],
    outcomes: manifest.course.outcomes,
    modules: manifest.course.modules.map((module, index) => ({ id: module.id, sequence: index + 1, title: module.title, duration: module.duration, format: module.format, description: module.description })),
    moduleCount: manifest.course.modules.length,
    tags: manifest.tags,
    commerce: {
      model: manifest.commerce.model,
      price: manifest.commerce.price,
      currency: manifest.commerce.currency,
      paymentLink: manifest.commerce.paymentLink ?? null,
      stripePriceId: manifest.commerce.stripePriceId ?? null,
    },
    licensing: {
      entitlementType: "course-enrollment",
      entitlementCode: `ACADEMY_${manifest.course.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      accessPolicy: manifest.commerce.accessPolicy,
      recurring: false,
      seatScope: "named-learner",
      transferable: false,
      expiresAtCompletion: true,
      completionRecordRetained: true,
    },
    completion: {
      allLessonsRequired: manifest.completion.allLessonsRequired,
      assessmentRequired: manifest.completion.assessmentRequired,
      passingScore: manifest.completion.passingScore,
      certificateIssued: manifest.completion.certificateIssued,
      credentialType: "certificate-of-course-completion-only",
      credentialDisclaimer: "This completion record is not certification, licensure, accreditation, compliance validation, regulatory approval, or professional qualification.",
    },
    certificate: {
      issuer: officialBrand.legalName,
      templateId: "obserra-academy-course-completion-v1",
      title: "Certificate of Course Completion",
      certificateIdPattern: `OBS-${manifest.course.id.toUpperCase().replace(/[^A-Z0-9]+/g, "")}-{UNIQUE}`,
      verificationRequired: true,
      transcriptRetained: true,
      isProfessionalCertification: false,
      isComplianceEvidence: false,
    },
    branding: manifest.branding,
    disclaimer: manifest.disclaimer,
    acknowledgementRequired: true,
    version: manifest.release.version,
    releaseStatus: manifest.release.status,
  });
}

courses.sort((a, b) => a.title.localeCompare(b.title));
fs.writeFileSync(outputPath, `${JSON.stringify({
  schemaVersion: "1.2",
  generatedAt: new Date().toISOString(),
  publisher: officialBrand.legalName,
  officialLogo: officialBrand.officialLogo,
  visualSystem: officialBrand.visualSystem,
  disclaimer: officialBrand.disclaimer,
  courses,
}, null, 2)}\n`);
console.log(`[Academy Studio] Generated governed catalog with ${courses.length} approved course(s).`);
