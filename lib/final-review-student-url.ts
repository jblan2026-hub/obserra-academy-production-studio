const LOCAL_REVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function configuredAllowedOrigins(): ReadonlySet<string> {
  return new Set(
    (process.env.FINAL_REVIEW_ALLOWED_STUDENT_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function finalReviewStudentExperienceUrl(courseSlug: string): string | null {
  const configuredBase = process.env.FINAL_REVIEW_STUDENT_EXPERIENCE_BASE_URL?.trim();
  if (!configuredBase) return null;

  try {
    const base = new URL(configuredBase);
    const productionSafe = base.protocol === "https:";
    const localDevelopment = process.env.NODE_ENV !== "production" && LOCAL_REVIEW_HOSTS.has(base.hostname);
    if (!productionSafe && !localDevelopment) return null;

    const allowedOrigins = configuredAllowedOrigins();
    if (allowedOrigins.size > 0 && !allowedOrigins.has(base.origin)) return null;

    const reviewUrl = new URL(`/academy/learn/${encodeURIComponent(courseSlug)}`, base.origin);
    reviewUrl.searchParams.set("review", "owner-final");
    reviewUrl.searchParams.set("source", "academy-production-studio");
    return reviewUrl.toString();
  } catch {
    return null;
  }
}
