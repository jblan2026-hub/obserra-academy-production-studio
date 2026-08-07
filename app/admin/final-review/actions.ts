"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformFinalCourseReview } from "@/lib/final-review-auth";
import {
  recordFinalReviewDecision,
  type FinalReviewDecision,
} from "@/lib/repositories/final-review-decision-repository";

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing-${name}`);
  }
  return value.trim();
}

export async function submitFinalReviewDecision(formData: FormData): Promise<never> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/select-organization");
  if (!canPerformFinalCourseReview(userId, orgRole)) redirect("/");

  const courseSlug = requiredString(formData, "courseSlug");
  const rawDecision = requiredString(formData, "decision");
  if (rawDecision !== "approve" && rawDecision !== "changes-required") {
    throw new Error("invalid-final-review-decision");
  }
  const decision = rawDecision as FinalReviewDecision;
  const notesValue = formData.get("notes");
  const notes = typeof notesValue === "string" ? notesValue : "";

  if (formData.get("studentExperienceReviewed") !== "confirmed") {
    throw new Error("student-experience-review-confirmation-required");
  }
  if (formData.get("noAutomaticPublication") !== "confirmed") {
    throw new Error("no-publication-confirmation-required");
  }

  const result = await recordFinalReviewDecision({
    clerkOrganizationId: orgId,
    courseSlug,
    reviewerId: userId,
    decision,
    notes,
  });

  revalidatePath("/admin/final-review");
  revalidatePath(`/admin/final-review/${encodeURIComponent(courseSlug)}`);
  redirect(
    `/admin/final-review?decision=${encodeURIComponent(result.decision)}&course=${encodeURIComponent(result.courseTitle)}&release=${encodeURIComponent(result.releaseVersion)}`,
  );
}
