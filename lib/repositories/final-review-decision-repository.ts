import { prisma } from "@/lib/prisma";
import { finalReviewStudentExperienceUrl } from "@/lib/final-review-student-url";
import { getFinalReviewReadiness } from "@/lib/repositories/final-review-repository";

export type FinalReviewDecision = "approve" | "changes-required";

export type FinalReviewDecisionInput = {
  clerkOrganizationId: string;
  courseSlug: string;
  reviewerId: string;
  decision: FinalReviewDecision;
  notes: string;
};

export type FinalReviewDecisionResult = {
  courseSlug: string;
  courseTitle: string;
  releaseVersion: string;
  decision: FinalReviewDecision;
  reviewId: string;
};

export async function recordFinalReviewDecision(
  input: FinalReviewDecisionInput,
): Promise<FinalReviewDecisionResult> {
  if (!process.env.DATABASE_URL) {
    throw new Error("final-review-database-unavailable");
  }

  const readiness = await getFinalReviewReadiness(
    input.clerkOrganizationId,
    input.courseSlug,
  );
  if (!readiness?.ready || !readiness.preview) {
    throw new Error("course-not-ready-for-final-review");
  }

  const studentExperienceUrl = finalReviewStudentExperienceUrl(input.courseSlug);
  if (!studentExperienceUrl) {
    throw new Error("final-review-student-experience-unavailable");
  }

  const normalizedNotes = input.notes.trim().slice(0, 5000);
  if (input.decision === "changes-required" && normalizedNotes.length < 10) {
    throw new Error("changes-required-notes-required");
  }

  const now = new Date();
  return prisma.$transaction(async (transaction) => {
    const course = await transaction.course.findFirst({
      where: {
        id: readiness.preview?.databaseId,
        slug: input.courseSlug,
        organization: { clerkOrganizationId: input.clerkOrganizationId },
      },
      include: {
        releases: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!course) throw new Error("final-review-course-not-found");

    const stagedRelease = course.releases[0];
    if (!stagedRelease || stagedRelease.status !== "STAGED") {
      throw new Error("final-review-release-not-staged");
    }

    const review = await transaction.courseReview.create({
      data: {
        courseId: course.id,
        reviewerRole: "OWNER_FINAL",
        reviewerId: input.reviewerId,
        status: input.decision === "approve" ? "APPROVED" : "CHANGES_REQUIRED",
        notes: normalizedNotes || null,
        completedAt: now,
      },
    });

    if (input.decision === "approve") {
      await Promise.all([
        transaction.course.update({
          where: { id: course.id },
          data: { status: "READY" },
        }),
        transaction.release.update({
          where: { id: stagedRelease.id },
          data: {
            status: "APPROVED",
            approvedBy: input.reviewerId,
            approvedAt: now,
          },
        }),
      ]);
    } else {
      await transaction.course.update({
        where: { id: course.id },
        data: { status: "REVIEW" },
      });
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: course.organizationId,
        actorId: input.reviewerId,
        actorType: "OWNER",
        action:
          input.decision === "approve"
            ? "FINAL_LEARNER_EXPERIENCE_APPROVED"
            : "FINAL_LEARNER_EXPERIENCE_CHANGES_REQUIRED",
        resourceType: "COURSE_RELEASE",
        resourceId: stagedRelease.id,
        correlationId: review.id,
        outcome: input.decision === "approve" ? "APPROVED" : "CHANGES_REQUIRED",
        metadata: {
          courseSlug: course.slug,
          courseTitle: course.title,
          releaseVersion: stagedRelease.version,
          studentExperienceUrl,
          notes: normalizedNotes || null,
          publicationTriggered: false,
        },
      },
    });

    return {
      courseSlug: course.slug,
      courseTitle: course.title,
      releaseVersion: stagedRelease.version,
      decision: input.decision,
      reviewId: review.id,
    };
  });
}
