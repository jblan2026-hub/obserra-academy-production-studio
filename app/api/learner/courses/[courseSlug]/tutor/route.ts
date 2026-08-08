import { canPerformFinalCourseReview } from "@/lib/final-review-auth";
import { finalReviewTutorRuntimeUrl } from "@/lib/final-review-tutor-url";
import { requireOrganization } from "@/lib/organization-service";
import { getFinalReviewReadiness } from "@/lib/repositories/final-review-repository";
import { authenticateStudioRequest } from "@/lib/studio-auth";

export const runtime = "nodejs";

type TutorRequest = {
  lessonId?: string;
  prompt?: string;
  reviewMode?: string;
};

type TutorSource = string | { id?: string; title?: string };

type TutorRuntimeResponse = {
  answer?: unknown;
  sources?: unknown;
  limitations?: unknown;
  error?: unknown;
};

function sanitizeSources(value: unknown): TutorSource[] {
  if (!Array.isArray(value)) return [];

  const sanitized: TutorSource[] = [];
  for (const item of value.slice(0, 20)) {
    if (typeof item === "string") {
      const source = item.trim();
      if (source) sanitized.push(source.slice(0, 500));
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.slice(0, 200) : undefined;
    const title = typeof record.title === "string" ? record.title.slice(0, 500) : undefined;
    if (id || title) sanitized.push({ id, title });
  }
  return sanitized;
}

function sanitizeLimitations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 20)
    .map((item) => item.trim().slice(0, 1000));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseSlug: string }> },
): Promise<Response> {
  const authentication = await authenticateStudioRequest(request);
  if (!authentication.principal) {
    return Response.json({ error: authentication.reason ?? "Authentication and organization context are required." }, { status: 401 });
  }

  const principal = authentication.principal;
  if (!canPerformFinalCourseReview(principal.actorId, principal.role)) {
    return Response.json({ error: "Owner final review access is required." }, { status: 403 });
  }

  const organization = await requireOrganization(principal.organizationId, principal.identityProvider);
  const { courseSlug } = await params;
  const readiness = await getFinalReviewReadiness(organization.clerkOrganizationId, courseSlug);
  if (!readiness?.ready || !readiness.preview) {
    return Response.json(
      { error: "The exact final learner package is not ready for owner review." },
      { status: 409 },
    );
  }

  let body: TutorRequest;
  try {
    body = await request.json() as TutorRequest;
  } catch {
    return Response.json({ error: "A valid JSON request is required." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const lessonId = body.lessonId?.trim();
  if (!prompt || prompt.length > 2000 || !lessonId || lessonId.length > 300) {
    return Response.json({ error: "A valid lesson and prompt are required." }, { status: 400 });
  }
  if (!readiness.preview.lessons.some((lesson) => lesson.id === lessonId)) {
    return Response.json({ error: "The selected lesson is not part of the staged final package." }, { status: 400 });
  }

  const runtimeUrl = finalReviewTutorRuntimeUrl(courseSlug);
  if (!runtimeUrl) {
    return Response.json(
      { error: "The governed learner tutor runtime is not configured for final review." },
      { status: 503 },
    );
  }

  const serviceToken = process.env.FINAL_REVIEW_TUTOR_SERVICE_TOKEN?.trim();
  try {
    const response = await fetch(runtimeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}),
        "X-Obserra-Review-Mode": "owner-final",
        "X-Obserra-Course": courseSlug,
      },
      body: JSON.stringify({
        courseSlug,
        lessonId,
        prompt,
        reviewMode: "owner-final",
        reviewerId: principal.actorId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const payload = await response.json() as TutorRuntimeResponse;
    if (!response.ok) {
      const error = typeof payload.error === "string"
        ? payload.error.slice(0, 1000)
        : "The governed learner tutor runtime rejected the review request.";
      return Response.json({ error }, { status: 502 });
    }

    const answer = typeof payload.answer === "string" ? payload.answer.trim().slice(0, 20_000) : "";
    if (!answer) {
      return Response.json({ error: "The governed learner tutor runtime returned no answer." }, { status: 502 });
    }

    return Response.json({
      answer,
      sources: sanitizeSources(payload.sources),
      limitations: sanitizeLimitations(payload.limitations),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "The governed learner tutor runtime timed out."
      : "The governed learner tutor runtime is unavailable.";
    return Response.json({ error: message }, { status: 502 });
  }
}
