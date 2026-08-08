import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { officialBrand } from "./brand-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coursesRoot = path.join(root, "courses");
const COURSE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,120}$/;

function slug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function parseDurationMinutes(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const hours = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:hour|hours|hr|hrs)/);
  const minutes = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:minute|minutes|min|mins)/);
  if (hours || minutes) return Math.round(Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0));
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.round(numeric) : NaN;
}

function inferFrameworks(manifest) {
  const text = JSON.stringify(manifest).toLowerCase();
  const mappings = [
    ["nist", "nist"],
    ["cmmc", "cmmc"],
    ["pci", "pci-dss"],
    ["hipaa", "hipaa"],
    ["fda", "fda-cybersecurity"],
    ["iso 27001", "iso-27001"],
    ["owasp", "owasp"],
    ["cis", "cis-controls"],
    ["gdpr", "gdpr"],
    ["ai act", "eu-ai-act"],
  ];
  const matches = mappings.filter(([term]) => text.includes(term)).map(([, tag]) => tag);
  return matches.length ? matches : ["industry-guidance"];
}

function completionPolicy(manifest) {
  const courseMinutes = parseDurationMinutes(manifest.course?.duration);
  const moduleMinutes = (manifest.course?.modules ?? []).reduce((total, module) => {
    const minutes = parseDurationMinutes(module.duration);
    return total + (Number.isFinite(minutes) ? minutes : 0);
  }, 0);
  const existing = parseDurationMinutes(manifest.completion?.assessmentDuration);
  const inferred = Number.isFinite(courseMinutes) && courseMinutes > moduleMinutes ? courseMinutes - moduleMinutes : 0;
  const assessmentMinutes = Number.isFinite(existing) && existing > 0 ? existing : inferred;

  return {
    ...manifest.completion,
    assessmentDuration: assessmentMinutes > 0 ? `${assessmentMinutes} min` : manifest.completion?.assessmentDuration ?? null,
    durationAccounting: assessmentMinutes > 0 ? "modules-plus-final-assessment" : "modules-only",
  };
}

function enrichManifest(manifest) {
  const course = manifest.course ?? {};
  const releaseStatus = manifest.release?.status === "published" ? "public-release-approved" : "internal-review";
  const audience = String(course.audience ?? "general learners").split(/,| and /).map(slug).filter(Boolean);

  return {
    ...manifest,
    completion: completionPolicy(manifest),
    branding: {
      legalName: officialBrand.legalName,
      brandName: officialBrand.brandName,
      academyName: officialBrand.academyName,
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
    tags: {
      industry: unique(manifest.tags?.industry ?? [slug(course.department) || "cross-industry"]),
      domain: unique(manifest.tags?.domain ?? [slug(course.track), slug(course.department)]),
      audience: unique(manifest.tags?.audience ?? audience),
      level: unique(manifest.tags?.level ?? [slug(course.level) || "general"]),
      frameworks: unique(manifest.tags?.frameworks ?? inferFrameworks(manifest)),
      deliveryFormat: unique(manifest.tags?.deliveryFormat ?? ["online-course", "assessment"]),
      commercialModel: unique(manifest.tags?.commercialModel ?? [slug(manifest.commerce?.model), slug(manifest.commerce?.accessPolicy)]),
      brand: ["obserra", "obserra-academy", "official-obserra-brand"],
      classification: unique(["proprietary", releaseStatus]),
    },
  };
}

function allCourseIds() {
  return fs.readdirSync(coursesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((courseId) => fs.existsSync(path.join(coursesRoot, courseId, "course-manifest.json")))
    .sort();
}

function governedScope(courseIds) {
  const explicitCourseId = String(process.env.ACADEMY_COURSE_ID ?? "").trim();
  if (explicitCourseId) {
    if (!COURSE_ID_PATTERN.test(explicitCourseId) || !courseIds.includes(explicitCourseId)) {
      throw new Error(`ACADEMY_COURSE_ID is not a governed course: ${explicitCourseId}`);
    }
    return { courseIds: [explicitCourseId], scope: "course", shardIndex: null, shardCount: null };
  }

  const shardValue = String(process.env.ACADEMY_SHARD_INDEX ?? "").trim();
  if (!shardValue) return { courseIds, scope: "portfolio", shardIndex: null, shardCount: null };

  const shardIndex = Number(shardValue);
  const shardCount = boundedInteger(process.env.ACADEMY_SHARD_COUNT, 61, 1, 64);
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error(`ACADEMY_SHARD_INDEX must be an integer from 0 through ${shardCount - 1}.`);
  }
  const selected = courseIds.filter((_courseId, index) => index % shardCount === shardIndex);
  if (selected.length === 0) throw new Error(`Course policy shard ${shardIndex}/${shardCount} received no courses.`);
  return { courseIds: selected, scope: "shard", shardIndex, shardCount };
}

if (!fs.existsSync(coursesRoot)) throw new Error(`Courses directory not found: ${coursesRoot}`);

const portfolio = allCourseIds();
const scope = governedScope(portfolio);
let updated = 0;
for (const courseId of scope.courseIds) {
  const manifestPath = path.join(coursesRoot, courseId, "course-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const enriched = enrichManifest(manifest);
  fs.writeFileSync(manifestPath, `${JSON.stringify(enriched, null, 2)}\n`);
  updated += 1;
}

console.log(
  `[Academy Studio] Applied official branding, duration accounting, tags, informational disclaimer, and liability terms to ${updated} course manifest(s) in ${scope.scope} scope.`,
);
