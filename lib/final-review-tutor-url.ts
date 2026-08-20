const LOCAL_REVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function configuredAllowedOrigins(): ReadonlySet<string> {
  return new Set(
    (process.env.FINAL_REVIEW_ALLOWED_TUTOR_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function finalReviewTutorRuntimeUrl(courseSlug: string): string | null {
  const configuredBase = process.env.FINAL_REVIEW_TUTOR_RUNTIME_BASE_URL?.trim();
  if (!configuredBase) return null;

  try {
    const base = new URL(configuredBase);
    const productionSafe = base.protocol === "https:";
    const localDevelopment = process.env.NODE_ENV !== "production" && LOCAL_REVIEW_HOSTS.has(base.hostname);
    if (!productionSafe && !localDevelopment) return null;

    const allowedOrigins = configuredAllowedOrigins();
    if (allowedOrigins.size > 0 && !allowedOrigins.has(base.origin)) return null;

    return new URL(
      `/api/academy/courses/${encodeURIComponent(courseSlug)}/tutor`,
      base.origin,
    ).toString();
  } catch {
    return null;
  }
}
