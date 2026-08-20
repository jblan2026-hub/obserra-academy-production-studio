export type OfficialBrandPolicy = Readonly<{
  officialLogo?: Readonly<{
    assetPath?: string;
  }>;
}>;

export type CourseReadinessFindingInput = Readonly<{
  approved: boolean;
  finding: string;
  requiredGeneratedFiles?: readonly string[];
}>;

export function resolveOfficialCourseLogoAsset(
  brand: OfficialBrandPolicy,
): string;

export function isBlockingCourseFinding(
  input: CourseReadinessFindingInput,
): boolean;
