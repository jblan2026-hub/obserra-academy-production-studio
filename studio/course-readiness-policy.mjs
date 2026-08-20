const DEFAULT_GENERATED_FILES = [
  "instructor-manuscript.md",
  "learner-guide.md",
  "workbook.md",
  "assessment-bank.json",
  "answer-key.json",
  "visual-brief.md",
];

export function resolveOfficialCourseLogoAsset(brand) {
  const assetPath = brand?.officialLogo?.assetPath;
  if (typeof assetPath !== "string" || assetPath.trim().length === 0) {
    throw new Error("Official brand policy must define officialLogo.assetPath");
  }
  return assetPath;
}

export function isBlockingCourseFinding({
  approved,
  finding,
  requiredGeneratedFiles = DEFAULT_GENERATED_FILES,
}) {
  if (!approved) return false;

  const nonBlockingFindings = new Set([
    "missing-ai-course-package",
    "stale-ai-course-package",
    ...requiredGeneratedFiles.map((name) => `missing-generated-${name}`),
  ]);

  return !nonBlockingFindings.has(finding);
}
