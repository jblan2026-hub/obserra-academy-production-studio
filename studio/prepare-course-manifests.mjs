import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");

function slug(value, fallback = "general") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferFrameworks(manifest) {
  const text = JSON.stringify(manifest).toLowerCase();
  const candidates = [
    ["nist", "nist"], ["cmmc", "cmmc"], ["fda", "fda"], ["pci", "pci-dss"],
    ["hipaa", "hipaa"], ["iso 27001", "iso-27001"], ["owasp", "owasp"],
    ["cis", "cis-controls"], ["gdpr", "gdpr"], ["ai act", "eu-ai-act"],
  ];
  const matched = candidates.filter(([needle]) => text.includes(needle)).map(([, tag]) => tag);
  return matched.length ? matched : ["framework-neutral"];
}

function buildTags(manifest) {
  const course = manifest.course ?? {};
  return {
    industry: unique((manifest.tags?.industry ?? ["cross-industry"]).map((value) => slug(value))),
    domain: unique((manifest.tags?.domain ?? [course.department, course.track]).map((value) => slug(value))),
    audience: unique((manifest.tags?.audience ?? [course.audience]).map((value) => slug(value))),
    level: unique((manifest.tags?.level ?? [course.level]).map((value) => slug(value))),
    frameworks: unique((manifest.tags?.frameworks ?? inferFrameworks(manifest)).map((value) => slug(value))),
    deliveryFormat: unique((manifest.tags?.deliveryFormat ?? ["online-self-paced"]).map((value) => slug(value))),
    commercialModel: unique((manifest.tags?.commercialModel ?? [manifest.commerce?.model ?? "one-time-payment"]).map((value) => slug(value))),
    brand: unique([...(manifest.tags?.brand ?? []), ...officialBrand.requiredBrandTagValues].map((value) => slug(value))),
    classification: unique((manifest.tags?.classification ?? ["internal-review"]).map((value) => slug(value))),
  };
}

function prepareManifest(manifest) {
  return {
    ...manifest,
    branding: {
      legalName: officialBrand.legalName,
      brandName: officialBrand.brandName,
      academyName: officialBrand.academyName,
      studioName: officialBrand.studioName,
      logoAsset: officialBrand.officialLogo.assetPath,
      logoSha256: officialBrand.officialLogo.sourceFileSha256,
      classification: officialBrand.ownership.defaultClassification,
      visualSystem: "official-obserra-executive",
      brandReviewRequired: true,
    },
    disclaimer: {
      type: officialBrand.disclaimer.type,
      shortText: officialBrand.disclaimer.shortText,
      fullText: officialBrand.disclaimer.fullText,
      releaseAndLimitationOfLiability: officialBrand.disclaimer.releaseAndLimitationOfLiability,
      acknowledgementRequired: true,
      acknowledgementText: officialBrand.disclaimer.acknowledgementText,
    },
    tags: buildTags(manifest),
  };
}

if (!fs.existsSync(coursesRoot)) {
  console.error(`[Academy Studio] Missing courses directory: ${coursesRoot}`);
  process.exit(1);
}

let prepared = 0;
for (const entry of fs.readdirSync(coursesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(coursesRoot, entry.name, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const normalized = prepareManifest(manifest);
  fs.writeFileSync(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`);
  prepared += 1;
}

console.log(`[Academy Studio] Prepared ${prepared} course manifest(s) with official branding, taxonomy, disclaimer, and liability policy.`);
