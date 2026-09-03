import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeAcademyDeliveryRequest } from "@/lib/academy-delivery-auth";
import { deliveryReadiness } from "@/lib/academy-delivery-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

type ReadinessRow = {
  version: string;
  status: string;
  lesson_count: number;
  assessment_count: number;
  video_count: number;
  material_count: number;
  certificate_template_available: boolean;
  published_at: Date | string;
};

function validSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const authorization = authorizeAcademyDeliveryRequest(request);
  if (!authorization.principal) {
    return NextResponse.json(
      { error: authorization.reason ?? "Unauthorized" },
      { status: 403, headers: responseHeaders },
    );
  }
  if (authorization.principal.purpose !== "readiness") {
    return NextResponse.json({ error: "Invalid delivery purpose" }, { status: 403, headers: responseHeaders });
  }

  const courseId = validSlug((await params).courseId);
  if (!courseId) {
    return NextResponse.json({ error: "Invalid course identifier" }, { status: 400, headers: responseHeaders });
  }

  try {
    const [release] = await prisma.$queryRaw<ReadinessRow[]>`
      select
        version,
        status,
        lesson_count,
        assessment_count,
        video_count,
        material_count,
        certificate_template_available,
        published_at
      from public.academy_delivery_releases
      where course_slug = ${courseId}
      limit 1
    `;

    if (!release) {
      return NextResponse.json(
        { ready: false, courseId, reasons: ["published-release-missing"] },
        { status: 404, headers: responseHeaders },
      );
    }

    const readiness = deliveryReadiness({
      status: release.status,
      lessonCount: release.lesson_count,
      assessmentCount: release.assessment_count,
      videoCount: release.video_count,
      materialCount: release.material_count,
      certificateTemplateAvailable: release.certificate_template_available,
    });

    return NextResponse.json(
      {
        courseId,
        version: release.version,
        publishedAt: new Date(release.published_at).toISOString(),
        ...readiness,
        inventory: {
          lessons: release.lesson_count,
          assessmentQuestions: release.assessment_count,
          videos: release.video_count,
          materials: release.material_count,
          certificateTemplate: release.certificate_template_available,
        },
      },
      { status: readiness.ready ? 200 : 409, headers: responseHeaders },
    );
  } catch (error) {
    console.error("Academy release readiness check failed", error);
    return NextResponse.json(
      { ready: false, courseId, reasons: ["readiness-service-unavailable"] },
      { status: 503, headers: responseHeaders },
    );
  }
}
