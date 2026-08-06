import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const policyPath = path.join(root, "brand", "official-brand.json");

export const officialBrand = JSON.parse(fs.readFileSync(policyPath, "utf8"));

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function arrayOfStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

export function validateBrandAndTags(manifest) {
  const errors = [];
  const branding = manifest?.branding;
  const tags = manifest?.tags;

  if (branding?.legalName !== officialBrand.legalName) {
    errors.push(`branding.legalName must equal ${officialBrand.legalName}`);
  }
  if (branding?.brandName !== officialBrand.brandName) {
    errors.push(`branding.brandName must equal ${officialBrand.brandName}`);
  }
  if (branding?.academyName !== officialBrand.academyName) {
    errors.push(`branding.academyName must equal ${officialBrand.academyName}`);
  }
  if (branding?.logoAsset !== officialBrand.officialLogo.assetPath) {
    errors.push(`branding.logoAsset must equal ${officialBrand.officialLogo.assetPath}`);
  }
  if (branding?.logoSha256 !== officialBrand.officialLogo.sourceFileSha256) {
    errors.push("branding.logoSha256 does not match the owner-approved official logo");
  }
  if (branding?.classification !== officialBrand.ownership.defaultClassification) {
    errors.push(`branding.classification must equal ${officialBrand.ownership.defaultClassification}`);
  }
  if (branding?.visualSystem !== "official-obserra-executive") {
    errors.push("branding.visualSystem must equal official-obserra-executive");
  }
  if (branding?.brandReviewRequired !== true) {
    errors.push("branding.brandReviewRequired must be true");
  }

  for (const field of officialBrand.requiredCourseTags) {
    if (!arrayOfStrings(tags?.[field])) errors.push(`tags.${field} requires at least one non-empty value`);
  }

  for (const field of officialBrand.requiredCourseTags) {
    for (const value of tags?.[field] ?? []) {
      if (!slugPattern.test(value)) errors.push(`tags.${field} value ${value} must be a lowercase slug`);
    }
  }

  for (const requiredTag of officialBrand.requiredBrandTagValues) {
    if (!tags?.brand?.includes(requiredTag)) errors.push(`tags.brand must include ${requiredTag}`);
  }

  const classificationTags = tags?.classification ?? [];
  if (!classificationTags.some((value) => officialBrand.requiredClassificationTagValues.includes(value))) {
    errors.push("tags.classification must include an approved classification tag");
  }

  return errors;
}

export function assertBrandAndTags(manifest, context = "course manifest") {
  const errors = validateBrandAndTags(manifest);
  if (errors.length) {
    throw new Error(`${context} failed official Obserra branding and tag validation:\n- ${errors.join("\n- ")}`);
  }
}
